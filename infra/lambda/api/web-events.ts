// Website analytics, our own (no third party, no cookies, no visitor IDs): the site sends one small
// event per page view and per important click (site/src/scripts/beacon.ts); we keep daily totals only:
//   WSTAT#<YYYY-MM-DD>  pv#<path> | visit | src#<source> | ev#<event> | evp#<event>#<path>  → { count }
//   first page of a visit: land#<path> | med#<utm_medium> | camp#<utm_campaign> | cty#<country> | dev#<mobile|tablet|desktop>
//   engaged visits (2+ pages or 10 s): engv | engl#<landing path>; clicks by landing page: evl#<event>#<landing path>
//   when a page is left: tv#<path> (views timed), tsum#<path> (seconds visible), eng#<path> (≥10 s), sc75#<path> (scrolled ≥75 %)
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

const tag = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40) : '');

/** Phone, tablet or computer from the browser's user agent (nothing else is kept). */
export function deviceOf(ua: string): 'mobile' | 'tablet' | 'desktop' {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

async function bump(day: string, key: string, now: number, by = 1) {
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `WSTAT#${day}`, sk: key },
      UpdateExpression: 'ADD #c :one SET #t = :ttl',
      ExpressionAttributeNames: { '#c': 'count', '#t': 'ttl' },
      ExpressionAttributeValues: { ':one': by, ':ttl': Math.floor(now / 1000) + KEEP_SECONDS },
    }),
  );
}

/** The counters one beacon adds (pure: tested in web-events.test.ts). */
export function countersFor(body: Record<string, unknown>, meta: { ua: string; country?: string }): [string, number][] {
  const path = cleanPath(body.p);
  if (!path) return [];
  const landing = cleanPath(body.l) ?? path;
  if (body.x === 'engaged') return [['engv', 1], [`engl#${landing}`, 1]];
  if (body.x === 'end') {
    const t = typeof body.t === 'number' && Number.isFinite(body.t) ? Math.max(0, Math.min(1800, Math.round(body.t))) : 0;
    const sc = typeof body.sc === 'number' ? body.sc : 0;
    return [[`tv#${path}`, 1], [`tsum#${path}`, t], ...(t >= 10 ? ([[`eng#${path}`, 1]] as [string, number][]) : []), ...(sc >= 75 ? ([[`sc75#${path}`, 1]] as [string, number][]) : [])];
  }
  const event = typeof body.e === 'string' && EVENTS.has(body.e) ? body.e : null;
  if (event) return [[`ev#${event}`, 1], [`evp#${event}#${path}`, 1], [`evl#${event}#${landing}`, 1]];
  const out: [string, number][] = [[`pv#${path}`, 1]];
  if (body.v === 1) {
    out.push(['visit', 1], [`src#${cleanSource(body.s, body.r)}`, 1], [`land#${path}`, 1], [`dev#${deviceOf(meta.ua)}`, 1], [`cty#${meta.country ?? 'unknown'}`, 1]);
    if (tag(body.m)) out.push([`med#${tag(body.m)}`, 1]);
    if (tag(body.c)) out.push([`camp#${tag(body.c)}`, 1]);
  }
  return out;
}

/** POST /v1/web-events {p, v?, r?, s?, m?, c?, e?, l?, x?, t?, sc?}: public; counts only. */
export async function webEvent(req: Req): Promise<Res> {
  if (BOT.test(req.headers['user-agent'] ?? '')) return none;
  if (req.sourceIp) {
    try {
      await rateLimit(`web-ev#${req.sourceIp}`, 600);
    } catch {
      return none; // too many from one address: not counted
    }
  }
  const counters = countersFor((req.body ?? {}) as Record<string, unknown>, { ua: req.headers['user-agent'] ?? '', country: req.country });
  if (!counters.length) return none;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  await Promise.all(counters.filter(([, n]) => n > 0).map(([k, n]) => bump(day, k, now, n)));
  return none;
}
