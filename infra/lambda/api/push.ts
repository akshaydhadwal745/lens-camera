import { createHash, createSign } from 'node:crypto';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, env, getParam, HttpError, json, Req, Res } from './lib';

// Push notifications through Firebase Cloud Messaging (HTTP v1), sent straight
// from this API: no third-party push service. The Firebase service-account key
// lives in SSM (/lens/fcm/service-account); without it, notify() does nothing.
// Records: D#<id> PUSH#<sha256(token)> { token, platform, updatedAt } and
// D#<id> NOTIFY { shares, invites, storage } (missing = on).

export type Category = 'shares' | 'invites' | 'storage';
const CATEGORIES: Category[] = ['shares', 'invites', 'storage'];
const MAX_TOKENS = 10;

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
let account: ServiceAccount | null | undefined;
let accessToken: { value: string; expires: number } | undefined;

async function serviceAccount(): Promise<ServiceAccount | null> {
  if (account !== undefined) return account;
  const raw = await getParam('/lens/fcm/service-account').catch(() => undefined);
  account = raw ? (JSON.parse(raw) as ServiceAccount) : null;
  return account;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** OAuth access token for FCM from the service account (signed JWT → token, cached ~55 min). */
async function fcmToken(sa: ServiceAccount): Promise<string> {
  if (accessToken && accessToken.expires > Date.now() + 60_000) return accessToken.value;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claims}.${signature}` }),
  });
  if (!res.ok) throw new Error(`FCM auth ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function prefs(id: string): Promise<Record<Category, boolean>> {
  const item = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'NOTIFY' } }))).Item ?? {};
  return Object.fromEntries(CATEGORIES.map((c) => [c, item[c] !== false])) as Record<Category, boolean>;
}

/**
 * Sends a notification to every phone of this identity, if they allow the
 * category. Never throws: a failed notification must not fail the action.
 * `route` is where tapping it opens in the app.
 */
export async function notify(id: string, category: Category, message: { title: string; body: string; route?: string }): Promise<void> {
  try {
    const sa = await serviceAccount();
    if (!sa) return;
    if (!(await prefs(id))[category]) return;
    const devices = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
        ExpressionAttributeValues: { ':p': `D#${id}`, ':s': 'PUSH#' },
      }),
    );
    if (!devices.Items?.length) return;
    const bearer = await fcmToken(sa);
    await Promise.all(
      devices.Items.map(async (d) => {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
          method: 'POST',
          headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: d.token,
              notification: { title: message.title, body: message.body },
              data: { route: message.route ?? '/', category },
              android: { priority: 'HIGH', notification: { channel_id: category } },
            },
          }),
        });
        // The app was uninstalled or the token rotated: forget it.
        if (res.status === 404 || res.status === 400) {
          const text = await res.text();
          if (/UNREGISTERED|INVALID_ARGUMENT|registration-token-not-registered/.test(text)) {
            await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: d.pk, sk: d.sk } }));
          }
        }
      }),
    );
  } catch (e) {
    console.warn('notify failed', category, (e as Error).message);
  }
}

const tokenKey = (id: string, token: string) => ({ pk: `D#${id}`, sk: `PUSH#${createHash('sha256').update(token).digest('hex').slice(0, 32)}` });

function checkToken(token: unknown): string {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) throw new HttpError(400, 'Invalid push token');
  return token;
}

/** PUT /v1/push {token, platform}: this phone's FCM token (registered after sign-in changes too). */
export async function registerPush(identity: Identity, req: Req): Promise<Res> {
  const token = checkToken(req.body?.token);
  const existing = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':s': 'PUSH#' },
    }),
  );
  // Oldest out beyond MAX_TOKENS (phones replaced over the years).
  const items = (existing.Items ?? []).sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  for (const old of items.slice(0, Math.max(0, items.length - MAX_TOKENS + 1))) {
    if (old.token !== token) await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: old.pk, sk: old.sk } }));
  }
  await ddb.send(
    new PutCommand({ TableName: env.table, Item: { ...tokenKey(identity.id, token), token, platform: String(req.body?.platform ?? 'android').slice(0, 16), updatedAt: Date.now() } }),
  );
  return json(200, { ok: true });
}

/** DELETE /v1/push {token}: sign-out on this phone. */
export async function unregisterPush(identity: Identity, req: Req): Promise<Res> {
  const token = checkToken(req.body?.token);
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: tokenKey(identity.id, token) }));
  return json(200, { ok: true });
}

/** GET /v1/notifications → { shares, invites, storage }; PUT with any of them to change. */
export async function notificationPrefs(identity: Identity, req: Req): Promise<Res> {
  const current = await prefs(identity.id);
  if (req.method === 'PUT') {
    for (const c of CATEGORIES) if (typeof req.body?.[c] === 'boolean') current[c] = req.body[c];
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `D#${identity.id}`, sk: 'NOTIFY', ...current } }));
  }
  return json(200, current);
}
