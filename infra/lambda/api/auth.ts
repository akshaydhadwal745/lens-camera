// Accounts: a phone starts as a guest identity; signing in (email + 6-digit
// code, or Google on Android) turns it into an account you can get back on any
// phone. Sessions are server-side (hashed tokens, checked on every request,
// sliding 90-day expiry), so logging out takes effect immediately.
//
// Keys:  ID#email#<address> / ID#google#<sub>  →  ACCOUNT {accountId}
//        OTP#<email>                          →  CODE {hash, attempts, expiresAt}
//        RATE#<scope>#<hour>                  →  COUNT (rate limits)
//
// Signing in on a phone whose guest identity already has photos moves those
// records into the account (S3 objects stay where they are; records keep their key).
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { createIdentity, Identity, issueToken, webSignIn } from './identity';
import { ddb, derivedKey, env, hashSecret, HttpError, json, rateLimit as limit, Req, Res, safeEqual } from './lib';
import { googleLoginClaims } from './oauth';
import { isDisposableEmail } from './disposable';
import { attribute } from './attribution';
import { forgetGuest, onAttributed, onPhoneSignIn, rewardsHook } from './referrals';

const ses = new SESv2Client({});

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const CODES_PER_HOUR = 5;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
/** Reserved test domain (RFC 2606 .invalid): codes are stored readable for e2e, never emailed. */
const TEST_DOMAIN = '@e2e.lens.invalid';
/** Stop merging before the API's time limit; the app retries to finish. */
const MERGE_BUDGET_MS = 40_000;

type LoginKind = 'email' | 'google';

const loginKey = (kind: LoginKind, value: string) => ({ pk: `ID#${kind}#${value}`, sk: 'ACCOUNT' });
const profileKey = (id: string) => ({ pk: `D#${id}`, sk: 'PROFILE' });

function normalizeEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address');
  return email;
}

// ---------- Email codes ----------

/**
 * POST /v1/auth/email/start {email}: emails a 6-digit code. Also the website's
 * POST /v1/web/auth/email/start (no identity yet: limited per network instead).
 */
export async function startEmail(identity: Identity | null, req: Req): Promise<Res> {
  const email = normalizeEmail(req.body.email);
  if (isDisposableEmail(email)) {
    throw new HttpError(400, 'Temporary email addresses can’t be used. Please use your regular email.', 'disposable-email');
  }
  await limit(`email#${email}`, CODES_PER_HOUR, 'Too many codes requested. Try again in an hour.');
  if (identity) await limit(`device#${identity.id}`, CODES_PER_HOUR * 2, 'Too many codes requested. Try again in an hour.');
  // Per network for the website: loose (CGNAT puts many people behind one IP).
  else if (req.sourceIp) await limit(`webcode#${req.sourceIp}`, 200, 'Too many codes requested from this network. Try again in an hour.');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const isTest = email.endsWith(TEST_DOMAIN);
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: {
        pk: `OTP#${email}`,
        sk: 'CODE',
        hash: hashSecret(`${email}:${code}`),
        attempts: 0,
        expiresAt: Date.now() + CODE_TTL_MS,
        ttl: Math.floor((Date.now() + CODE_TTL_MS) / 1000) + 3600,
        ...(isTest ? { testCode: code } : {}),
      },
    }),
  );
  if (!isTest) {
    if (!env.codeSender) throw new HttpError(503, 'Email sign-in isn’t available yet');
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: `Lens <${env.codeSender}>`,
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: {
            Subject: { Data: `${code} is your Lens sign-in code` },
            Body: {
              Text: {
                Data: `Your Lens sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
              },
            },
          },
        },
      }),
    );
  }
  return json(200, { sent: true, expiresInSeconds: CODE_TTL_MS / 1000 });
}

/** Checks and consumes an emailed code; returns the email. */
async function consumeCode(req: Req): Promise<string> {
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.code ?? '').replace(/\D/g, '');
  if (code.length !== 6) throw new HttpError(400, 'Enter the 6-digit code');

  const key = { pk: `OTP#${email}`, sk: 'CODE' };
  const stored = (await ddb.send(new GetCommand({ TableName: env.table, Key: key }))).Item;
  if (!stored || stored.expiresAt < Date.now()) throw new HttpError(400, 'That code has expired. Ask for a new one.');
  if (stored.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'Too many wrong codes. Ask for a new one.');
  if (!safeEqual(stored.hash, hashSecret(`${email}:${code}`))) {
    await ddb.send(
      new UpdateCommand({ TableName: env.table, Key: key, UpdateExpression: 'ADD attempts :one', ExpressionAttributeValues: { ':one': 1 } }),
    );
    throw new HttpError(400, 'That code isn’t right');
  }
  // Single use.
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: key }));
  return email;
}

/** POST /v1/auth/email/verify {email, code, device?}: signs in. */
export async function verifyEmail(identity: Identity, req: Req): Promise<Res> {
  const email = await consumeCode(req);
  return json(200, await signIn(identity, req, [{ kind: 'email', value: email }], email));
}

// ---------- Website sign-in (no guest identity on the web) ----------

/** The account for these logins; a new one is created for first-time web sign-ups. */
async function accountForWeb(req: Req, logins: { kind: LoginKind; value: string }[], email?: string): Promise<string> {
  const existing = await findAccount(logins);
  const accountId = existing ?? (await createIdentity()).id;
  await linkLogins(accountId, logins, email);
  // New web sign-up that came through an invite/affiliate link (cookie). The
  // referral reward waits until they also sign in on a phone.
  if (!existing) await rewardsHook(async () => onAttributed(accountId, await attribute(accountId, req, undefined, 'web')));
  return accountId;
}

/** POST /v1/web/auth/email/verify {email, code}: signs the browser in (session cookie). */
export async function webVerifyEmail(req: Req): Promise<Res> {
  const email = await consumeCode(req);
  return webSignIn(await accountForWeb(req, [{ kind: 'email', value: email }], email), req);
}

/** POST /v1/web/auth/google {code, state, codeVerifier}: Google sign-in on the website. */
export async function webVerifyGoogle(req: Req): Promise<Res> {
  const claims = await googleLoginClaims(null, req);
  const logins: { kind: LoginKind; value: string }[] = [{ kind: 'google', value: claims.sub }];
  if (claims.email && claims.emailVerified) logins.push({ kind: 'email', value: claims.email.toLowerCase() });
  return webSignIn(await accountForWeb(req, logins, claims.email?.toLowerCase()), req);
}

// ---------- Google (Android) ----------

/** POST /v1/auth/google {code, state, codeVerifier, device?}: signs in with a Google account. */
export async function verifyGoogle(identity: Identity, req: Req): Promise<Res> {
  const claims = await googleLoginClaims(identity, req);
  const logins: { kind: LoginKind; value: string }[] = [{ kind: 'google', value: claims.sub }];
  // A verified Google email is the same person as that email's code login.
  if (claims.email && claims.emailVerified) logins.push({ kind: 'email', value: claims.email.toLowerCase() });
  return json(200, await signIn(identity, req, logins, claims.email?.toLowerCase()));
}

// ---------- Sign-in core ----------

type SignInResult = {
  id: string;
  name: string;
  email?: string;
  /** New session token when this phone switched to an existing account. */
  token?: string;
  /** Records moved from this phone's guest identity into the account. */
  moved: number;
  /** True if more records remain to move: call POST /auth/continue with `resume`. */
  pending: boolean;
  resume?: string;
};

const RESUME_TTL_MS = 10 * 60 * 1000;

/** Signed proof that this guest may finish moving into the account (no code needed again). */
async function signResume(fromId: string, toId: string): Promise<string> {
  const body = Buffer.from(JSON.stringify({ f: fromId, t: toId, e: Date.now() + RESUME_TTL_MS })).toString('base64url');
  return `${body}.${createHmac('sha256', await derivedKey('account-merge')).update(body).digest('base64url')}`;
}

async function readResume(value: unknown): Promise<{ f: string; t: string }> {
  const [body, mac] = String(value ?? '').split('.');
  const expected = createHmac('sha256', await derivedKey('account-merge')).update(body ?? '').digest();
  const given = Buffer.from(mac ?? '', 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(400, 'Invalid sign-in');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (data.e < Date.now()) throw new HttpError(400, 'Sign-in took too long. Please sign in again.');
  return data;
}

/** POST /v1/auth/continue {resume, device?}: finishes moving a large guest library. */
export async function continueSignIn(identity: Identity, req: Req): Promise<Res> {
  const { f, t } = await readResume(req.body.resume);
  if (f !== identity.id) throw new HttpError(403, 'This sign-in belongs to someone else');
  return json(200, await finishMerge(identity, req, t));
}

async function findAccount(logins: { kind: LoginKind; value: string }[]): Promise<string | undefined> {
  for (const l of logins) {
    const item = (await ddb.send(new GetCommand({ TableName: env.table, Key: loginKey(l.kind, l.value) }))).Item;
    if (item?.accountId) return item.accountId as string;
  }
  return undefined;
}

async function linkLogins(accountId: string, logins: { kind: LoginKind; value: string }[], email?: string) {
  for (const l of logins) {
    try {
      await ddb.send(
        new PutCommand({
          TableName: env.table,
          Item: { ...loginKey(l.kind, l.value), accountId, createdAt: Date.now() },
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
    } catch (error: any) {
      if (error?.name !== 'ConditionalCheckFailedException') throw error; // already linked
    }
  }
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: profileKey(accountId),
      // loginKeys: exactly which login records point here (to unlink them on account deletion).
      UpdateExpression: `${email ? 'SET email = if_not_exists(email, :e) ' : ''}ADD logins :l, loginKeys :k`,
      ExpressionAttributeValues: {
        ...(email ? { ':e': email } : {}),
        ':l': new Set(logins.map((l) => l.kind)),
        ':k': new Set(logins.map((l) => loginKey(l.kind, l.value).pk)),
      },
    }),
  );
}

async function signIn(identity: Identity, req: Req, logins: { kind: LoginKind; value: string }[], email?: string): Promise<SignInResult> {
  const accountId = await findAccount(logins);

  // First sign-in: this phone's identity becomes the account.
  if (!accountId || accountId === identity.id) {
    await linkLogins(identity.id, logins, email);
    await rewardsHook(async () => onPhoneSignIn(identity.id, await fingerprintOf(identity.id)));
    return { id: identity.id, name: identity.name, email, moved: 0, pending: false };
  }

  // Existing account: bring this phone's guest records along, then switch the phone over.
  await linkLogins(accountId, logins, email);
  return finishMerge(identity, req, accountId, email);
}

async function finishMerge(identity: Identity, req: Req, accountId: string, email?: string): Promise<SignInResult> {
  const account = (await ddb.send(new GetCommand({ TableName: env.table, Key: profileKey(accountId) }))).Item;
  if (!account) throw new HttpError(409, 'That account no longer exists');
  const { moved, pending } = await mergeInto(identity.id, accountId, account.name as string);
  if (pending) {
    return { id: accountId, name: account.name, email: account.email, moved, pending, resume: await signResume(identity.id, accountId) };
  }
  const token = await issueToken(accountId, 'device', deviceLabel(req));
  const fingerprint = await fingerprintOf(identity.id);
  // The guest was not a new user after all: drop it from an inviter's friend list.
  await rewardsHook(() => forgetGuest(identity.id));
  await retireIdentity(identity.id, identity.name);
  // This phone now belongs to the account (referral check: web sign-ups earn their inviter's reward here).
  await rewardsHook(() => onPhoneSignIn(accountId, fingerprint));
  return { id: accountId, name: account.name, email: account.email ?? email, token, moved, pending: false };
}

async function fingerprintOf(id: string): Promise<string | undefined> {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: profileKey(id), ProjectionExpression: 'fingerprint' }))).Item?.fingerprint;
}

function deviceLabel(req: Req): string | undefined {
  const d = req.body.device;
  return typeof d === 'string' ? d.slice(0, 80) : undefined;
}

/** Counted toward Lens quota (same rule as trash.ts). */
function countedBytes(item: Record<string, any>): number {
  if (item.location) return 0;
  return item.status === 'ready' && !item.ownerHidden && !item.archived ? (item.size as number) : 0;
}

/**
 * Moves the guest's media, shares received, contacts and storages into the
 * account. Each item moves atomically (put new + delete old [+ quota]), so a
 * retry after a timeout simply continues.
 */
async function mergeInto(fromId: string, toId: string, toName: string): Promise<{ moved: number; pending: boolean }> {
  const started = Date.now();
  let moved = 0;
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        KeyConditionExpression: 'pk = :p',
        ExpressionAttributeValues: { ':p': `D#${fromId}` },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const item of page.Items ?? []) {
      const sk = item.sk as string;
      if (sk === 'PROFILE' || sk.startsWith('T#')) continue;
      if (Date.now() - started > MERGE_BUDGET_MS) return { moved, pending: true };
      await moveItem(item, fromId, toId, toName);
      moved++;
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return { moved, pending: false };
}

async function moveItem(item: Record<string, any>, fromId: string, toId: string, toName: string) {
  const sk = item.sk as string;
  const next: Record<string, any> = { ...item, pk: `D#${toId}` };
  if (sk.startsWith('S#')) {
    // A share I received: re-key it to the account (sk keeps the owner).
    next.gsi1sk = `D#${toId}`;
  }
  if (item.gsi1pk === 'TRASH' && typeof item.gsi1sk === 'string') {
    next.gsi1sk = item.gsi1sk.replace(`#${fromId}#`, `#${toId}#`);
  }
  const bytes = sk.startsWith('M#') ? countedBytes(item) : 0;
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: env.table, Item: next } },
        { Delete: { TableName: env.table, Key: { pk: item.pk, sk } } },
        ...(bytes
          ? [
              {
                Update: {
                  TableName: env.table,
                  Key: profileKey(toId),
                  UpdateExpression: 'ADD usedBytes :b',
                  ExpressionAttributeValues: { ':b': bytes },
                },
              },
            ]
          : []),
      ],
    }),
  );
  if (sk.startsWith('M#')) await moveSharesOf(item.id as string, fromId, toId, toName);
}

/** Shares of a moved photo now come from the account. */
async function moveSharesOf(mediaId: string, fromId: string, toId: string, toName: string) {
  const shares = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :g',
      ExpressionAttributeValues: { ':g': `SM#${fromId}#${mediaId}` },
    }),
  );
  for (const keys of shares.Items ?? []) {
    const old = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: keys.pk, sk: keys.sk } }))).Item;
    if (!old) continue;
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: env.table,
              Item: { ...old, sk: `S#${mediaId}#${toId}`, ownerId: toId, ownerName: toName, gsi1pk: `SM#${toId}#${mediaId}` },
            },
          },
          { Delete: { TableName: env.table, Key: { pk: old.pk, sk: old.sk } } },
        ],
      }),
    );
  }
}

/** After a merge: the guest identity's tokens, name and profile go away. */
async function retireIdentity(id: string, name: string) {
  const tokens = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :t)',
      ExpressionAttributeValues: { ':p': `D#${id}`, ':t': 'T#' },
    }),
  );
  for (const t of tokens.Items ?? []) await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: t.pk, sk: t.sk } }));
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `N#${name}`, sk: 'NAME' } }));
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: profileKey(id) }));
}

// ---------- Sessions ----------

/** GET /v1/sessions: devices signed in to this account. */
export async function listSessions(identity: Identity): Promise<Res> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :t)',
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':t': 'T#' },
    }),
  );
  const sessions = (result.Items ?? [])
    .map((t) => ({
      id: (t.sk as string).slice(2),
      label: (t.device as string) ?? (t.browser as string) ?? (t.label === 'web' ? 'Web browser' : 'Phone'),
      kind: t.label as string,
      createdAt: t.createdAt as number,
      lastUsedAt: (t.lastUsedAt as number) ?? (t.createdAt as number),
      current: (t.sk as string).slice(2) === identity.tokenId,
    }))
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  return json(200, { sessions });
}

/** DELETE /v1/sessions/:id: sign that device out. "current" = this device. */
export async function revokeSession(identity: Identity, id: string): Promise<Res> {
  const tokenId = id === 'current' ? identity.tokenId : id;
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `T#${tokenId}` } }));
  return json(200, { revoked: tokenId });
}

/** DELETE /v1/sessions: sign out every other device. */
export async function revokeOtherSessions(identity: Identity): Promise<Res> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :t)',
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':t': 'T#' },
    }),
  );
  let count = 0;
  for (const t of result.Items ?? []) {
    if ((t.sk as string).slice(2) === identity.tokenId) continue;
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: t.pk, sk: t.sk } }));
    count++;
  }
  return json(200, { revoked: count });
}
