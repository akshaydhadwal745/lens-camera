// Free demand and interest sources for the growth analyst (docs/growth/growth-intelligence.md §8).
// Plain fetch, no AWS: used by the weekly facts (growth.ts) and by the analyst's tools (growth-mcp.ts).
//   Bing Webmaster keyword research  real weekly searches on Bing per keyword and country (absolute, Bing only)
//   Wikipedia pageviews              long-term interest in a topic (absolute views of its article)
//   Google Trends "Trending now"     what is spiking in a country today (official public RSS)
//   GA4 Data API                     what website visitors do (with consent where required)
// Google Trends itself (relative interest) joins when the alpha API is granted. Never mix the scales:
// Bing searches, Wikipedia views and Trends interest are different measures and are labelled as such.

/** Topics we always track: the problems Lens solves, in the words people search with. */
export const SEED_KEYWORDS = [
  'photo backup',
  'free cloud storage',
  'google photos alternative',
  'phone storage full',
  'free up space on phone',
  'backup photos from phone',
  'share full quality photos',
  'whatsapp photo quality',
  'wedding photo sharing',
  'event photo sharing qr code',
  'shared photo album',
  'travel photo backup',
  // What people actually type (Bing related searches, 30 Oct 2026): real volume, unlike several above.
  'backup photos',
  'photo storage',
  'cloud storage for photos',
  'wedding photos',
  'google photos storage full',
] as const;

/** Wikipedia articles that move with interest in our space (English Wikipedia). */
export const WIKI_ARTICLES = ['Google_Photos', 'Cloud_storage', 'Photo_sharing', 'Backup', 'File_hosting_service', 'Wedding_photography', 'Image_hosting_service', 'Digital_photography'] as const;

/** A trending search is worth a look only if it touches our space. */
export const RELEVANT = /photo|camera|storage|backup|cloud|gallery|google photos|icloud|whatsapp|instagram|wedding|shaadi|album|selfie|iphone|pixel|samsung|android|memory|drive|terabox|jio ?cloud/i;

const BING = 'https://ssl.bing.com/webmaster/api.svc/json';
const UA = 'LensGrowth/1.0 (https://lens.instagrowapp.com; growth analyst)';
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  // Never echo the URL: Bing's carries the API key.
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

const bingDate = (t: number) => `${iso(t)}T00:00:00Z`;
const MARKETS: Record<string, string> = { in: 'en-IN', us: 'en-US', gb: 'en-GB', id: 'en-ID', ph: 'en-PH', br: 'pt-BR' };

/** Bing searches for one keyword in a country over [from, to): exact and broad match. */
export async function bingKeyword(key: string, keyword: string, country: string, from: number, to: number): Promise<{ exact: number; broad: number }> {
  const c = country.toLowerCase();
  const q = new URLSearchParams({ q: keyword, country: c, language: MARKETS[c] ?? 'en-US', startDate: bingDate(from), endDate: bingDate(to), apikey: key });
  const d = (await getJson(`${BING}/GetKeyword?${q}`)).d as { Impressions?: number; BroadImpressions?: number } | null;
  return { exact: d?.Impressions ?? 0, broad: d?.BroadImpressions ?? 0 };
}

/** The last 12 weeks against the 12 before: absolute searches and direction. */
export async function bingTrend(key: string, keyword: string, country: string, now = Date.now()) {
  const end = now - 2 * DAY; // Bing lags a couple of days
  const [cur, prev] = [await bingKeyword(key, keyword, country, end - 84 * DAY, end), await bingKeyword(key, keyword, country, end - 168 * DAY, end - 84 * DAY)];
  return { keyword, country: country.toLowerCase(), last12Weeks: cur.broad, previous12Weeks: prev.broad, exactLast12Weeks: cur.exact, change: prev.broad ? (cur.broad - prev.broad) / prev.broad : null };
}

/** Searches related to a keyword on Bing (what else people type), biggest first. */
export async function bingRelated(key: string, keyword: string, country: string, now = Date.now()) {
  const c = country.toLowerCase();
  const q = new URLSearchParams({ q: keyword, country: c, language: MARKETS[c] ?? 'en-US', startDate: bingDate(now - 86 * DAY), endDate: bingDate(now - 2 * DAY), apikey: key });
  const rows = ((await getJson(`${BING}/GetRelatedKeywords?${q}`)).d ?? []) as { Query: string; Impressions: number; BroadImpressions: number }[];
  return rows
    .map((r) => ({ query: r.Query, searches12Weeks: r.BroadImpressions, exact12Weeks: r.Impressions }))
    .sort((a, b) => b.searches12Weeks - a.searches12Weeks)
    .slice(0, 30);
}

/** Monthly English Wikipedia views of an article for the last 24 months (people, not bots). */
export async function wikiViews(article: string, now = Date.now()): Promise<{ month: string; views: number }[]> {
  const d = new Date(now);
  const end = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}0100`;
  const s = new Date(Date.UTC(d.getUTCFullYear() - 2, d.getUTCMonth(), 1));
  const start = `${s.getUTCFullYear()}${String(s.getUTCMonth() + 1).padStart(2, '0')}0100`;
  const r = await getJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article)}/monthly/${start}/${end}`);
  return ((r.items ?? []) as { timestamp: string; views: number }[]).map((i) => ({ month: `${i.timestamp.slice(0, 4)}-${i.timestamp.slice(4, 6)}`, views: i.views }));
}

/** Last 3 full months against the same 3 months a year before (seasonality-safe direction). */
export function wikiTrend(article: string, months: { month: string; views: number }[]) {
  const full = months.slice(0, -1).slice(-15); // drop the current partial month
  const last3 = full.slice(-3);
  const yearAgo = full.slice(0, 3);
  const sum = (m: { views: number }[]) => m.reduce((s, x) => s + x.views, 0);
  const cur = sum(last3);
  const prev = sum(yearAgo);
  return { article, last3Months: cur, sameMonthsYearBefore: full.length >= 15 ? prev : null, change: full.length >= 15 && prev ? (cur - prev) / prev : null, months: last3.map((m) => m.month) };
}

/** Google Trends "Trending now" for a country (official RSS), with the relevant ones marked. */
export async function trendingNow(geo: string): Promise<{ title: string; traffic: string; relevant: boolean; news: string[] }[]> {
  const res = await fetch(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo.toUpperCase())}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`trends.google.com ${res.status}`);
  return parseTrending(await res.text());
}

const unescape = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

export function parseTrending(xml: string) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const item = m[1];
    const title = unescape(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const news = [...item.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)].map((n) => unescape(n[1])).slice(0, 3);
    return { title, traffic: unescape(item.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/)?.[1] ?? ''), relevant: RELEVANT.test(`${title} ${news.join(' ')}`), news };
  });
}

/** GA4 Data API runReport on our property (service account with Viewer access). */
export const GA4_PROPERTY = '558351960';
export async function ga4Report(token: string, body: Record<string, unknown>) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY}:runReport`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GA4 ${res.status}: ${text.slice(0, 200)}`);
  const r = JSON.parse(text) as { dimensionHeaders?: { name: string }[]; metricHeaders?: { name: string }[]; rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; rowCount?: number };
  const dims = (r.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (r.metricHeaders ?? []).map((h) => h.name);
  return {
    rowCount: r.rowCount ?? 0,
    rows: (r.rows ?? []).map((row) => Object.fromEntries([...dims.map((d, i) => [d, row.dimensionValues[i]?.value]), ...mets.map((m, i) => [m, Number(row.metricValues[i]?.value)])])),
  };
}
