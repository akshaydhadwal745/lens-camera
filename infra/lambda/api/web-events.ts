// Website analytics, our own (no third party, no cookies, no visitor IDs): the site sends one small
// event per page view and per important click (site/src/scripts/beacon.ts); we keep daily totals only:
//   WSTAT#<YYYY-MM-DD>  pv#<path> | visit | src#<source> | ev#<event> | evp#<event>#<path>  → { count }
// Addresses with private parts (share links, event codes, invites) are cut to their prefix.
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, rateLimit, Req, Res } from './lib';

const none: Res = { statusCode: 204, headers: { 'cache-control': 'no-store' } };

const KEEP_SECONDS = 400 * 86400;
const EVENTS = new Set(['get_lens', 'apk_download', 'play_store', 'signin', 'contact_sent', 'web_app', 'invite_open', 'event_add']);
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|preview|headless|lighthouse|pingdom|monitor/i;
const PRIVATE = /^\/(hi\/)?(s|e|u|l|r|go|qr-card)\//;

function cleanPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.length > 200) return null;
  let p = raw.split(/[?#]/)[0].replace(/\/+$/, '/') || '/';
  if (!p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p)) p += '/';
  const m = PRIVATE.exec(p);
  if (m) p = `/${m[1] ?? ''}${m[2]}/`;
  return /^[\w\-/.]+$/.test(p) ? p.slice(0, 120) : null;
}

function cleanSource(utm: unknown, ref: unknown): string {
  const u = typeof utm === 'string' ? utm.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40) : '';
  if (u) return u;
  if (typeof ref !== 'string' || !ref) return 'direct';
  try {
    const host = new URL(ref).hostname.replace(/^www\./, '').toLowerCase();
    if (env.webOrigin && host === new URL(env.webOrigin).hostname) return 'internal';
    return host.slice(0, 60) || 'direct';
  } catch {
    return 'direct';
  }
}

async function bump(day: string, key: string, now: number) {
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `WSTAT#${day}`, sk: key },
      UpdateExpression: 'ADD #c :one SET #t = :ttl',
      ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
      ExpressionAttributeValues: { ':one': 1, ':ttl': Math.floor(now / 1000) + KEEP_SECONDS },
    }),
  );
}

/** POST /v1/web-events {p, r?, s?, e?, v?}: public; counts only. */
export async function webEvent(req: Req): Promise<Res> {
  if (BOT.test(req.headers['user-agent'] ?? '')) return none;
  if (req.sourceIp) {
    try {
      await rateLimit(`web-ev#${req.sourceIp}`, 600);
    } catch {
      return none; // too many from one address: not counted
    }
  }
  const path = cleanPath(req.body?.p);
  if (!path) return none;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const event = typeof req.body?.e === 'string' && EVENTS.has(req.body.e) ? req.body.e : null;
  const writes = event ? [bump(day, `ev#${event}`, now), bump(day, `evp#${event}#${path}`, now)] : [bump(day, `pv#${path}`, now)];
  // First page of a visit (the browser tab's session): where it came from.
  if (!event && req.body?.v === 1) writes.push(bump(day, 'visit', now), bump(day, `src#${cleanSource(req.body?.s, req.body?.r)}`, now));
  await Promise.all(writes);
  return none;
}
