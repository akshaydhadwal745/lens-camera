// Photos from the internet for content images (docs/growth/content-engine.md, phase 3): searched live,
// rights-checked by code (growth-rights.ts) and saved to the Library like any other asset.
//   Source: Pixabay only (owner 2026-11-04; key in SSM /lens/growth/photos {"pixabayKey"}). Its API asks us to
//   download images rather than hotlink, which is what we do. Pexels joins if a pexelsKey is ever added. Commons
//   was dropped after it put a press photo of a religious ceremony into a wedding post; older finds stay in the
//   Library but aren't used automatically.
//   Only photos the rights check clears are used automatically. Photos whose tags suggest people or brands go
//   to the Library as "review" for a manager (free licences have no model/trademark release).
//   Words can't see a photo, so Claude also looks at the photos (growth-media.ts lookAtPhotos): `looked` on the
//   asset says if it's good enough for any ad (once per photo); whether it fits THIS post is asked per post.
//   GROWTH / ASSET#<id>     the photo (kind image, origin discovered, query, sourceUrl, w, h); file a/<id>.<ext>
//   e/<id>.json             what the source said about the photo and its licence, when we took it
//   GROWTH / PHOTOQ#<hash>  { query, ids, at, ttl, v, sources }: a search is reused for 30 days; `sources`
//                           says what each source answered ("ok 20", "failed: pixabay.com 403", "no key")
import { createHash } from 'node:crypto';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BatchGetCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, s3 } from '../api/lib';
import type { Asset } from './growth-assets';
import { effectiveStatus, licenseKey, licenseVerdict, type Rights } from './growth-rights';

const BUCKET = process.env.GROWTH_CONTENT_BUCKET ?? '';
const UA = 'LensGrowth/1.0 (https://lens.instagrowapp.com; content images)';
const DAY = 86_400_000;

export type Found = {
  source: 'Pexels' | 'Pixabay' | 'Wikimedia Commons' | 'Openverse';
  sourceUrl: string; // the photo's own page
  imageUrl: string; // the file we download (about 1600 px wide)
  w: number;
  h: number;
  license: string;
  licenseUrl: string;
  author: string;
  title: string;
  tags: string;
};
export type Photo = Asset & { query?: string; sourceUrl?: string; w?: number; h?: number; looked?: { ok: boolean; why: string; at: number } };

/** Words in a title or tags that mean people are probably in the picture. */
export const PEOPLE =
  /\b(portrait|selfie|faces?|man|men|woman|women|girls?|boys?|child|children|kids?|baby|people|persons?|bride|groom|couple|family|friends|singer|artist|band|actor|actress|player|celebrity|model|crowd|audience|fans|parents?|students?|dancers?)\b/i;
/** Words that mean a logo, brand or branded product is probably in the picture. */
export const BRANDS = /\b(logo|brand|trademark|billboard|advert\w*|iphone|samsung|apple|google|pixel)\b/i;
/** Either of the two (what the rights record calls peopleOrBrands). */
export const PEOPLE_OR_BRANDS = new RegExp(`${PEOPLE.source}|${BRANDS.source}`, 'i');

/**
 * Stock sites whose own licence covers people in commercial use (Pexels, Pixabay: no endorsement implied, nobody
 * shown in a bad light). Owner 2026-11-10 ("think as a real content editor"): people are used the way an editor
 * uses b-roll, as the moment's mood: a crowd from behind, hands, a stage seen from the audience. Never as a Lens
 * user, never holding our app, never a close-up of a child. The photo editor (Claude) enforces that by looking.
 */
const PEOPLE_OK = new Set(['pexels', 'pixabay']);

/** Paintings, prints, maps and scans are public domain too, but they aren't photos. */
export const NOT_A_PHOTO = /\b(paintings?|painted|painter|oil on|canvas|drawings?|engraving|etching|lithograph|woodcut|illustrations?|postcards?|posters?|maps?|museum|artworks?|watercolou?r|aquarelle|sketch|scans?|book of|manuscript|fresco|mural|stamps?|coins?|diagram|svg|logo)\b|\b1[5-8]\d\d\b|\b19[0-4]\d\b/i;

/** Enough of the search words appear in the title or tags (Commons and Openverse match loosely). */
export function relevant(f: Pick<Found, 'title' | 'tags'>, query: string): boolean {
  const hay = `${f.title} ${f.tags}`.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const hits = words.filter((w) => hay.includes(w.replace(/s$/, ''))).length;
  return hits >= Math.min(2, words.length);
}

const plain = (html: unknown) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

/** Wikimedia Commons search (generator=search, prop=imageinfo with extmetadata) → photos. Credit needed for CC BY. */
export function wikimediaResults(json: any): Found[] {
  const pages = Object.values(json?.query?.pages ?? {}) as any[];
  return pages
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => {
      const i = p.imageinfo?.[0] ?? {};
      const m = i.extmetadata ?? {};
      return {
        source: 'Wikimedia Commons' as const,
        sourceUrl: String(i.descriptionurl ?? ''),
        imageUrl: String(i.thumburl ?? i.url ?? ''),
        w: Number(i.thumbwidth ?? i.width) || 0,
        h: Number(i.thumbheight ?? i.height) || 0,
        license: plain(m.LicenseShortName?.value),
        licenseUrl: plain(m.LicenseUrl?.value),
        author: plain(m.Artist?.value).slice(0, 120),
        title: String(p.title ?? '').replace(/^File:/, '').replace(/\.\w+$/, ''),
        tags: `${plain(m.ImageDescription?.value).slice(0, 400)} ${plain(m.Categories?.value).replace(/\|/g, ' ')}`,
      };
    })
    .filter((f) => f.sourceUrl && f.imageUrl && f.w >= 1000 && !NOT_A_PHOTO.test(`${f.title} ${f.tags}`));
}

/** Openverse (Flickr and other CC collections) → photos; only CC0, public domain and CC BY are asked for. */
export function openverseResults(json: any): Found[] {
  const name = (r: any) => {
    const l = String(r.license ?? '').toLowerCase();
    if (l === 'cc0') return 'CC0';
    if (l === 'pdm') return 'Public domain';
    return `CC ${l.toUpperCase()} ${String(r.license_version ?? '').trim()}`.trim();
  };
  return ((json?.results ?? []) as any[])
    .map((r) => ({
      source: 'Openverse' as const,
      sourceUrl: String(r.foreign_landing_url ?? ''),
      imageUrl: String(r.url ?? ''),
      w: Number(r.width) || 0,
      h: Number(r.height) || 0,
      license: name(r),
      licenseUrl: String(r.license_url ?? ''),
      author: String(r.creator ?? '').slice(0, 120),
      title: String(r.title ?? ''),
      tags: ((r.tags ?? []) as any[]).map((t) => t?.name).filter(Boolean).join(', '),
    }))
    .filter((f) => /^https:/.test(f.sourceUrl) && /^https:/.test(f.imageUrl) && f.w >= 1000 && !NOT_A_PHOTO.test(`${f.title} ${f.tags}`));
}

/** Pexels search → photos (Pexels License: free, commercial use and edits allowed, no credit required). */
export function pexelsResults(json: any): Found[] {
  return ((json?.photos ?? []) as any[])
    .map((p) => {
      const w = Math.min(Number(p.width) || 0, 1880);
      return {
        source: 'Pexels' as const,
        sourceUrl: String(p.url ?? ''),
        imageUrl: String(p.src?.large2x ?? p.src?.large ?? ''),
        w,
        h: Math.round((w / (Number(p.width) || 1)) * (Number(p.height) || 0)),
        license: 'Pexels License',
        licenseUrl: 'https://www.pexels.com/license/',
        author: String(p.photographer ?? '').slice(0, 120),
        title: String(p.alt ?? '').slice(0, 200),
        tags: String(p.alt ?? ''),
      };
    })
    .filter((f) => f.sourceUrl && f.imageUrl);
}

/** Pixabay uploaders stuff tags for search ("iphone wallpaper", "samsung wallpaper"): they say nothing about the photo. */
const cleanTags = (tags: unknown) =>
  String(tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t && !/wallpaper|background|screensaver|lock screen/i.test(t))
    .join(', ');

/** Pixabay search → photos (Pixabay Content License: free, commercial use and edits allowed, no credit). */
export function pixabayResults(json: any): Found[] {
  return ((json?.hits ?? []) as any[])
    .map((p) => {
      const scale = Math.min(1, 1280 / Math.max(Number(p.imageWidth) || 1, Number(p.imageHeight) || 1));
      return {
        source: 'Pixabay' as const,
        sourceUrl: String(p.pageURL ?? ''),
        imageUrl: String(p.largeImageURL ?? ''),
        w: Math.round((Number(p.imageWidth) || 0) * scale),
        h: Math.round((Number(p.imageHeight) || 0) * scale),
        license: 'Pixabay Content License',
        licenseUrl: 'https://pixabay.com/service/license-summary/',
        author: String(p.user ?? '').slice(0, 120),
        title: cleanTags(p.tags).slice(0, 200),
        tags: cleanTags(p.tags),
      };
    })
    .filter((f) => f.sourceUrl && f.imageUrl && f.w >= 800);
}

export type StockVideo = { id: string; pageUrl: string; url: string; thumb: string; w: number; h: number; duration: number; author: string; tags: string };
/** Made by AI, or not footage of anything: green screens, animations, effects, motion backgrounds. */
const NOT_FOR_REELS = /\bai[- ]generated\b|\bai\b|green ?screen|chroma|\banimat|\bvfx\b|\bcgi\b|\b3d\b|motion graphic|\bloop\b|\babstract\b|\bintro\b|\boverlay\b/i;

/** Pixabay's video search → usable clips: real footage only, no brands by tags (people as b-roll are fine), at least 1080p and not huge
 *  (Claude still looks at a frame of each). Landscape is fine: it's cropped to vertical. */
export function videoResults(json: any): StockVideo[] {
  return ((json?.hits ?? []) as any[])
    .map((h) => {
      const size = [h.videos?.large, h.videos?.medium].find((v) => v?.url && Math.min(Number(v.width), Number(v.height)) >= 1080 && Number(v.size) <= 60_000_000);
      const tags = cleanTags(h.tags);
      return { id: String(h.id ?? ''), pageUrl: String(h.pageURL ?? ''), url: String(size?.url ?? ''), thumb: String(size?.thumbnail ?? ''), w: Number(size?.width) || 0, h: Number(size?.height) || 0, duration: Number(h.duration) || 0, author: String(h.user ?? '').slice(0, 120), tags, rawTags: String(h.tags ?? '') };
    })
    .filter((v) => v.id && v.url && v.thumb && v.duration >= 3 && !NOT_FOR_REELS.test(`${v.rawTags}`) && !BRANDS.test(v.tags))
    .map(({ rawTags: _r, ...v }) => v);
}

/** The rights record: the licence decides (growth-rights.ts); people and brands are judged from the words. */
export function photoRights(f: Found, now = Date.now()): Rights {
  const words = `${f.title} ${f.tags}`;
  const people = PEOPLE.test(words);
  const brands = BRANDS.test(words);
  const broll = people && !brands && PEOPLE_OK.has(licenseKey(f.license));
  const v = licenseVerdict(f.license, brands || (people && !broll));
  return {
    status: v.status,
    license: f.license,
    licenseUrl: f.licenseUrl,
    source: f.sourceUrl,
    author: f.author,
    credit: '',
    commercialOk: v.commercialOk,
    editsOk: v.editsOk,
    peopleOrBrands: people || brands,
    reason: broll
      ? `${v.reason}. People appear: the ${f.source} licence allows them in commercial use as long as nobody is shown endorsing Lens or in a bad light, so they are used only as the moment's mood (never as a Lens user, never a close-up of a child). Look at it when you approve the post.`
      : `${v.reason}. Found by the content engine; people and brands judged from the photo's title and tags, so look at it when you approve the post.`,
    checkedAt: now,
    checkedBy: 'photo-search',
  };
}

export const photoAssetId = (sourceUrl: string) => createHash('sha256').update(`photo|${sourceUrl}`).digest('hex').slice(0, 12);
const queryKey = (q: string) => createHash('sha256').update(q.toLowerCase().trim()).digest('hex').slice(0, 10);

async function getJson(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}

/** Bump when sources change, so cached searches made without them are done again. */
const SEARCH_VERSION = 6;

/** The Pixabay key from SSM (never in code). */
export async function pixabayKey(): Promise<string | undefined> {
  const v = await getParam('/lens/growth/photos');
  return v ? (JSON.parse(v) as { pixabayKey?: string }).pixabayKey : undefined;
}

/**
 * Pixabay first (no credit needed). `wide`: also Wikimedia Commons and Openverse, for when nothing from Pixabay fits
 * the post (owner 2026-11-10: search other sites and credit the creator). Only licences that allow commercial use
 * with edits come back; CC BY photos get a credit line in the post. Never Pinterest/Google/Instagram: those are
 * other people's photos with no licence to reuse.
 */
async function searchSources(query: string, orientation: 'portrait' | 'landscape', wide = false): Promise<{ found: Found[]; sources: Record<string, string> }> {
  const out: Found[] = [];
  const sources: Record<string, string> = {};
  const run = async (name: string, f: () => Promise<Found[]>) => {
    try {
      const got = await f();
      out.push(...got);
      sources[name] = `ok ${got.length}`;
    } catch (e) {
      sources[name] = `failed: ${(e as Error).message.slice(0, 120)}`;
    }
  };
  let keys: { pixabayKey?: string; pexelsKey?: string } = {};
  try {
    const v = await getParam('/lens/growth/photos');
    keys = v ? JSON.parse(v) : {};
  } catch (e) {
    sources.keys = `failed: ${(e as Error).message.slice(0, 120)}`;
  }
  if (keys.pixabayKey) await run('pixabay', async () => pixabayResults(await getJson(`https://pixabay.com/api/?${new URLSearchParams({ key: keys.pixabayKey!, q: query.slice(0, 100), image_type: 'photo', orientation: orientation === 'portrait' ? 'vertical' : 'horizontal', safesearch: 'true', per_page: '40', order: 'popular' })}`)));
  else sources.pixabay = 'no key';
  if (wide) {
    await run('commons', async () => {
      const got: Found[] = [];
      for (const extra of [' incategory:Quality_images', ''])
        got.push(...wikimediaResults(await getJson(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: `${query} filetype:bitmap${extra}`, gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1600' })}`)).filter((f) => relevant(f, query)));
      return got;
    });
    await run('openverse', async () => openverseResults(await getJson(`https://api.openverse.org/v1/images/?${new URLSearchParams({ q: query.slice(0, 100), license: 'cc0,pdm,by', category: 'photograph', size: 'large', mature: 'false', page_size: '20' })}`)).filter((f) => relevant(f, query)));
  }
  if (keys.pexelsKey) await run('pexels', async () => pexelsResults(await getJson(`https://api.pexels.com/v1/search?${new URLSearchParams({ query, orientation, per_page: '15', size: 'large' })}`, { Authorization: keys.pexelsKey! })));
  console.log(JSON.stringify({ photoSearch: query, sources }));
  const seen = new Set<string>();
  return { found: out.filter((f) => !seen.has(f.sourceUrl) && seen.add(f.sourceUrl)), sources };
}

async function savePhoto(f: Found, query: string): Promise<Photo | undefined> {
  const id = photoAssetId(f.sourceUrl);
  const old = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${id}` } }))).Item as Photo | undefined;
  if (old) return old;
  const r = await fetch(f.imageUrl, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
  const mime = (r.headers.get('content-type') ?? '').split(';')[0];
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[mime];
  if (!r.ok || !ext) return undefined;
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > 8 * 1024 * 1024) return undefined;
  const now = Date.now();
  const evidenceKey = `e/${id}.json`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: evidenceKey, ContentType: 'application/json', Body: JSON.stringify({ takenAt: new Date(now).toISOString(), query, ...f }, null, 2) }));
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `a/${id}.${ext}`, Body: bytes, ContentType: mime }));
  const photo: Photo = {
    id,
    name: (f.title || query).slice(0, 160),
    kind: 'image',
    origin: 'discovered',
    key: `a/${id}.${ext}`,
    mime,
    bytes: bytes.length,
    lensPhoto: false,
    checkedPersonal: true,
    rights: { ...photoRights(f, now), evidenceKey },
    status: 'ready',
    createdAt: now,
    createdBy: 'photo-search',
    query,
    sourceUrl: f.sourceUrl,
    w: f.w,
    h: f.h,
  };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `ASSET#${id}`, ...photo } }));
  return photo;
}

/** Found photos only from the stock sites we chose; a person can still pick any cleared one for a post. */
export const fromStock = (p: Photo) => p.origin !== 'discovered' || ['pixabay', 'pexels', 'public-domain', 'cc-by'].includes(licenseKey(p.rights.license));
const usable = (p: Photo | undefined): p is Photo => !!p && p.status === 'ready' && effectiveStatus(p.rights) === 'cleared' && p.looked?.ok !== false && fromStock(p);

/** Up to `n` cleared photos for a search, found live (or reused from the last 30 days). Never throws. */
export async function findPhotos(query: string, n = 3, orientation: 'portrait' | 'landscape' = 'portrait', wide = false): Promise<Photo[]> {
  const q = query.trim().slice(0, 80);
  if (!q || !BUCKET) return [];
  try {
    const sk = `PHOTOQ#${queryKey(q)}${wide ? ':wide' : ''}`;
    const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk } }))).Item;
    if (cached && cached.v === SEARCH_VERSION && Date.now() - cached.at < 30 * DAY) {
      const ids = (cached.ids as string[]).slice(0, 20);
      if (ids.length) {
        const got = await ddb.send(new BatchGetCommand({ RequestItems: { [env.table]: { Keys: ids.map((id) => ({ pk: 'GROWTH', sk: `ASSET#${id}` })) } } }));
        const byId = new Map(((got.Responses?.[env.table] ?? []) as Photo[]).map((p) => [p.id, p]));
        const ok = ids.map((id) => byId.get(id)).filter(usable);
        if (ok.length) return ok.slice(0, n);
      }
    }
    const { found, sources } = await searchSources(q, orientation, wide);
    const saved: Photo[] = [];
    // Cleared ones are saved and used; a couple of people/brand photos are saved for a manager to look at.
    let toReview = 2;
    for (const f of found) {
      const r = photoRights(f);
      if (r.status === 'blocked') continue;
      if (r.status === 'review' && toReview-- <= 0) continue;
      const p = await savePhoto(f, q).catch(() => undefined);
      if (p) saved.push(p);
      if (saved.filter(usable).length >= Math.max(n, 6)) break;
    }
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk, query: q, ids: saved.map((p) => p.id), at: Date.now(), ttl: Math.floor((Date.now() + 31 * DAY) / 1000), v: SEARCH_VERSION, sources } }));
    return saved.filter(usable).slice(0, n);
  } catch {
    return [];
  }
}

/** Cleared photos already in the Library (ours and found ones) to fill phone screens. */
export async function photoPool(): Promise<Photo[]> {
  const items: Photo[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'ASSET#' }, ExclusiveStartKey: start }));
    items.push(...((r.Items ?? []) as Photo[]));
    start = r.LastEvaluatedKey;
  } while (start);
  return items.filter((a) => usable(a) && a.mime.startsWith('image/') && a.kind !== 'render' && a.bytes <= 8 * 1024 * 1024);
}

/** A photo as a data URL for the render page (nothing is loaded from the network while drawing). */
export async function photoData(p: Photo): Promise<string | undefined> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: p.key }));
    return `data:${p.mime};base64,${Buffer.from(await r.Body!.transformToByteArray()).toString('base64')}`;
  } catch {
    return undefined;
  }
}

// ---------- Claude looks at the photos ----------

/** Found photos are only used once Claude has seen them and said yes; our own photos need no look. */
export const photoPassed = (p: Photo) => p.origin !== 'discovered' || p.looked?.ok === true;

export const SHEET_SIZE = 12;

export const PHOTO_CHECK_SYSTEM = `You are the photo editor of a premium consumer app's marketing team. You get one contact sheet of numbered photos and the post they are for. Open the sheet with the Read tool first and judge what you actually see, not any caption. Answer two separate things for every number.

ok: may this photo appear in any of our ads? false if ANY of these is true:
- People used wrongly. People ARE welcome as the moment's mood, the way a film editor uses b-roll: a crowd or audience, people seen from behind or at a distance, hands, silhouettes, a candid moment where nobody poses. Reject: anyone posing for or looking into the camera like a stock model, a close-up where one face is the subject, any close-up of a child's face (children only at a distance, from behind, or as hands), anyone holding a phone with a visible brand, anything that shows a person in a bad light.
- A religious or political ceremony, a place of worship, a protest, a war or disaster, a news or press photo.
- A logo, brand, product, or readable sign or text.
- Not a real photo: painting, print, map, satellite image, diagram, screenshot, rendering.
- Not good enough: dull, amateur, snapshot-like, messy, blurry, dark without a point, dead or ugly subject.
A senior art director must be happy to put it in an Apple-level ad. When in doubt, false: there are always more photos.

fit: 0 to 10, how much would someone seeing this next to this post instantly connect it with what the post is about? Judge against the post itself, not only the search words: for a post about wedding photos, a candle in a dark room is 2 even if the search said "candles", a beautifully set wedding table is 9. 7 or more means it clearly belongs.`;

export const PHOTO_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    photos: {
      type: 'array',
      items: { type: 'object', properties: { n: { type: 'integer' }, ok: { type: 'boolean' }, fit: { type: 'integer', description: '0 to 10' }, why: { type: 'string', description: 'A few words' } }, required: ['n', 'ok', 'fit', 'why'], additionalProperties: false },
    },
  },
  required: ['photos'],
  additionalProperties: false,
};

/** A photo must score this for the post to use it as a scene. */
export const FITS = 7;

/** A numbered grid of up to SHEET_SIZE photos, shown whole (nothing cropped out of sight). */
export function sheetHtml(urls: string[]): string {
  const tiles = urls
    .map((u, i) => `<div style="position:relative;width:400px;height:400px;background:#222"><img src="${u}" style="width:100%;height:100%;object-fit:contain"><b style="position:absolute;left:0;top:0;background:#ff0;color:#000;font:700 34px sans-serif;padding:2px 12px">${i + 1}</b></div>`)
    .join('');
  return `<!doctype html><body style="margin:0;background:#000"><div style="display:flex;flex-wrap:wrap;gap:0;width:1600px">${tiles}</div></body>`;
}

export const sheetPrompt = (file: string, post: string, topics: string[]) => `Open the contact sheet ${file} and judge every number.\n\nThe post these are for:\n${post}\n\n${topics.map((t, i) => `${i + 1}: searched for "${t}"`).join('\n')}`;

/** Claude's answer → a verdict per photo; a number it didn't answer stays unknown (asked again next time). */
export function sheetVerdicts(report: { photos?: { n: number; ok: boolean; fit?: number; why: string }[] } | undefined, count: number): Map<number, { ok: boolean; fit: number; why: string }> {
  const out = new Map<number, { ok: boolean; fit: number; why: string }>();
  for (const v of report?.photos ?? []) if (Number.isInteger(v.n) && v.n >= 1 && v.n <= count) out.set(v.n - 1, { ok: v.ok === true, fit: Math.max(0, Math.min(10, Number(v.fit) || 0)), why: String(v.why ?? '').slice(0, 120) });
  return out;
}

export async function saveLook(p: Photo, v: { ok: boolean; why: string }, now = Date.now()) {
  p.looked = { ok: v.ok, why: v.why, at: now };
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${p.id}` }, UpdateExpression: 'SET looked = :l', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':l': p.looked } }));
}

// ---------- scoring the finished post ----------

/** Below this an image gets one redesign using the critique. */
export const REDO_BELOW = 75;

export const SCORE_SYSTEM = `You are the toughest creative director at a top consumer-app studio. You judge a finished social post for Lens, a camera and photo-backup app, before it goes out on Instagram, Facebook and X. Open every contact sheet with the Read tool and judge what you actually see. Be honest: most work scores 55 to 80, and 90+ is rare.

For each image score 0 to 100:
- relates: does everything in the picture clearly belong to what this post and this slide say? Unrelated photo or a phone showing unrelated photos: under 40. A person posing for the camera, shown as a Lens user or endorser, a close-up of a child's face, a ceremony, religious or press scene, or a photo that tells a different story: 0. People as the moment's mood (an audience, from behind, hands, candid and not posing) are good: they make it real.
- clear: can a stranger scrolling on a phone get the point in 2 seconds? Is the text readable at this small size?
- design: does it look made by a senior designer: one focal point, confident layout, nothing awkward, cropped badly or overlapping?
score = your overall judgement for the image; it can't be more than 15 above relates.
why = the main problem in a few plain words, or what works if nothing is wrong. fix = one concrete instruction for the designer, empty if none.

Also score hook 0 to 100: would the first line stop someone scrolling, and does the post give them a reason to save, share or try Lens?`;

export const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    images: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, score: { type: 'integer' }, relates: { type: 'integer' }, clear: { type: 'integer' }, design: { type: 'integer' }, why: { type: 'string' }, fix: { type: 'string' } },
        required: ['n', 'score', 'relates', 'clear', 'design', 'why', 'fix'],
        additionalProperties: false,
      },
    },
    hook: { type: 'integer' },
    hookWhy: { type: 'string' },
  },
  required: ['images', 'hook', 'hookWhy'],
  additionalProperties: false,
};

export type ImageScore = { label: string; score: number; relates: number; clear: number; design: number; why: string; fix: string };
export type PostScore = { total: number; hook: number; hookWhy: string; images: ImageScore[]; redone: number; at: number };

const pct = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));

/** Claude's answer → scores per label, in frame order; numbers it skipped are simply unscored. */
export function readScores(report: { images?: { n: number; score: number; relates: number; clear: number; design: number; why: string; fix: string }[] } | undefined, labels: string[]): ImageScore[] {
  const out: ImageScore[] = [];
  labels.forEach((label, i) => {
    const v = report?.images?.find((x) => x.n === i + 1);
    if (!v) return;
    const relates = pct(v.relates);
    // Enforced here too: a picture that doesn't belong can't score well however pretty it is.
    out.push({ label, score: Math.min(pct(v.score), relates + 15), relates, clear: pct(v.clear), design: pct(v.design), why: String(v.why ?? '').slice(0, 200), fix: String(v.fix ?? '').slice(0, 300) });
  });
  return out;
}

/** The post's score: mostly its images, the weakest one counts double (one bad slide spoils a carousel), plus the hook. */
export function postTotal(images: ImageScore[], hook: number): number {
  if (!images.length) return 0;
  const scores = images.map((x) => x.score);
  const weighted = (scores.reduce((a, b) => a + b, 0) + Math.min(...scores)) / (scores.length + 1);
  return Math.round(weighted * 0.8 + pct(hook) * 0.2);
}

export const scorePrompt = (files: string[], post: string, labels: string[]) => `Open and judge: ${files.join(', ')}. Numbers run across the sheets.\n\nThe post:\n${post}\n\n${labels.join('\n')}`;
