// Google Search Console → our table, daily (docs/growth/growth-engine.md M5). Google keeps 16 months
// of search data; we keep our own copy for the growth analyst and the Console's Growth page.
//   SSM /lens/growth/service-account   JSON key of growth-analyst@…, an owner of the Search Console property
//   GSC#<YYYY-MM-DD>  q#<query> | p#<path> | c#<country> | d#<device> | total  → { clicks, impressions, position }
// Search data is final about 3 days later, so each run re-reads the last 5 days (idempotent PUTs).
// No Google SDK: a signed JWT for the access token and plain fetch, like the FCM sender.
import { createSign } from 'node:crypto';

import { BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam } from './lib';

const SITE = 'https://lens.instagrowapp.com/';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const DAY = 86_400_000;
const KEEP_SECONDS = 3 * 365 * 86_400;
const ROWS_PER_DIMENSION = 1000;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Access token for the growth-analyst service account (undefined until its key is in SSM). */
export async function googleToken(scope = SCOPE): Promise<string | undefined> {
  const raw = await getParam('/lens/growth/service-account');
  if (!raw) return undefined;
  const key = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const now = Math.floor(Date.now() / 1000);
  const aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: key.client_email, scope, aud, iat: now, exp: now + 3600 }))}`;
  const assertion = `${unsigned}.${b64url(createSign('RSA-SHA256').update(unsigned).sign(key.private_key))}`;
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!data.access_token) throw new Error(`search console token ${res.status}`);
  return data.access_token;
}

type ApiRow = { keys?: string[]; clicks: number; impressions: number; position: number };

async function query(token: string, day: string, dimension?: string): Promise<ApiRow[]> {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ startDate: day, endDate: day, ...(dimension ? { dimensions: [dimension] } : {}), rowLimit: ROWS_PER_DIMENSION, dataState: 'all' }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`search console query ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { rows?: ApiRow[] }).rows ?? [];
}

/** Path of a result URL on our site, or the full URL for anything else. */
export const pathOf = (url: string) => (url.startsWith(SITE) ? `/${url.slice(SITE.length)}` : url);

/** The rows to store for one day (pure: tested in search-console.test.ts). */
export function rowsForDay(day: string, results: Record<'total' | 'q' | 'p' | 'c' | 'd', ApiRow[]>, ttl: number) {
  const item = (sk: string, r: ApiRow) => ({
    pk: `GSC#${day}`,
    sk: sk.slice(0, 900),
    clicks: r.clicks,
    impressions: r.impressions,
    position: Math.round(r.position * 10) / 10,
    ttl,
  });
  return [
    ...results.total.map((r) => item('total', r)),
    ...results.q.map((r) => item(`q#${r.keys?.[0] ?? ''}`, r)),
    ...results.p.map((r) => item(`p#${pathOf(r.keys?.[0] ?? '')}`, r)),
    ...results.c.map((r) => item(`c#${r.keys?.[0] ?? ''}`, r)),
    ...results.d.map((r) => item(`d#${r.keys?.[0] ?? ''}`, r)),
  ];
}

/** Daily: the last 5 days from Search Console into GSC# rows. Returns rows written, or why it skipped. */
export async function pullSearchConsole(now = Date.now()): Promise<number | string> {
  const token = await googleToken();
  if (!token) return 'not set up';
  const ttl = Math.floor(now / 1000) + KEEP_SECONDS;
  let written = 0;
  for (let back = 5; back >= 1; back--) {
    const day = new Date(now - back * DAY).toISOString().slice(0, 10);
    const [total, q, p, c, d] = await Promise.all([query(token, day), query(token, day, 'query'), query(token, day, 'page'), query(token, day, 'country'), query(token, day, 'device')]);
    const items = rowsForDay(day, { total, q, p, c, d }, ttl);
    for (let i = 0; i < items.length; i += 25) {
      let batch: Record<string, unknown>[] = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
      for (let attempt = 0; batch.length && attempt < 5; attempt++) {
        const r = await ddb.send(new BatchWriteCommand({ RequestItems: { [env.table]: batch } }));
        batch = (r.UnprocessedItems?.[env.table] as Record<string, unknown>[] | undefined) ?? [];
      }
    }
    written += items.length;
  }
  return written;
}

/** Google's index status for each URL in our sitemap (URL Inspection API, 2,000 a day; we use ~70 a week). */
export async function indexCoverage(): Promise<{ urls: number; indexed: number; states: Record<string, number>; notIndexed: string[] } | undefined> {
  const token = await googleToken();
  if (!token) return undefined;
  const xml = async (url: string) => (await (await fetch(url, { signal: AbortSignal.timeout(15_000) })).text()).match(/<loc>(.*?)<\/loc>/g)?.map((l) => l.slice(5, -6)) ?? [];
  const urls: string[] = [];
  for (const map of await xml(`${SITE}sitemap-index.xml`)) urls.push(...(await xml(map)));
  const states: Record<string, number> = {};
  const notIndexed: string[] = [];
  let indexed = 0;
  const inspect = async (url: string) => {
    const res = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ inspectionUrl: url, siteUrl: SITE }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`url inspection ${res.status}`);
    const r = ((await res.json()) as { inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string } } }).inspectionResult?.indexStatusResult;
    const state = r?.coverageState ?? 'unknown';
    states[state] = (states[state] ?? 0) + 1;
    if (r?.verdict === 'PASS') indexed++;
    else notIndexed.push(pathOf(url));
  };
  // 8 at a time: Google allows 600 a minute; one by one took minutes.
  for (let i = 0; i < urls.length; i += 8) await Promise.all(urls.slice(i, i + 8).map(inspect));
  return { urls: urls.length, indexed, states, notIndexed };
}
