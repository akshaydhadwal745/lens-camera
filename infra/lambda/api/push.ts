import { createHash, createSign } from 'node:crypto';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, env, getParam, HttpError, json, Req, Res } from './lib';

// Push notifications through Firebase Cloud Messaging (HTTP v1), sent straight
// from this API: no third-party push service. The Firebase service-account key
// lives in SSM (/lens/fcm/service-account); without it, notify() does nothing.
// Records: D#<id> PUSH#<sha256(token)> { token, platform, tz, updatedAt } and
// D#<id> NOTIFY { <category>: boolean } (missing = on).
//
// Three kinds of notifications (docs/design/notifications.md):
//  - event: something happened for you right now (a share, a friend joined): sent at once;
//  - lifecycle: useful reminders (weekly summary, memories, recap ready, welcome ending);
//  - campaign: written in the Lens Console.
// Lifecycle and campaign ones respect quiet hours (sent 9:00–21:00 on the phone's clock), at most
// 2 a day, and News at most 1 a week. 'account' notices (welcome ending, backups paused) can't be
// turned off in the app because they're about your storage; everything else can.

export type Category = 'shares' | 'invites' | 'storage' | 'memories' | 'summary' | 'news' | 'account';
const CATEGORIES: Category[] = ['shares', 'invites', 'storage', 'memories', 'summary', 'news'];
/** Lifecycle + campaign notifications per person per day, and News per week. */
const DAILY_CAP = 2;
const NEWS_WEEKLY_CAP = 1;
/** Phones that never told us their time zone: India (+5:30). */
const DEFAULT_TZ_MIN = 330;
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
  return { ...(Object.fromEntries(CATEGORIES.map((c) => [c, item[c] !== false])) as Record<Category, boolean>), account: true };
}

type Device = { pk: string; sk: string; token: string; tz?: number };

async function devicesOf(id: string): Promise<Device[]> {
  const r = await ddb.send(
    new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': `D#${id}`, ':s': 'PUSH#' } }),
  );
  return (r.Items ?? []) as Device[];
}

/** The phone's local hour now (its saved UTC offset, else India). */
export function localHour(tzMin: number | undefined, now = Date.now()): number {
  return new Date(now + (tzMin ?? DEFAULT_TZ_MIN) * 60_000).getUTCHours();
}

type Payload = { title: string; body: string; route?: string };

/** FCM to every phone of this account. Returns how many accepted it. */
async function sendToDevices(id: string, category: Category, message: Payload, data: Record<string, string> = {}): Promise<{ sent: number; failed: number; devices: number }> {
  const sa = await serviceAccount();
  if (!sa) return { sent: 0, failed: 0, devices: 0 };
  const devices = await devicesOf(id);
  if (!devices.length) return { sent: 0, failed: 0, devices: 0 };
  const bearer = await fcmToken(sa);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    devices.map(async (d) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: d.token,
            notification: { title: message.title, body: message.body },
            data: { route: message.route ?? '/', category, ...data },
            android: { priority: 'HIGH', notification: { channel_id: category } },
          },
        }),
      });
      if (res.ok) sent++;
      else {
        failed++;
        // The app was uninstalled or the token rotated: forget it.
        if (res.status === 404 || res.status === 400) {
          const text = await res.text();
          if (/UNREGISTERED|INVALID_ARGUMENT|registration-token-not-registered/.test(text)) {
            await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: d.pk, sk: d.sk } }));
          }
        }
      }
    }),
  );
  return { sent, failed, devices: devices.length };
}

export type DeliveryResult = 'sent' | 'failed' | 'no-device' | 'off' | 'capped' | 'quiet';

const isoWeek = (t: number) => {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round((d.getTime() - firstThursday.getTime()) / 604_800_000)).padStart(2, '0')}`;
};

/** Counts one more lifecycle/campaign notification; false if that would pass a limit. */
async function takeCap(id: string, category: Category, now: number): Promise<boolean> {
  const day = new Date(now).toISOString().slice(0, 10);
  const ttl = Math.floor(now / 1000) + 10 * 86400;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `NCAP#${id}`, sk: `D#${day}` },
        UpdateExpression: 'ADD #c :one SET #t = :ttl',
        ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
        ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':max': DAILY_CAP, ':ttl': ttl },
      }),
    );
    if (category === 'news') {
      await ddb.send(
        new UpdateCommand({
          TableName: env.table,
          Key: { pk: `NCAP#${id}`, sk: `W#${isoWeek(now)}` },
          UpdateExpression: 'ADD #c :one SET #t = :ttl',
          ConditionExpression: 'attribute_not_exists(#c) OR #c < :max',
          ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
          ExpressionAttributeValues: { ':one': 1, ':max': NEWS_WEEKLY_CAP, ':ttl': ttl },
        }),
      );
    }
    return true;
  } catch (e) {
    if ((e as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

/**
 * A lifecycle or campaign notification: preferences, quiet hours (9:00–21:00 on the phone), daily
 * and weekly limits ('account' notices skip the limits but not quiet hours). `data` is echoed back by
 * the app when it's opened (POST /v1/notifications/opened), for open rates.
 */
export async function deliver(
  id: string,
  category: Category,
  message: Payload,
  opts: { data?: Record<string, string>; now?: number; ignoreQuiet?: boolean } = {},
): Promise<DeliveryResult> {
  const now = opts.now ?? Date.now();
  try {
    if (!(await prefs(id))[category]) return 'off';
    const devices = await devicesOf(id);
    if (!devices.length) return 'no-device';
    const hour = localHour(devices[0].tz, now);
    if (!opts.ignoreQuiet && (hour < 9 || hour >= 21)) return 'quiet';
    if (category !== 'account' && !(await takeCap(id, category, now))) return 'capped';
    const r = await sendToDevices(id, category, message, opts.data);
    return r.sent > 0 ? 'sent' : 'failed';
  } catch (e) {
    console.warn('deliver failed', category, (e as Error).message);
    return 'failed';
  }
}

/**
 * Sends a notification to every phone of this identity, if they allow the
 * category. Never throws: a failed notification must not fail the action.
 * `route` is where tapping it opens in the app.
 */
export async function notify(id: string, category: Category, message: Payload): Promise<void> {
  try {
    if (!(await prefs(id))[category]) return;
    await sendToDevices(id, category, message, { kind: 'event' });
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
    new PutCommand({
      TableName: env.table,
      Item: {
        ...tokenKey(identity.id, token),
        token,
        platform: String(req.body?.platform ?? 'android').slice(0, 16),
        // Minutes east of UTC, for quiet hours (older apps don't send it: India is assumed).
        ...(Number.isInteger(req.body?.tz) && Math.abs(req.body.tz) <= 14 * 60 ? { tz: req.body.tz } : {}),
        updatedAt: Date.now(),
      },
    }),
  );
  return json(200, { ok: true });
}

/** DELETE /v1/push {token}: sign-out on this phone. */
export async function unregisterPush(identity: Identity, req: Req): Promise<Res> {
  const token = checkToken(req.body?.token);
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: tokenKey(identity.id, token) }));
  return json(200, { ok: true });
}

/** GET /v1/notifications → { shares, invites, storage, memories, summary, news }; PUT to change. */
export async function notificationPrefs(identity: Identity, req: Req): Promise<Res> {
  const { account: _always, ...current } = await prefs(identity.id);
  if (req.method === 'PUT') {
    for (const c of CATEGORIES) if (typeof req.body?.[c] === 'boolean') current[c as keyof typeof current] = req.body[c];
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `D#${identity.id}`, sk: 'NOTIFY', ...current, updatedAt: Date.now() } }));
    // Opt-outs per category, for the console (counts only).
    for (const c of CATEGORIES) {
      if (req.body?.[c] === false) await bumpStat(`optout#${c}`, Date.now());
    }
  }
  return json(200, current);
}

/** Daily counters for the console: NSTAT  <day>#<name> { count }. */
export async function bumpStat(name: string, now: number, n = 1) {
  const day = new Date(now).toISOString().slice(0, 10);
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: 'NSTAT', sk: `${day}#${name}` },
      UpdateExpression: 'ADD #c :n SET #t = :ttl',
      ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
      ExpressionAttributeValues: { ':n': n, ':ttl': Math.floor(now / 1000) + 400 * 86400 },
    }),
  );
}

/** POST /v1/notifications/opened {campaign?, lifecycle?}: the app reports a tapped notification. */
export async function notificationOpened(_identity: Identity, req: Req): Promise<Res> {
  const now = Date.now();
  const campaign = typeof req.body?.campaign === 'string' && /^[A-Za-z0-9_-]{6,30}$/.test(req.body.campaign) ? req.body.campaign : null;
  const lifecycle = typeof req.body?.lifecycle === 'string' && /^[a-z_]{3,30}$/.test(req.body.lifecycle) ? req.body.lifecycle : null;
  if (campaign) {
    await ddb
      .send(
        new UpdateCommand({
          TableName: env.table,
          Key: { pk: `CAMPAIGN#${campaign}`, sk: 'META' },
          UpdateExpression: 'ADD stats.opened :one',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: { ':one': 1 },
        }),
      )
      .catch(() => {});
  }
  if (lifecycle) await bumpStat(`opened#${lifecycle}`, now);
  return json(200, { ok: true });
}
