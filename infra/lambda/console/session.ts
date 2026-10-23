// Lens Console sign-in: separate from Lens accounts.
//
//   1. Google (the console's own OAuth client, code flow + PKCE + nonce) proves the email.
//   2. The email must be on the team (owners from ADMIN_EMAILS, others in Team).
//   3. An authenticator-app code (TOTP) is required every sign-in; set up at the first one.
//   4. Then a server-side session: a random token in a __Host- cookie (HttpOnly, Secure,
//      SameSite=Strict, this origin only). Ends after 30 minutes idle or 12 hours.
//
//   CLOGIN#<state>        S          → Google round trip (10 min)
//   CSESS#<sha256(token)> S          → session { stage: 'mfa' | 'full', email, … }
//   CADMIN#<email>        TOTP       → { enc (AES-GCM secret), lastStep, at }
//   CADMIN#<email>        S#<hash>   → session list for "Signed-in devices"
//   CADMIN#<email>        BACKUP     → { codes: sha256[] } one-time backup codes (lost phone)
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { log } from './log';
import { ddb, env, getParam, hashSecret, HttpError, json, randomId, rateLimit, Req, Res, withCookies } from '../api/lib';
import { newSecret, otpauthUri, verify } from './totp';
import { Role, roleOf } from './roles';

export const ORIGIN = process.env.CONSOLE_ORIGIN ?? 'https://console.lens.instagrowapp.com';
const PARAMS = process.env.CONSOLE_PARAMS ?? '/lens/console';
const COOKIE = '__Host-lc';
const STATE_COOKIE = '__Host-lc-state';
const IDLE_MS = 30 * 60_000;
const ABSOLUTE_MS = 12 * 3600_000;
const MFA_MS = 10 * 60_000;
const MAX_CODE_TRIES = 5;

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export type Session = {
  hash: string;
  email: string;
  role: Role;
  stage: 'mfa' | 'full';
  createdAt: number;
  lastSeen: number;
};

const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
const ipKey = (req: Req) => sha(`ip:${req.sourceIp ?? '?'}`).slice(0, 16);

function cookie(name: string, value: string, opts: { maxAge?: number; lax?: boolean } = {}) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${opts.lax ? 'Lax' : 'Strict'}${opts.maxAge !== undefined ? `; Max-Age=${opts.maxAge}` : ''}`;
}

const redirect = (to: string, cookies: string[] = []): Res => ({
  statusCode: 302,
  headers: { location: to, 'cache-control': 'no-store' },
  cookies,
});

async function google() {
  const [clientId, clientSecret] = await Promise.all([getParam(`${PARAMS}/google-client-id`), getParam(`${PARAMS}/google-client-secret`)]);
  if (!clientId || !clientSecret) throw new HttpError(503, 'Console sign-in is not set up yet');
  return { clientId, clientSecret };
}

// ---------- Encryption of authenticator secrets ----------

async function key(): Promise<Buffer> {
  const k = await getParam(`${PARAMS}/key`);
  if (!k || k.length < 64) throw new HttpError(503, 'Console key is not set up yet');
  return createHash('sha256').update(`totp:${k}`).digest();
}

async function seal(plain: string): Promise<string> {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', await key(), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

async function open(sealed: string): Promise<string> {
  const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', await key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

// ---------- Google ----------

/** GET /api/auth/google: off to Google's account chooser. */
export async function startGoogle(req: Req): Promise<Res> {
  await rateLimit(`console-start:${ipKey(req)}`, 60, 'Too many sign-in attempts. Try again in an hour.');
  const { clientId } = await google();
  const state = randomId(24);
  const verifier = randomId(48);
  const nonce = randomId(18);
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: { pk: `CLOGIN#${state}`, sk: 'S', verifier, nonce, at: Date.now(), ttl: Math.floor(Date.now() / 1000) + 600 },
    }),
  );
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${ORIGIN}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  // Lax: the cookie must come back on Google's top-level redirect to /api/auth/callback.
  return redirect(url.toString(), [cookie(STATE_COOKIE, state, { maxAge: 600, lax: true })]);
}

/** GET /api/auth/callback?code&state: Google's answer → step 2 (authenticator code). */
export async function googleCallback(req: Req): Promise<Res> {
  const clear = cookie(STATE_COOKIE, '', { maxAge: 0, lax: true });
  const fail = (why: string) => redirect(`/login?e=${why}`, [clear]);
  await rateLimit(`console-callback:${ipKey(req)}`, 30, 'Too many sign-in attempts. Try again in an hour.');
  const state = req.query.state ?? '';
  if (!state || state !== req.cookies[STATE_COOKIE]) return fail('expired');
  const row = await ddb.send(
    new DeleteCommand({ TableName: env.table, Key: { pk: `CLOGIN#${state}`, sk: 'S' }, ReturnValues: 'ALL_OLD' }),
  );
  const login = row.Attributes;
  if (!login || login.at + 600_000 < Date.now() || typeof req.query.code !== 'string') return fail('expired');

  const { clientId, clientSecret } = await google();
  const res = await fetch(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: req.query.code,
      code_verifier: login.verifier,
      redirect_uri: `${ORIGIN}/api/auth/callback`,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { id_token?: string };
  if (!res.ok || !data.id_token) return fail('google');
  // Straight from Google's token endpoint over TLS (OpenID Connect 3.1.3.7): claims checked, signature not needed.
  const claims = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!issuerOk || claims.aud !== clientId || Number(claims.exp) * 1000 < Date.now() || claims.nonce !== login.nonce) return fail('google');
  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  if (!email || claims.email_verified !== true) return fail('google');

  const role = await roleOf(email);
  if (!role) {
    await log({ entity: `console:${email}`, action: 'console.login.denied', actor: `console:${email}`, data: { ip: ipKey(req), city: req.city } });
    return fail('denied');
  }
  const token = randomId(32);
  const now = Date.now();
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: { pk: `CSESS#${hashSecret(token)}`, sk: 'S', stage: 'mfa', email, createdAt: now, lastSeen: now, tries: 0, ttl: Math.floor((now + MFA_MS) / 1000) },
    }),
  );
  return redirect('/verify', [clear, cookie(COOKIE, token)]);
}

// ---------- Session lookup ----------

/** The caller's session (any stage), or null. Ends idle/expired sessions and removed team members. */
export async function currentSession(req: Req): Promise<Session | null> {
  const token = req.cookies[COOKIE];
  if (!token || token.length > 100) return null;
  const hash = hashSecret(token);
  const r = await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `CSESS#${hash}`, sk: 'S' } }));
  const s = r.Item;
  if (!s) return null;
  const now = Date.now();
  const limit = s.stage === 'mfa' ? s.createdAt + MFA_MS : Math.min(s.createdAt + ABSOLUTE_MS, s.lastSeen + IDLE_MS);
  if (now > limit) {
    await endSession(hash, s.email);
    return null;
  }
  const role = await roleOf(s.email);
  if (!role) {
    await endSession(hash, s.email);
    return null;
  }
  if (s.stage === 'full' && now - s.lastSeen > 60_000) {
    await ddb.send(
      new UpdateCommand({ TableName: env.table, Key: { pk: `CSESS#${hash}`, sk: 'S' }, UpdateExpression: 'SET lastSeen = :n', ExpressionAttributeValues: { ':n': now } }),
    );
    await ddb
      .send(
        new UpdateCommand({
          TableName: env.table,
          Key: { pk: `CADMIN#${s.email}`, sk: `S#${hash}` },
          UpdateExpression: 'SET lastSeen = :n',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: { ':n': now },
        }),
      )
      .catch(() => {});
  }
  return { hash, email: s.email, role, stage: s.stage, createdAt: s.createdAt, lastSeen: now };
}

async function endSession(hash: string, email: string) {
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `CSESS#${hash}`, sk: 'S' } }));
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `CADMIN#${email}`, sk: `S#${hash}` } }));
}

// ---------- Authenticator code ----------

async function totpRow(email: string) {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `CADMIN#${email}`, sk: 'TOTP' } }))).Item;
}

/** GET /api/session: where the visitor is in sign-in. */
export async function sessionInfo(s: Session | null): Promise<Res> {
  if (!s) return json(200, { stage: 'signed-out' });
  if (s.stage === 'mfa') return json(200, { stage: 'mfa', email: s.email, enrolled: !!(await totpRow(s.email)) });
  return json(200, { stage: 'full', email: s.email, role: s.role, expiresAt: Math.min(s.createdAt + ABSOLUTE_MS, s.lastSeen + IDLE_MS) });
}

/** POST /api/auth/totp/setup: first sign-in, a new secret to scan (kept on the pending session). */
export async function totpSetup(s: Session): Promise<Res> {
  if (s.stage !== 'mfa') throw new HttpError(400, 'Already signed in');
  if (await totpRow(s.email)) throw new HttpError(400, 'An authenticator is already set up for this account');
  // Same key if asked again during this sign-in (a reload must not invalidate a scanned code).
  const row = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `CSESS#${s.hash}`, sk: 'S' } }))).Item;
  if (row?.pendingSecret) {
    const secret = await open(row.pendingSecret);
    return json(200, { secret, uri: otpauthUri(secret, s.email) });
  }
  const secret = newSecret();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `CSESS#${s.hash}`, sk: 'S' },
        UpdateExpression: 'SET pendingSecret = :p',
        ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(pendingSecret)',
        ExpressionAttributeValues: { ':p': await seal(secret) },
      }),
    );
  } catch {
    // Another tab got there first (show its key), or the sign-in ended.
    const again = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `CSESS#${s.hash}`, sk: 'S' } }))).Item;
    if (!again?.pendingSecret) throw new HttpError(401, 'Sign in again');
    const theirs = await open(again.pendingSecret);
    return json(200, { secret: theirs, uri: otpauthUri(theirs, s.email) });
  }
  return json(200, { secret, uri: otpauthUri(secret, s.email) });
}

// ---------- Backup codes (lost authenticator) ----------
// 10 one-time codes (xxxx-xxxx), shown once at set-up and when made again in "Your account".
// Each works instead of the 6-digit code, once. Only hashes are stored.

const BACKUP_COUNT = 10;
const BACKUP = /^[a-z2-9]{4}-?[a-z2-9]{4}$/i;
const backupHash = (email: string, code: string) => sha(`backup:${email}:${code.toLowerCase().replace('-', '')}`);

function makeCodes(): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: BACKUP_COUNT }, () => {
    const b = randomBytes(8);
    const c = Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}

async function newBackupCodes(email: string): Promise<string[]> {
  const codes = makeCodes();
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `CADMIN#${email}`, sk: 'BACKUP', codes: codes.map((c) => backupHash(email, c)), at: Date.now() } }));
  return codes;
}

/** Uses up one backup code; true if it was valid. */
async function useBackupCode(email: string, code: string): Promise<boolean> {
  const row = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `CADMIN#${email}`, sk: 'BACKUP' } }))).Item;
  const list = (row?.codes ?? []) as string[];
  const i = list.indexOf(backupHash(email, code));
  if (i < 0) return false;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `CADMIN#${email}`, sk: 'BACKUP' },
        UpdateExpression: `REMOVE codes[${i}]`,
        ConditionExpression: `codes[${i}] = :h`,
        ExpressionAttributeValues: { ':h': list[i] },
      }),
    );
    return true;
  } catch {
    return false; // used at the same moment elsewhere
  }
}

/** GET /api/auth/backup-codes: how many are left. POST: make 10 new ones (old ones stop working). */
export async function backupCodes(s: Session, req: Req): Promise<Res> {
  if (req.method === 'GET') {
    const row = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `CADMIN#${s.email}`, sk: 'BACKUP' } }))).Item;
    return json(200, { left: (row?.codes ?? []).length, at: row?.at });
  }
  const codes = await newBackupCodes(s.email);
  await log({ entity: `console:${s.email}`, action: 'console.backup-codes.new', actor: `console:${s.email}` });
  return json(200, { codes });
}

/** POST /api/auth/totp {code}: finishes sign-in; a fresh session token replaces the pending one. */
export async function totpVerify(s: Session, req: Req): Promise<Res> {
  if (s.stage !== 'mfa') throw new HttpError(400, 'Already signed in');
  const code = String(req.body?.code ?? '').replace(/\s/g, '');
  const pending = await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `CSESS#${s.hash}`, sk: 'S' },
      UpdateExpression: 'ADD tries :one',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'ALL_NEW',
    }),
  );
  const row = pending.Attributes!;
  if (row.tries > MAX_CODE_TRIES) {
    await endSession(s.hash, s.email);
    await log({ entity: `console:${s.email}`, action: 'console.mfa.locked', actor: `console:${s.email}`, data: { ip: ipKey(req) } });
    throw new HttpError(401, 'Too many wrong codes. Sign in again.');
  }
  const enrolled = await totpRow(s.email);
  // Lost phone: a backup code instead of the authenticator (only once one is set up).
  const usedBackup = !!enrolled && BACKUP.test(code) && (await useBackupCode(s.email, code));
  const secret = enrolled ? await open(enrolled.enc) : row.pendingSecret ? await open(row.pendingSecret) : null;
  if (!secret) throw new HttpError(400, 'Set up your authenticator first');
  const step = usedBackup ? (enrolled!.lastStep as number) : verify(secret, code, enrolled?.lastStep ?? 0);
  if (usedBackup) await log({ entity: `console:${s.email}`, action: 'console.mfa.backup-code', actor: `console:${s.email}`, data: { ip: ipKey(req) } });
  if (step === null) {
    await log({ entity: `console:${s.email}`, action: 'console.mfa.failed', actor: `console:${s.email}`, data: { ip: ipKey(req), tries: row.tries } });
    throw new HttpError(401, `That code didn’t match. ${MAX_CODE_TRIES - row.tries} tries left.`);
  }
  // Each code works once (also against two sign-ins racing with the same code).
  let firstCodes: string[] | undefined;
  if (usedBackup) {
    // Already used up above.
  } else if (enrolled) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.table,
          Key: { pk: `CADMIN#${s.email}`, sk: 'TOTP' },
          UpdateExpression: 'SET lastStep = :s',
          ConditionExpression: 'lastStep < :s',
          ExpressionAttributeValues: { ':s': step },
        }),
      );
    } catch {
      throw new HttpError(401, 'That code was used already. Wait for the next one.');
    }
  } else {
    await ddb.send(
      new PutCommand({
        TableName: env.table,
        Item: { pk: `CADMIN#${s.email}`, sk: 'TOTP', enc: row.pendingSecret, lastStep: step, at: Date.now() },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    await log({ entity: `console:${s.email}`, action: 'console.mfa.enrolled', actor: `console:${s.email}` });
    firstCodes = await newBackupCodes(s.email);
  }

  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `CSESS#${s.hash}`, sk: 'S' } }));
  const token = randomId(32);
  const hash = hashSecret(token);
  const now = Date.now();
  const device = { ua: String(req.headers['user-agent'] ?? '').slice(0, 200), city: req.city, ip: ipKey(req) };
  const ttl = Math.floor((now + ABSOLUTE_MS) / 1000) + 3600;
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `CSESS#${hash}`, sk: 'S', stage: 'full', email: s.email, createdAt: now, lastSeen: now, ...device, ttl } }));
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `CADMIN#${s.email}`, sk: `S#${hash}`, createdAt: now, lastSeen: now, ...device, ttl } }));
  await log({ entity: `console:${s.email}`, action: 'console.login', actor: `console:${s.email}`, data: { ip: device.ip, city: device.city } });
  return withCookies(json(200, { ok: true, backupCodes: firstCodes }), [cookie(COOKIE, token)]);
}

/** POST /api/auth/logout */
export async function logout(s: Session | null): Promise<Res> {
  if (s) {
    await endSession(s.hash, s.email);
    await log({ entity: `console:${s.email}`, action: 'console.logout', actor: `console:${s.email}` });
  }
  return withCookies(json(200, { ok: true }), [cookie(COOKIE, '', { maxAge: 0 })]);
}

// ---------- Signed-in devices ----------

async function sessionsOf(email: string) {
  const r = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
      ExpressionAttributeValues: { ':p': `CADMIN#${email}`, ':s': 'S#' },
    }),
  );
  const now = Date.now();
  return (r.Items ?? [])
    .filter((i) => now < Math.min(i.createdAt + ABSOLUTE_MS, i.lastSeen + IDLE_MS))
    .map((i) => ({ id: String(i.sk).slice(2, 14), createdAt: i.createdAt, lastSeen: i.lastSeen, ua: i.ua, city: i.city, hash: String(i.sk).slice(2) }));
}

/** GET /api/sessions: your signed-in devices. */
export async function mySessions(s: Session): Promise<Res> {
  const list = await sessionsOf(s.email);
  return json(200, { sessions: list.map(({ hash, ...x }) => ({ ...x, current: hash === s.hash })) });
}

/** POST /api/sessions/end {id?}: sign out one of your devices, or all others. */
export async function endMySessions(s: Session, req: Req): Promise<Res> {
  const id = typeof req.body?.id === 'string' ? req.body.id : null;
  const list = await sessionsOf(s.email);
  const ended = list.filter((x) => x.hash !== s.hash && (id === null || x.id === id));
  for (const x of ended) await endSession(x.hash, s.email);
  await log({ entity: `console:${s.email}`, action: 'console.sessions.ended', actor: `console:${s.email}`, data: { count: ended.length } });
  return json(200, { ended: ended.length });
}

/** Owners: sign someone out everywhere (and optionally make them set up a new authenticator). */
export async function signOutMember(by: Session, email: string, resetAuthenticator: boolean) {
  for (const x of await sessionsOf(email)) await endSession(x.hash, email);
  if (resetAuthenticator) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `CADMIN#${email}`, sk: 'TOTP' } }));
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `CADMIN#${email}`, sk: 'BACKUP' } }));
  }
  await log({ entity: `console:${email}`, action: resetAuthenticator ? 'console.mfa.reset' : 'console.sessions.ended', actor: `console:${by.email}` });
}

export const isEnrolled = async (email: string) => !!(await totpRow(email));
export const activeSessions = (email: string) => sessionsOf(email).then((l) => l.length);
