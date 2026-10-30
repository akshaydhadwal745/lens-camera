// SEO tools for the growth workspace (docs/growth/growth-workspace.md, group 1): keyword tracking,
// a technical audit of every sitemap page, page speed (PageSpeed Insights), and backlinks (Bing
// Webmaster links + a link-building pipeline whose links are checked automatically).
//   GROWTH / KEYWORD#<slug>      a tracked keyword { keyword, page?, addedBy, at }
//   GROWTH / SEOAUDIT            latest audit { at, pages[], speed[], links, bingQueries, summary }
//   GROWTH / PROSPECT#<id>       a link-building target { site, url, type, how, status, owner, notes, linkFound, checkedAt }
// The audit runs in the GrowthAnalyst Lambda (weekly with the report, and on demand).
import { randomBytes } from 'node:crypto';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, HttpError, json, Req, Res } from '../api/lib';
import { SEED_KEYWORDS } from './growth-sources';
import { log } from './log';

export const SITE = 'https://lens.instagrowapp.com';
const UA = 'LensGrowthAudit/1.0 (+https://lens.instagrowapp.com)';
const DAY = 86_400_000;

// ---------- the audit (pure: tested in growth-seo.test.ts) ----------

export type Issue = { code: string; severity: 'error' | 'warn' | 'info'; message: string };
export type PageAudit = { path: string; status: number; title: string; description: string; words: number; issues: Issue[]; internalLinks: string[]; bytes: number; ms: number };

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const attr = (tag: string, name: string) => decode(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? '');

/** Checks one page's HTML. Paths are relative to the site; private pages are expected to be noindex. */
export function auditHtml(path: string, html: string, status = 200): Omit<PageAudit, 'bytes' | 'ms'> {
  const issues: Issue[] = [];
  const add = (code: string, severity: Issue['severity'], message: string) => issues.push({ code, severity, message });
  const head = html.split(/<\/head>/i)[0] ?? '';
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '');
  const metaDesc = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /name\s*=\s*"description"/i.test(t));
  const description = metaDesc ? attr(metaDesc, 'content') : '';
  const canonical = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => /rel\s*=\s*"canonical"/i.test(t));
  const robots = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /name\s*=\s*"robots"/i.test(t));
  const hreflangs = [...head.matchAll(/<link\b[^>]*hreflang\s*=\s*"([^"]+)"[^>]*>/gi)].map((m) => m[1]);
  const body = html.slice(head.length);
  const main = /<main[\s\S]*?<\/main>/i.exec(body)?.[0] ?? body;
  const text = main.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  const h1s = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const internalLinks = [...new Set([...body.matchAll(/<a\b[^>]*href\s*=\s*"([^"#?]+)/gi)].map((m) => m[1]).map((h) => (h.startsWith(SITE) ? h.slice(SITE.length) || '/' : h)).filter((h) => h.startsWith('/') && !h.startsWith('//')))];

  if (status >= 400) add('status', 'error', `The page answers ${status}`);
  else if (status >= 300) add('redirect', 'warn', `The sitemap lists a redirect (${status}); list the final address instead`);
  if (!title) add('title-missing', 'error', 'No <title>');
  else if (title.length > 60) add('title-long', 'warn', `Title is ${title.length} characters; Google shows about 60`);
  else if (title.length < 25) add('title-short', 'info', `Title is only ${title.length} characters`);
  if (!description) add('description-missing', 'error', 'No meta description');
  else if (description.length > 160) add('description-long', 'warn', `Description is ${description.length} characters; Google shows about 155`);
  else if (description.length < 70) add('description-short', 'info', `Description is ${description.length} characters; 120–155 works best`);
  if (!h1s.length) add('h1-missing', 'error', 'No H1 heading');
  else if (h1s.length > 1) add('h1-many', 'warn', `${h1s.length} H1 headings; use one`);
  if (robots && /noindex/i.test(attr(robots, 'content'))) add('noindex', 'error', 'The page tells Google not to index it (robots noindex) but is in the sitemap');
  if (!canonical) add('canonical-missing', 'warn', 'No canonical link');
  else {
    const href = attr(canonical, 'href');
    if (href.replace(SITE, '') !== path) add('canonical-other', 'warn', `Canonical points elsewhere: ${href}`);
  }
  if (!/<html\b[^>]*\blang\s*=/i.test(html)) add('lang-missing', 'warn', 'No lang attribute on <html>');
  for (const l of ['en', 'hi', 'x-default']) if (!hreflangs.includes(l)) add('hreflang-missing', 'warn', `No hreflang="${l}" alternate`);
  if (!/<script\b[^>]*type\s*=\s*"application\/ld\+json"/i.test(html)) add('jsonld-missing', 'info', 'No structured data (JSON-LD)');
  if (!/<meta\b[^>]*property\s*=\s*"og:image"/i.test(head)) add('og-image-missing', 'info', 'No social preview image (og:image)');
  if (words < 300) add('thin', 'warn', `Thin page: ${words} words in the main content`);
  const noAlt = imgs.filter((t) => !/\balt\s*=/i.test(t)).length;
  if (noAlt) add('img-alt', 'warn', `${noAlt} image${noAlt > 1 ? 's' : ''} without alt text`);
  return { path, status, title, description, words, issues, internalLinks };
}

/** Weighted health: 100 minus 10 per error and 3 per warning, per page, averaged. */
export function auditScore(pages: { issues: Issue[] }[]): number {
  if (!pages.length) return 0;
  const per = pages.map((p) => Math.max(0, 100 - p.issues.reduce((s, i) => s + (i.severity === 'error' ? 10 : i.severity === 'warn' ? 3 : 0), 0)));
  return Math.round(per.reduce((s, x) => s + x, 0) / per.length);
}

/** The sitemap's page addresses (index → child sitemaps → <loc>s), as site paths. */
export function sitemapLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => decode(m[1]));
}

// ---------- running it (GrowthAnalyst) ----------

async function fetchText(url: string, timeout = 20_000) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
  const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
  return { status: res.status, body, ms: Date.now() - t0 };
}

async function pool<T, R>(items: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += n) out.push(...(await Promise.all(items.slice(i, i + n).map(f))));
  return out;
}

type Speed = { path: string; strategy: 'mobile' | 'desktop'; scores: Record<string, number>; lcp?: string; cls?: string; tbt?: string; fcp?: string; field?: Record<string, string> };

async function pageSpeed(key: string, path: string, strategy: 'mobile' | 'desktop'): Promise<Speed | undefined> {
  const q = new URLSearchParams({ url: `${SITE}${path}`, strategy, key });
  for (const c of ['performance', 'seo', 'accessibility', 'best-practices']) q.append('category', c);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) return undefined;
  const d = (await res.json()) as any;
  const a = d.lighthouseResult?.audits ?? {};
  const field = Object.fromEntries(Object.entries((d.loadingExperience?.metrics ?? {}) as Record<string, { category: string }>).map(([k, v]) => [k, v.category]));
  return {
    path,
    strategy,
    scores: Object.fromEntries(Object.entries((d.lighthouseResult?.categories ?? {}) as Record<string, { score: number }>).map(([k, v]) => [k, Math.round((v.score ?? 0) * 100)])),
    lcp: a['largest-contentful-paint']?.displayValue,
    cls: a['cumulative-layout-shift']?.displayValue,
    tbt: a['total-blocking-time']?.displayValue,
    fcp: a['first-contentful-paint']?.displayValue,
    ...(Object.keys(field).length ? { field } : {}),
  };
}

async function bing(method: string, params: Record<string, string> = {}) {
  const key = await getParam('/lens/growth/bing-key');
  if (!key) return undefined;
  const q = new URLSearchParams({ siteUrl: `${SITE}/`, ...params, apikey: key });
  const res = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/${method}?${q}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return undefined;
  return ((await res.json()) as { d: unknown }).d;
}

/** Crawl the sitemap, check every page and its internal links, page speed for key pages, Bing links and queries. */
export async function runSeoAudit(now = Date.now(), indexState: Record<string, string> = {}) {
  const audit = await buildSeoAudit(now, indexState);
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'SEOAUDIT', ...audit } }));
  // Keep a short history of the headline numbers.
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `SEOHIST#${new Date(now).toISOString().slice(0, 10)}`, ...audit.summary, at: now, ttl: Math.floor(now / 1000) + 400 * 86400 } }));
  await verifyProspects(now);
  return audit.summary;
}

/** The audit itself (no storage), so it can also be checked by hand. */
export async function buildSeoAudit(now = Date.now(), indexState: Record<string, string> = {}, pagespeedKey?: string) {
  const notes: string[] = [];
  const index = await fetchText(`${SITE}/sitemap-index.xml`);
  const children = sitemapLocs(index.body).filter((u) => u.endsWith('.xml'));
  const paths: string[] = [];
  for (const c of children) paths.push(...sitemapLocs((await fetchText(c)).body).map((u) => u.replace(SITE, '') || '/'));
  const pages: PageAudit[] = await pool(paths, 4, async (path) => {
    try {
      const r = await fetchText(`${SITE}${path}`);
      const a = auditHtml(path, r.body, r.status);
      const st = indexState[path];
      if (st && st !== 'Submitted and indexed') a.issues.push({ code: 'not-indexed', severity: 'warn', message: `Google: ${st}` });
      return { ...a, bytes: r.body.length, ms: r.ms };
    } catch (e) {
      return { path, status: 0, title: '', description: '', words: 0, issues: [{ code: 'fetch', severity: 'error', message: `Couldn't load: ${(e as Error).message.slice(0, 80)}` }], internalLinks: [], bytes: 0, ms: 0 };
    }
  });
  // Broken internal links: every distinct target, checked once.
  const known = new Set(paths);
  const targets = [...new Set(pages.flatMap((p) => p.internalLinks))].filter((t) => !known.has(t) && !/^\/(api|app)\//.test(t)).slice(0, 150);
  const broken = new Set<string>();
  await pool(targets, 4, async (t) => {
    const r = await fetchText(`${SITE}${t}`, 10_000).catch(() => ({ status: 0 }));
    if (r.status >= 400 || r.status === 0) broken.add(t);
  });
  for (const p of pages) {
    const bad = p.internalLinks.filter((l) => broken.has(l));
    if (bad.length) p.issues.push({ code: 'broken-links', severity: 'error', message: `Links to missing pages: ${bad.slice(0, 5).join(', ')}` });
  }
  // Page speed: home plus the pages most worth checking (mobile and desktop).
  const key = pagespeedKey ?? (await getParam('/lens/growth/pagespeed-key').catch(() => undefined));
  const speedPaths = ['/', '/features/free-cloud-backup/', '/compare/google-photos/', '/guides/collect-wedding-photos-qr-code/', '/download/'].filter((p) => known.has(p) || p === '/');
  let speed: Speed[] = [];
  if (key) speed = (await pool(speedPaths.flatMap((p) => [{ p, s: 'mobile' as const }, { p, s: 'desktop' as const }]), 2, (x) => pageSpeed(key, x.p, x.s).catch(() => undefined))).filter((x): x is Speed => !!x);
  else notes.push('Page speed skipped: /lens/growth/pagespeed-key is not set.');
  // Bing: who links to us, and our positions in Bing results.
  const linkCounts = ((await bing('GetLinkCounts').catch(() => undefined)) as { Links?: { Url: string; Count: number }[] } | undefined)?.Links ?? [];
  const linking: { page: string; from: string; anchor: string }[] = [];
  for (const l of linkCounts.slice(0, 10)) {
    const d = (await bing('GetUrlLinks', { link: l.Url, page: '0' }).catch(() => undefined)) as { Details?: { Url: string; AnchorText: string }[] } | undefined;
    for (const x of d?.Details ?? []) linking.push({ page: l.Url.replace(SITE, '') || '/', from: x.Url, anchor: x.AnchorText });
  }
  const bingQueries = (((await bing('GetQueryStats').catch(() => undefined)) as { Query: string; Impressions: number; Clicks: number; AvgImpressionPosition: number; Date: string }[] | undefined) ?? [])
    .map((q) => ({ query: q.Query, impressions: q.Impressions, clicks: q.Clicks, position: q.AvgImpressionPosition }))
    .slice(0, 200);
  const all = pages.flatMap((p) => p.issues);
  const audit = {
    at: now,
    pages: pages.map(({ internalLinks: _l, ...p }) => p),
    speed,
    links: { counts: linkCounts.map((l) => ({ page: l.Url.replace(SITE, '') || '/', count: l.Count })), linking },
    bingQueries,
    notes,
    summary: { pages: pages.length, errors: all.filter((i) => i.severity === 'error').length, warnings: all.filter((i) => i.severity === 'warn').length, score: auditScore(pages), brokenLinks: broken.size, backlinks: linkCounts.reduce((s, l) => s + l.Count, 0) },
  };
  return audit;
}

// ---------- link building ----------

export const PROSPECT_TYPES = ['directory', 'community', 'launch', 'press', 'partner', 'guest-post', 'other'] as const;
export const PROSPECT_STATUSES = ['idea', 'contacted', 'submitted', 'live', 'rejected'] as const;

/** Real places worth a link for a photo backup app (free; each with how to get listed). */
export const SEED_PROSPECTS: { site: string; url: string; type: (typeof PROSPECT_TYPES)[number]; how: string }[] = [
  { site: 'AlternativeTo', url: 'https://alternativeto.net/software/google-photos/', type: 'directory', how: 'Add Lens as an alternative to Google Photos (free account, "Add application").' },
  { site: 'Product Hunt', url: 'https://www.producthunt.com/', type: 'launch', how: 'Launch on production day (strategy Phase B): maker profile, gallery, first comment.' },
  { site: 'Indie Hackers', url: 'https://www.indiehackers.com/products', type: 'community', how: 'Add Lens as a product and post build-in-public updates.' },
  { site: 'BetaList', url: 'https://betalist.com/submit', type: 'launch', how: 'Submit while in closed test (free queue).' },
  { site: 'SaaSHub', url: 'https://www.saashub.com/', type: 'directory', how: 'Submit Lens as an alternative to Google Photos and TeraBox.' },
  { site: 'Hacker News (Show HN)', url: 'https://news.ycombinator.com/show', type: 'launch', how: '"Show HN: a camera that backs up every photo in full quality" with the technical story.' },
  { site: 'Reddit r/androidapps', url: 'https://www.reddit.com/r/androidapps/', type: 'community', how: 'Follow the self-promotion rules: one honest post with what is free, plus answers in threads asking for backup apps.' },
  { site: 'Reddit r/IndianWeddings / r/india', url: 'https://www.reddit.com/r/IndianWeddings/', type: 'community', how: 'Answer "how to collect photos from guests" questions with the QR guide.' },
  { site: 'Startup India (DPIIT)', url: 'https://www.startupindia.gov.in/', type: 'directory', how: 'Startup profile with the website link (needs a registered entity).' },
  { site: 'YourStory', url: 'https://yourstory.com/', type: 'press', how: 'Pitch the "phone full" story to the startup desk; include real numbers after launch.' },
  { site: 'GitHub README (lens-camera)', url: 'https://github.com/akshaydhadwal745/lens-camera', type: 'other', how: 'Add a website link and short description to the public repo’s README.' },
  { site: 'Wedding photographer partner sites', url: '', type: 'partner', how: 'Ask each partner (Partnerships) to link "guest photo album by Lens" from their site.' },
];

/** Does this page link to our site? (verification for a "live" link) */
export const linksToUs = (html: string) => /href\s*=\s*"https?:\/\/(www\.|lens\.)?instagrowapp\.com(?=[/"?#:])/i.test(html);

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

async function rows(prefix: string) {
  const out: Record<string, any>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': prefix }, ExclusiveStartKey: start }));
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

export async function seedProspects(by: string) {
  const marker = { pk: 'GROWTH', sk: 'SEEDED#PROSPECTS' };
  if ((await ddb.send(new GetCommand({ TableName: env.table, Key: marker }))).Item) return;
  for (const p of SEED_PROSPECTS) {
    const id = randomBytes(5).toString('hex');
    await ddb.send(new PutCommand({ TableName: env.table, Item: { ...p, status: 'idea', owner: '', notes: '', linkFound: false, createdAt: Date.now(), createdBy: by, pk: 'GROWTH', sk: `PROSPECT#${id}`, id } }));
  }
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...marker, at: Date.now() } }));
}

/** Weekly: fetch each prospect page that has a URL; a link to us found → "live" (lost → back to "submitted"). */
export async function verifyProspects(now = Date.now()) {
  for (const p of (await rows('PROSPECT#')).filter((x) => x.url && ['submitted', 'contacted', 'live'].includes(x.status))) {
    const r = await fetch(p.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) })
      .then(async (res) => (res.ok ? res.text() : ''))
      .catch(() => '');
    const found = !!r && linksToUs(r);
    const status = found ? 'live' : p.status === 'live' ? 'submitted' : p.status;
    await ddb.send(new PutCommand({ TableName: env.table, Item: { ...p, linkFound: found, checkedAt: now, status, ...(found && !p.liveAt ? { liveAt: now } : {}) } }));
  }
}

// ---------- routes ----------

/** GET /growth/seo: keywords with Google history, the latest audit, speed, backlinks, prospects. */
/** Track the seed keywords and the keywords on existing tasks (once). */
async function seedKeywords(by: string) {
  const marker = { pk: 'GROWTH', sk: 'SEEDED#KEYWORDS' };
  if ((await ddb.send(new GetCommand({ TableName: env.table, Key: marker }))).Item) return;
  const fromTasks = (await rows('TASK#')).map((t) => String(t.links?.keyword ?? '')).filter(Boolean);
  for (const keyword of [...new Set([...SEED_KEYWORDS, ...fromTasks].map((k) => k.toLowerCase()))])
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `KEYWORD#${slug(keyword)}`, keyword, page: '', addedBy: by, at: Date.now() } }));
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...marker, at: Date.now() } }));
}

export async function seoPage(by: string): Promise<Res> {
  await seedProspects(by);
  await seedKeywords(by);
  const now = Date.now();
  const days = Array.from({ length: 90 }, (_, i) => new Date(now - (90 - i) * DAY).toISOString().slice(0, 10));
  const gsc = await pool(days, 10, async (day) => {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': `GSC#${day}`, ':s': 'q#' } }));
    return { day, rows: (r.Items ?? []) as { sk: string; clicks: number; impressions: number; position: number }[] };
  });
  const keywords = await rows('KEYWORD#');
  const audit = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'SEOAUDIT' } }))).Item ?? null;
  const history = (await rows('SEOHIST#')).slice(-26);
  // All queries Google showed us for in 28 days, and each tracked keyword's weekly position.
  const recent = gsc.slice(-28);
  const queries = new Map<string, { clicks: number; impressions: number; posSum: number }>();
  for (const d of recent)
    for (const r of d.rows) {
      const q = r.sk.slice(2);
      const a = queries.get(q) ?? { clicks: 0, impressions: 0, posSum: 0 };
      a.clicks += r.clicks;
      a.impressions += r.impressions;
      a.posSum += r.position * r.impressions;
      queries.set(q, a);
    }
  const weekly = (q: string) =>
    Array.from({ length: 12 }, (_, w) => {
      const part = gsc.slice(90 - (12 - w) * 7, 90 - (11 - w) * 7);
      const rs = part.flatMap((d) => d.rows.filter((r) => r.sk === `q#${q.toLowerCase()}`));
      const imp = rs.reduce((s, r) => s + r.impressions, 0);
      return imp ? Math.round((rs.reduce((s, r) => s + r.position * r.impressions, 0) / imp) * 10) / 10 : null;
    });
  const bingPos = new Map(((audit?.bingQueries ?? []) as { query: string; position: number; impressions: number }[]).map((q) => [q.query.toLowerCase(), q]));
  return json(200, {
    keywords: keywords.map((k) => {
      const g = queries.get(String(k.keyword).toLowerCase());
      return { ...k, google: g ? { impressions: g.impressions, clicks: g.clicks, position: g.impressions ? Math.round((g.posSum / g.impressions) * 10) / 10 : null } : null, weekly: weekly(String(k.keyword)), bing: bingPos.get(String(k.keyword).toLowerCase()) ?? null };
    }),
    queries: [...queries.entries()].map(([query, a]) => ({ query, clicks: a.clicks, impressions: a.impressions, position: a.impressions ? Math.round((a.posSum / a.impressions) * 10) / 10 : null })).sort((a, b) => b.impressions - a.impressions).slice(0, 200),
    audit,
    history,
    prospects: await rows('PROSPECT#'),
  });
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

/** PUT /growth/keywords {keyword, page?} · DELETE /growth/keywords {keyword} */
export async function keywordSave(req: Req, by: string, remove = false): Promise<Res> {
  const keyword = text(req.body?.keyword, 100).toLowerCase();
  if (!keyword || !slug(keyword)) throw new HttpError(400, 'A keyword is required');
  const key = { pk: 'GROWTH', sk: `KEYWORD#${slug(keyword)}` };
  if (remove) await ddb.send(new DeleteCommand({ TableName: env.table, Key: key }));
  else await ddb.send(new PutCommand({ TableName: env.table, Item: { ...key, keyword, page: text(req.body?.page, 200), addedBy: by, at: Date.now() } }));
  await log({ entity: `growth:keyword:${slug(keyword)}`, action: remove ? 'growth.keyword-remove' : 'growth.keyword-add', actor: `console:${by}` });
  return json(200, { ok: true });
}

/** PUT /growth/prospects/<id|new> · DELETE /growth/prospects/<id> */
export async function prospectSave(id: string, req: Req, by: string, remove = false): Promise<Res> {
  const isNew = id === 'new';
  if (!isNew && !/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  if (remove) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `PROSPECT#${id}` } }));
    return json(200, { ok: true });
  }
  const old = isNew ? undefined : (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `PROSPECT#${id}` } }))).Item;
  if (!isNew && !old) throw new HttpError(404, 'No such prospect');
  const b = req.body ?? {};
  const url = text(b.url ?? old?.url, 300);
  if (url && !/^https:\/\//.test(url)) throw new HttpError(400, 'The address must start with https://');
  const item = {
    site: text(b.site ?? old?.site, 120),
    url,
    type: oneOf(b.type ?? old?.type, PROSPECT_TYPES, 'other'),
    how: text(b.how ?? old?.how, 500),
    status: oneOf(b.status ?? old?.status, PROSPECT_STATUSES, 'idea'),
    owner: text(b.owner ?? old?.owner, 200),
    notes: text(b.notes ?? old?.notes, 2000),
    linkFound: old?.linkFound ?? false,
    checkedAt: old?.checkedAt,
    createdAt: old?.createdAt ?? Date.now(),
    createdBy: old?.createdBy ?? by,
    updatedAt: Date.now(),
  };
  if (!item.site) throw new HttpError(400, 'A site name is required');
  const pid = isNew ? randomBytes(5).toString('hex') : id;
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...item, pk: 'GROWTH', sk: `PROSPECT#${pid}`, id: pid } }));
  await log({ entity: `growth:prospect:${pid}`, action: 'growth.prospect-save', actor: `console:${by}`, data: { status: item.status } });
  return json(200, { prospect: { ...item, id: pid } });
}
