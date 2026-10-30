// Competitor monitoring (docs/growth/growth-workspace.md, group 2): a list of competitors whose public
// homepage and sitemap are checked weekly for changes (title, description, headline, prices mentioned,
// new pages), and AI research briefs written from their public pages (growth-mcp competitor_page).
//   GROWTH / COMPETITOR#<id>        { name, site, kind, notes, latest snapshot, brief? }
//   GROWTH / COMPSNAP#<id>#<day>    weekly snapshot (kept 400 days)
import { createHash, randomBytes } from 'node:crypto';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, Req, Res } from '../api/lib';
import { log } from './log';

const UA = 'Mozilla/5.0 (compatible; LensGrowthAudit/1.0; +https://lens.instagrowapp.com)';
export const KINDS = ['backup', 'event-sharing', 'camera', 'other'] as const;

/** The competitors from the strategy research (docs/growth/growth-strategy.md §2.2–2.3). */
export const SEED_COMPETITORS: { name: string; site: string; kind: (typeof KINDS)[number]; notes: string }[] = [
  { name: 'Google Photos', site: 'https://www.google.com/photos/about/', kind: 'backup', notes: '15 GB shared with Gmail and Drive; "Storage saver" quality.' },
  { name: 'TeraBox', site: 'https://www.terabox.com/', kind: 'backup', notes: '1 TB free with ads; strong in India and SEA.' },
  { name: 'JioAICloud', site: 'https://www.jio.com/jcms/apps/jioaicloud/', kind: 'backup', notes: '50 GB free for Jio users.' },
  { name: 'Amazon Photos', site: 'https://www.amazon.com/photos', kind: 'backup', notes: 'Unlimited full-resolution photos for Prime members.' },
  { name: 'Degoo', site: 'https://www.degoo.com/', kind: 'backup', notes: '100 GB free with ads.' },
  { name: 'Kululu', site: 'https://www.kululu.com/', kind: 'event-sharing', notes: 'QR event photo sharing; guests upload from the browser.' },
  { name: 'Guestpix', site: 'https://www.guestpix.com/', kind: 'event-sharing', notes: 'QR code event platform.' },
  { name: 'WedShoots', site: 'https://www.wedshoots.com/', kind: 'event-sharing', notes: 'Wedding photo sharing app (Bodas.net / The Knot group).' },
];

// ---------- snapshots (pure: tested in growth-competitors.test.ts) ----------

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** What a homepage says about itself: title, description, first headings, prices mentioned. */
export function summarizeHome(html: string) {
  const head = html.split(/<\/head>/i)[0] ?? '';
  const meta = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]).find((t) => /name\s*=\s*["']description["']/i.test(t));
  const body = html.slice(head.length).replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, ' ');
  const text = decode(body.replace(/<[^>]+>/g, ' '));
  return {
    title: decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '').slice(0, 200),
    description: meta ? decode(/content\s*=\s*["']([^"']*)["']/i.exec(meta)?.[1] ?? '').slice(0, 400) : '',
    headings: [...body.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => decode(m[1].replace(/<[^>]+>/g, ' '))).filter((h) => h.length >= 6 && !/^skip to\b/i.test(h)).slice(0, 8).map((h) => h.slice(0, 160)),
    prices: [...new Set((text.match(/(₹|\$|€|£|\bRs\.?\s?|\bINR\s?|\bUSD\s?)\s?\d[\d,]*(\.\d{1,2})?(\s?\/\s?(mo|month|yr|year))?/g) ?? []).map((p) => p.replace(/[,.]+$/, '')))].slice(0, 12),
    words: text.split(/\s+/).filter(Boolean).length,
    // Almost no text usually means the page is drawn by JavaScript: a browser crawler (e.g. Crawl4AI) would be needed.
    needsBrowser: text.split(/\s+/).filter(Boolean).length < 80 && /<script/i.test(html),
  };
}

export type Snapshot = ReturnType<typeof summarizeHome> & { status: number; error?: string; sitemapUrls: number | null; urls: string[] };

/** A page address as a short fingerprint (we keep fingerprints, not thousands of URLs, per competitor). */
export const urlHash = (u: string) => createHash('sha1').update(u).digest('hex').slice(0, 10);

/** What changed between two snapshots (none on the first one). `prevHashes` = fingerprints of last week's pages. */
export function diffSnapshots(prev: Snapshot | undefined, cur: Snapshot, prevHashes: string[] = []): { changes: string[]; newPages: string[] } {
  if (!prev || prev.error || cur.error) return { changes: cur.error ? [`Couldn't load: ${cur.error}`] : [], newPages: [] };
  const changes: string[] = [];
  if (prev.title !== cur.title) changes.push(`Title: "${prev.title}" → "${cur.title}"`);
  if (prev.description !== cur.description) changes.push(`Description changed: "${cur.description.slice(0, 160)}"`);
  const addedH = cur.headings.filter((h) => !prev.headings.includes(h));
  if (addedH.length) changes.push(`New headline${addedH.length > 1 ? 's' : ''}: ${addedH.slice(0, 3).map((h) => `"${h}"`).join(', ')}`);
  const addedP = cur.prices.filter((p) => !prev.prices.includes(p));
  const goneP = prev.prices.filter((p) => !cur.prices.includes(p));
  if (addedP.length || goneP.length) changes.push(`Prices on the page: ${addedP.length ? `now ${addedP.join(', ')}` : ''}${addedP.length && goneP.length ? '; ' : ''}${goneP.length ? `no longer ${goneP.join(', ')}` : ''}`);
  if (prev.sitemapUrls !== null && cur.sitemapUrls !== null && cur.sitemapUrls !== prev.sitemapUrls) changes.push(`Sitemap: ${prev.sitemapUrls} → ${cur.sitemapUrls} pages`);
  const before = new Set(prevHashes);
  const newPages = before.size ? cur.urls.filter((u) => !before.has(urlHash(u))).slice(0, 50) : [];
  return { changes, newPages };
}

// ---------- the weekly watch (GrowthAnalyst) ----------

async function get(url: string, timeout = 20_000) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml' }, signal: AbortSignal.timeout(timeout) });
  return { status: res.status, body: res.ok ? await res.text() : '' };
}

/** Up to 5,000 page addresses from robots.txt's sitemaps (or /sitemap.xml), following one level of index. */
async function sitemapUrls(site: string): Promise<string[] | null> {
  const origin = new URL(site).origin;
  const robots = await get(`${origin}/robots.txt`, 10_000).catch(() => ({ status: 0, body: '' }));
  const maps = [...robots.body.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]).slice(0, 3);
  if (!maps.length) maps.push(`${origin}/sitemap.xml`);
  const out: string[] = [];
  for (const m of maps) {
    const x = await get(m, 15_000).catch(() => ({ status: 0, body: '' }));
    const locs = [...x.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((l) => decode(l[1]));
    if (/<sitemapindex/i.test(x.body)) {
      for (const child of locs.slice(0, 8)) {
        const c = await get(child, 15_000).catch(() => ({ status: 0, body: '' }));
        out.push(...[...c.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((l) => decode(l[1])));
        if (out.length > 5000) break;
      }
    } else out.push(...locs);
    if (out.length > 5000) break;
  }
  return out.length ? [...new Set(out)].slice(0, 5000) : null;
}

async function rows(prefix: string) {
  const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': prefix } }));
  return r.Items ?? [];
}
export const competitors = () => rows('COMPETITOR#');

export async function seedCompetitors(by: string) {
  const marker = { pk: 'GROWTH', sk: 'SEEDED#COMPETITORS' };
  if ((await ddb.send(new GetCommand({ TableName: env.table, Key: marker }))).Item) return;
  for (const c of SEED_COMPETITORS) {
    const id = randomBytes(5).toString('hex');
    await ddb.send(new PutCommand({ TableName: env.table, Item: { ...c, createdAt: Date.now(), createdBy: by, pk: 'GROWTH', sk: `COMPETITOR#${id}`, id } }));
  }
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...marker, at: Date.now() } }));
}

/** Weekly: snapshot every competitor, diff against the last one, store. Returns what changed. */
export async function watchCompetitors(now = Date.now()) {
  await seedCompetitors('agent');
  const day = new Date(now).toISOString().slice(0, 10);
  const out: { id: string; name: string; changes: string[]; newPages: string[] }[] = [];
  for (const c of await competitors()) {
    let snap: Snapshot;
    try {
      const home = await get(String(c.site));
      const urls = await sitemapUrls(String(c.site)).catch(() => null);
      snap = { ...summarizeHome(home.body), status: home.status, ...(home.status >= 400 ? { error: `status ${home.status}` } : {}), sitemapUrls: urls?.length ?? null, urls: urls ?? [] };
    } catch (e) {
      snap = { ...summarizeHome(''), status: 0, error: (e as Error).message.slice(0, 80), sitemapUrls: null, urls: [] };
    }
    const d = diffSnapshots(c.latest as Snapshot | undefined, snap, (c.urlHashes as string[] | undefined) ?? []);
    const { urls, ...latest } = snap;
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `COMPSNAP#${c.id}#${day}`, ...latest, changes: d.changes, newPages: d.newPages, at: now, ttl: Math.floor(now / 1000) + 400 * 86400 } }));
    await ddb.send(new PutCommand({ TableName: env.table, Item: { ...c, latest: { ...latest, at: now }, urlHashes: urls.slice(0, 5000).map(urlHash), lastChanges: d.changes, lastNewPages: d.newPages, checkedAt: now } }));
    out.push({ id: String(c.id), name: String(c.name), ...d });
  }
  return out;
}

/** Hostnames the agent's competitor_page tool may read (only these). */
export async function competitorHosts(): Promise<string[]> {
  return [...new Set((await competitors()).map((c) => new URL(String(c.site)).hostname))];
}

// ---------- routes ----------

/** GET /growth/competitors: the list with latest snapshots, recent changes and briefs. */
export async function competitorsPage(by: string): Promise<Res> {
  await seedCompetitors(by);
  const list = (await competitors()).map(({ urlHashes: _u, ...c }) => c);
  const snaps = (await rows('COMPSNAP#')).sort((a, b) => b.at - a.at).slice(0, 200);
  return json(200, { competitors: list, timeline: snaps.filter((s) => (s.changes?.length ?? 0) > 0 || (s.newPages?.length ?? 0) > 0).map((s) => ({ id: String(s.sk).split('#')[1], at: s.at, changes: s.changes, newPages: s.newPages })) });
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** PUT /growth/competitors/<id|new> · DELETE /growth/competitors/<id> */
export async function competitorSave(id: string, req: Req, by: string, remove = false): Promise<Res> {
  const isNew = id === 'new';
  if (!isNew && !/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  if (remove) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `COMPETITOR#${id}` } }));
    await log({ entity: `growth:competitor:${id}`, action: 'growth.competitor-remove', actor: `console:${by}` });
    return json(200, { ok: true });
  }
  const old = isNew ? undefined : (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `COMPETITOR#${id}` } }))).Item;
  if (!isNew && !old) throw new HttpError(404, 'No such competitor');
  const b = req.body ?? {};
  const site = text(b.site ?? old?.site, 300);
  if (!/^https:\/\/[^\s/]+\.[^\s/]+/.test(site)) throw new HttpError(400, 'The website must start with https://');
  const name = text(b.name ?? old?.name, 80);
  if (!name) throw new HttpError(400, 'A name is required');
  const pid = isNew ? randomBytes(5).toString('hex') : id;
  const item = { ...(old ?? {}), name, site, kind: KINDS.includes(b.kind) ? b.kind : (old?.kind ?? 'other'), notes: text(b.notes ?? old?.notes, 1000), createdAt: old?.createdAt ?? Date.now(), createdBy: old?.createdBy ?? by, updatedAt: Date.now(), pk: 'GROWTH', sk: `COMPETITOR#${pid}`, id: pid };
  await ddb.send(new PutCommand({ TableName: env.table, Item: item }));
  await log({ entity: `growth:competitor:${pid}`, action: 'growth.competitor-save', actor: `console:${by}`, data: { name } });
  const { urlHashes: _u, ...out } = item as Record<string, unknown>;
  return json(200, { competitor: out });
}
