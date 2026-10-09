import { randomInt } from 'node:crypto';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import {
  clearedCookie,
  ddb,
  env,
  hashSecret,
  HttpError,
  json,
  quotaFor,
  randomId,
  rateLimit,
  Req,
  Res,
  safeEqual,
  sessionCookie,
  WEB_COOKIE,
  withCookies,
} from './lib';
import { randomName } from './names';

export type Identity = { id: string; name: string; usedBytes: number; tokenId: string; email?: string };

/** Sessions end after this long without use (sliding; refreshed at most daily). */
const SESSION_IDLE_MS = 90 * 24 * 3600 * 1000;
const SESSION_SLIDE_MS = 24 * 3600 * 1000;

export async function issueToken(deviceId: string, label: 'device' | 'web', device?: string): Promise<string> {
  const tokenId = randomId(9);
  const secret = randomId(32);
  const now = Date.now();
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: {
        pk: `D#${deviceId}`,
        sk: `T#${tokenId}`,
        hash: hashSecret(secret),
        label,
        // Web tokens carry a browser description; phones a device name.
        ...(label === 'web' ? { browser: device } : { device }),
        createdAt: now,
        lastUsedAt: now,
        expiresAt: now + SESSION_IDLE_MS,
      },
    }),
  );
  return `${deviceId}.${tokenId}.${secret}`;
}

/**
 * New guest identities per network address per hour: a loose brake on scripts
 * (they can fake fingerprints). Kept high because mobile carriers put thousands
 * of users behind one address (CGNAT). Real protection: fingerprint + 5 GB
 * guest limit (+ Play Integrity later).
 */
const REGISTRATIONS_PER_IP_HOUR = 300;
const FINGERPRINT = /^[0-9a-f]{64}$/;

/**
 * POST /v1/devices {device?, fingerprint?}: a guest identity for this phone.
 * `fingerprint` is a hash of the device's ID (Android ID / Keychain UUID). The
 * same phone gets its existing guest back (same photos, same 5 GB) instead of
 * a fresh one after a reinstall. Once that guest became a signed-in account,
 * a reinstall starts a new guest (the account needs signing in).
 */
/**
 * A new identity with a unique random name (no token). Used for website
 * sign-ups: someone who signs in on the web first gets an account right away.
 */
export async function createIdentity(): Promise<{ id: string; name: string }> {
  const id = randomId(12);
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = randomName();
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: env.table, Item: { pk: `N#${name}`, sk: 'NAME', deviceId: id }, ConditionExpression: 'attribute_not_exists(pk)' } },
            {
              Put: {
                TableName: env.table,
                Item: { pk: `D#${id}`, sk: 'PROFILE', name, usedBytes: 0, createdAt: now, gsi1pk: 'NAME', gsi1sk: name },
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
          ],
        }),
      );
      return { id, name };
    } catch (error: any) {
      if (error?.name === 'TransactionCanceledException') continue; // name taken, retry
      throw error;
    }
  }
  throw new HttpError(503, 'Could not allocate a name, try again');
}

/** Signs a browser in: a web session token in the HttpOnly cookie (never in the body). */
export async function webSignIn(accountId: string, req: Req, extra: Record<string, unknown> = {}): Promise<Res> {
  const profile = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${accountId}`, sk: 'PROFILE' } }))).Item;
  if (!profile) throw new HttpError(409, 'That account no longer exists');
  const token = await issueToken(accountId, 'web', describeBrowser(req.headers['user-agent'] ?? ''));
  return withCookies(json(200, { id: accountId, name: profile.name, email: profile.email, ...extra }), [sessionCookie(token)]);
}

export async function register(req?: Req): Promise<Res> {
  const device = typeof req?.body?.device === 'string' ? req.body.device.slice(0, 80) : undefined;
  const fingerprint =
    typeof req?.body?.fingerprint === 'string' && FINGERPRINT.test(req.body.fingerprint) ? req.body.fingerprint : undefined;
  const deviceKey = fingerprint ? { pk: `FP#${fingerprint}`, sk: 'DEVICE' } : undefined;

  if (deviceKey) {
    const known = (await ddb.send(new GetCommand({ TableName: env.table, Key: deviceKey }))).Item;
    if (known?.guestId) {
      const profile = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${known.guestId}`, sk: 'PROFILE' } })))
        .Item;
      if (profile && !profile.email) {
        const token = await issueToken(known.guestId, 'device', device);
        return json(200, { id: known.guestId, name: profile.name, token, restored: true });
      }
    }
  }
  if (req?.sourceIp) {
    await rateLimit(`register#${req.sourceIp}`, REGISTRATIONS_PER_IP_HOUR, 'Too many new devices from this network. Try again later.');
  }

  const id = randomId(12);
  const now = Date.now();
  for (let attempt = 0; attempt < 5; attempt++) {
    const name = randomName();
    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              // Name reservation enforces uniqueness.
              Put: {
                TableName: env.table,
                Item: { pk: `N#${name}`, sk: 'NAME', deviceId: id },
                ConditionExpression: 'attribute_not_exists(pk)',
              },
            },
            {
              Put: {
                TableName: env.table,
                Item: {
                  pk: `D#${id}`,
                  sk: 'PROFILE',
                  name,
                  usedBytes: 0,
                  createdAt: now,
                  ...(fingerprint ? { fingerprint } : {}),
                  gsi1pk: 'NAME',
                  gsi1sk: name,
                },
              },
            },
          ],
        }),
      );
      const token = await issueToken(id, 'device', device);
      if (deviceKey) {
        await ddb.send(new PutCommand({ TableName: env.table, Item: { ...deviceKey, guestId: id, updatedAt: now } }));
      }
      return json(201, { id, name, token });
    } catch (error: any) {
      if (error?.name === 'TransactionCanceledException') continue; // name taken, retry
      throw error;
    }
  }
  throw new HttpError(503, 'Could not allocate a name, try again');
}

/** The caller's token: `Authorization: Bearer` (apps) or the website's session cookie. */
export function requestToken(req: Req): { token: string; fromCookie: boolean } {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return { token: header.slice(7), fromCookie: false };
  return { token: req.cookies[WEB_COOKIE] ?? '', fromCookie: true };
}

/** Resolves the caller from `Authorization: Bearer <token>` or the website cookie. */
export async function authenticate(req: Req): Promise<Identity> {
  const { token, fromCookie } = requestToken(req);
  // CSRF guard for cookie sessions: changes need our own header, which other
  // sites can't send without a CORS preflight we never allow (SameSite=Strict too).
  if (fromCookie && token && req.method !== 'GET' && req.headers['x-lens-web'] !== '1') {
    throw new HttpError(403, 'Missing request header');
  }
  const [deviceId, tokenId, secret] = token.split('.');
  if (!deviceId || !tokenId || !secret) throw new HttpError(401, 'Missing or malformed token');

  const [tokenItem, profile] = await Promise.all([
    ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${deviceId}`, sk: `T#${tokenId}` } })),
    ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${deviceId}`, sk: 'PROFILE' } })),
  ]);
  if (!tokenItem.Item || !profile.Item || !safeEqual(tokenItem.Item.hash, hashSecret(secret))) {
    throw new HttpError(401, 'Invalid token');
  }
  const now = Date.now();
  if (tokenItem.Item.expiresAt && tokenItem.Item.expiresAt < now) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `D#${deviceId}`, sk: `T#${tokenId}` } }));
    throw new HttpError(401, 'Session expired');
  }
  // Sliding expiry: in use = stays signed in. Written at most once a day per device.
  if (!tokenItem.Item.lastUsedAt || now - tokenItem.Item.lastUsedAt > SESSION_SLIDE_MS) {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${deviceId}`, sk: `T#${tokenId}` },
        UpdateExpression: 'SET lastUsedAt = :n, expiresAt = :e',
        ExpressionAttributeValues: { ':n': now, ':e': now + SESSION_IDLE_MS },
      }),
    );
  }
  return {
    id: deviceId,
    name: profile.Item.name,
    usedBytes: profile.Item.usedBytes ?? 0,
    tokenId,
    email: profile.Item.email,
  };
}

export function me(identity: Identity): Res {
  const { tokenId: _session, ...profile } = identity;
  return json(200, { ...profile, quotaBytes: quotaFor(identity), signedInQuotaBytes: env.quotaBytes });
}

/** GET /v1/users?q=prefix: search identities by name prefix. */
export async function searchUsers(identity: Identity, req: Req): Promise<Res> {
  const q = (req.query.q ?? '').trim().toLowerCase();
  if (q.length < 2) return json(200, { users: [] });
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :p AND begins_with(gsi1sk, :q)',
      ExpressionAttributeValues: { ':p': 'NAME', ':q': q },
      Limit: 20,
    }),
  );
  const users = (result.Items ?? [])
    .map((item) => ({ id: (item.pk as string).slice(2), name: item.name as string }))
    .filter((u) => u.id !== identity.id);
  return json(200, { users });
}

/** GET /v1/contacts: people this identity has shared with, most recent first. */
export async function contacts(identity: Identity): Promise<Res> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :c)',
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':c': 'C#' },
    }),
  );
  const list = (result.Items ?? [])
    .map((item) => ({ id: (item.sk as string).slice(2), name: item.name as string, lastSharedAt: item.lastAt as number }))
    .sort((a, b) => b.lastSharedAt - a.lastSharedAt)
    .slice(0, 50);
  return json(200, { contacts: list });
}

// ---------- Pairing codes (current web sign-in) ----------

const PAIR_TTL_SECONDS = 300;
const PAIR_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const PAIR_LENGTH = 8;

function pairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIR_LENGTH; i++) code += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
  return code;
}

/** POST /v1/pairing: short code that lets the web viewer sign in as this identity. */
export async function createPairing(identity: Identity): Promise<Res> {
  const code = pairingCode();
  const expiresAt = Math.floor(Date.now() / 1000) + PAIR_TTL_SECONDS;
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: { pk: `P#${code}`, sk: 'PAIR', deviceId: identity.id, ttl: expiresAt },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
  return json(201, { code, expiresAt: expiresAt * 1000 });
}

/** POST /v1/pairing/claim {code}: exchanges a pairing code for a web token. */
export async function claimPairing(req: Req): Promise<Res> {
  const code = String(req.body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== PAIR_LENGTH) throw new HttpError(400, `Enter the ${PAIR_LENGTH}-character code`);
  let item: Record<string, any> | undefined;
  try {
    const result = await ddb.send(
      new DeleteCommand({
        TableName: env.table,
        Key: { pk: `P#${code}`, sk: 'PAIR' },
        ConditionExpression: 'attribute_exists(pk) AND #ttl > :now',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':now': Math.floor(Date.now() / 1000) },
        ReturnValues: 'ALL_OLD',
      }),
    );
    item = result.Attributes;
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') throw new HttpError(400, 'Code is invalid or expired');
    throw error;
  }
  const deviceId = item!.deviceId as string;
  // Through the website (/api): the session goes into the HttpOnly cookie.
  if (req.headers['x-lens-web'] === '1') return webSignIn(deviceId, req);
  const profile = await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${deviceId}`, sk: 'PROFILE' } }));
  const token = await issueToken(deviceId, 'web');
  return json(200, { id: deviceId, name: profile.Item!.name, token });
}

// ---------- QR sign-in for the website (WhatsApp Web style) ----------
// 1. Browser: POST /login-sessions -> {id, secret}; shows a QR containing id.
// 2. Phone (signed in) scans it: GET /login-sessions/:id/info, then POST .../approve
//    (or .../deny).
// 3. Browser polls GET /login-sessions/:id with its secret; once approved it
//    gets its session (exactly once, as the HttpOnly cookie) and the request is deleted.

const LOGIN_TTL_SECONDS = 120;
const SESSION_ID = /^[A-Za-z0-9_-]{16,32}$/;

function sessionKey(id: string) {
  if (!SESSION_ID.test(id)) throw new HttpError(400, 'Invalid session');
  return { pk: `L#${id}`, sk: 'LOGIN' };
}

function describeBrowser(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'A browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(userAgent) && !/iPhone|iPad/.test(userAgent)
      ? 'Mac'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Android/.test(userAgent)
          ? 'Android'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'an unknown system';
  return `${browser} on ${os}`;
}

/** POST /v1/login-sessions (public): a browser asks to be signed in. */
export async function createLoginSession(req: Req): Promise<Res> {
  // Loose per-network brake (CGNAT-safe): a QR refreshes about every 2 minutes.
  if (req.sourceIp) await rateLimit(`qr#${req.sourceIp}`, 600, 'Too many sign-in attempts from this network. Try again later.');
  const id = randomId(16);
  const secret = randomId(24);
  const expiresAt = Math.floor(Date.now() / 1000) + LOGIN_TTL_SECONDS;
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: {
        ...sessionKey(id),
        secretHash: hashSecret(secret),
        browser: describeBrowser(req.headers['user-agent'] ?? ''),
        ...(req.city ? { city: req.city.slice(0, 60) } : {}),
        status: 'waiting',
        ttl: expiresAt,
      },
    }),
  );
  return json(201, { id, secret, expiresAt: expiresAt * 1000 });
}

async function liveSession(id: string): Promise<Record<string, any>> {
  const result = await ddb.send(new GetCommand({ TableName: env.table, Key: sessionKey(id) }));
  const item = result.Item;
  if (!item || item.ttl < Math.floor(Date.now() / 1000)) throw new HttpError(404, 'This QR code has expired. Refresh it on the website.');
  return item;
}

/** GET /v1/login-sessions/:id/info (phone): what is asking to sign in. */
export async function loginSessionInfo(id: string): Promise<Res> {
  const item = await liveSession(id);
  return json(200, { browser: item.browser, city: item.city, status: item.status });
}

/** POST /v1/login-sessions/:id/deny (phone): "that wasn't me". */
export async function denyLoginSession(identity: Identity, id: string): Promise<Res> {
  await liveSession(id);
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: sessionKey(id),
      UpdateExpression: 'SET #s = :denied',
      ConditionExpression: '#s = :waiting',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':denied': 'denied', ':waiting': 'waiting' },
    }),
  ).catch(() => undefined);
  return json(200, { denied: true, by: identity.name });
}

/** POST /v1/login-sessions/:id/approve (phone): sign that browser in as me. */
export async function approveLoginSession(identity: Identity, id: string): Promise<Res> {
  await liveSession(id);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: sessionKey(id),
        UpdateExpression: 'SET #s = :approved, deviceId = :d',
        ConditionExpression: '#s = :waiting',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':approved': 'approved', ':waiting': 'waiting', ':d': identity.id },
      }),
    );
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') throw new HttpError(409, 'This QR code was already used.');
    throw error;
  }
  return json(200, { approved: true });
}

/** GET /v1/login-sessions/:id (browser, with x-login-secret): poll for approval. */
export async function pollLoginSession(req: Req, id: string): Promise<Res> {
  const item = await liveSession(id);
  const secret = req.headers['x-login-secret'] ?? '';
  if (!safeEqual(item.secretHash, hashSecret(secret))) throw new HttpError(403, 'Not your session');
  if (item.status === 'denied') return json(200, { status: 'denied' });
  if (item.status !== 'approved') return json(200, { status: 'waiting' });

  // Hand out the token exactly once.
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: env.table,
        Key: sessionKey(id),
        ConditionExpression: '#s = :approved',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':approved': 'approved' },
      }),
    );
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') throw new HttpError(409, 'Already signed in');
    throw error;
  }
  return webSignIn(item.deviceId as string, req, { status: 'approved' });
}

/** GET /v1/web-sessions (phone): browsers signed in as me. */
export async function listWebSessions(identity: Identity): Promise<Res> {
  const tokens = await webTokens(identity.id);
  return json(200, {
    sessions: tokens.map((t) => ({ id: (t.sk as string).slice(2), browser: t.browser ?? 'Browser', createdAt: t.createdAt })),
  });
}

/** DELETE /v1/web-sessions (phone): sign out every browser. */
export async function revokeWebSessions(identity: Identity): Promise<Res> {
  const tokens = await webTokens(identity.id);
  for (const t of tokens) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: t.pk, sk: t.sk } }));
  }
  return json(200, { revoked: tokens.length });
}

/** DELETE /v1/web-sessions/current (browser): sign this browser out and clear the cookie. */
export async function signOutCurrent(req: Req): Promise<Res> {
  const [deviceId, tokenId] = requestToken(req).token.split('.');
  if (deviceId && tokenId) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `D#${deviceId}`, sk: `T#${tokenId}` } }));
  }
  return withCookies(json(200, { signedOut: true }), [clearedCookie()]);
}

async function webTokens(deviceId: string) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :t)',
      FilterExpression: '#l = :web',
      ExpressionAttributeNames: { '#l': 'label' },
      ExpressionAttributeValues: { ':p': `D#${deviceId}`, ':t': 'T#', ':web': 'web' },
    }),
  );
  return result.Items ?? [];
}
