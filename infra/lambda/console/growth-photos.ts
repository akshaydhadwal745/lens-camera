// Photos from the internet for content images (docs/growth/content-engine.md, phase 3): searched live,
// rights-checked by code (growth-rights.ts) and saved to the Library like any other asset.
//   Sources: Pixabay and Pexels (free keys in SSM /lens/growth/photos {"pixabayKey","pexelsKey"}) and
//   Wikimedia Commons (no key). Pixabay's API asks us to download images rather than hotlink, which is what
//   we do. Unsplash is left out on purpose: its API rules want their hosted image shown, not an edited copy.
//   Only photos the rights check clears are used automatically. Photos whose title or tags suggest people
//   or brands go to the Library as "review" for a manager (free licences have no model/trademark release).
//   GROWTH / ASSET#<id>     the photo (kind image, origin discovered, query, sourceUrl, w, h); file a/<id>.<ext>
//   e/<id>.json             what the source said about the photo and its licence, when we took it
//   GROWTH / PHOTOQ#<hash>  { query, ids, at, ttl }: a search is reused for 30 days
import { createHash } from 'node:crypto';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BatchGetCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, s3 } from '../api/lib';
import type { Asset } from './growth-assets';
import { effectiveStatus, licenseVerdict, type Rights } from './growth-rights';

const BUCKET = process.env.GROWTH_CONTENT_BUCKET ?? '';
const UA = 'LensGrowth/1.0 (https://lens.instagrowapp.com; content images)';
const DAY = 86_400_000;

export type Found = {
  source: 'Wikimedia Commons' | 'Pexels' | 'Pixabay';
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
export type Photo = Asset & { query?: string; sourceUrl?: string; w?: number; h?: number };

/** Words in a title or tags that mean people or brands are probably in the picture. */
export const PEOPLE_OR_BRANDS =
  /\b(portrait|selfie|faces?|man|men|woman|women|girls?|boys?|child|children|kids?|baby|people|persons?|bride|groom|couple|family|friends|singer|artist|band|actor|actress|player|celebrity|model|crowd|audience|fans|logo|brand|trademark|billboard|advert\w*|iphone|samsung|apple|google|pixel)\b/i;

/** Paintings, prints, maps and scans are public domain too, but they aren't photos. */
export const NOT_A_PHOTO = /\b(paintings?|painted|painter|oil on|canvas|drawings?|engraving|etching|lithograph|woodcut|illustrations?|postcards?|posters?|maps?|museum|artworks?|watercolou?r|aquarelle|sketch|scans?|book of|manuscript|fresco|mural|stamps?|coins?|diagram|svg|logo)\b|\b1[5-8]\d\d\b|\b19[0-4]\d\b/i;

/** Enough of the search words appear in the title or tags (Commons search also matches categories loosely). */
export function relevant(f: Pick<Found, 'title' | 'tags'>, query: string): boolean {
  const hay = `${f.title} ${f.tags}`.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const hits = words.filter((w) => hay.includes(w.replace(/s$/, ''))).length;
  return hits >= Math.min(2, words.length);
}

const text = (html: unknown) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

/** Wikimedia Commons search (generator=search, prop=imageinfo with extmetadata) → photos. */
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
        license: text(m.LicenseShortName?.value),
        licenseUrl: text(m.LicenseUrl?.value),
        author: text(m.Artist?.value).slice(0, 120),
        title: String(p.title ?? '').replace(/^File:/, '').replace(/\.\w+$/, ''),
        tags: `${text(m.ImageDescription?.value).slice(0, 400)} ${text(m.Categories?.value).replace(/\|/g, ' ')}`,
      };
    })
    .filter((f) => f.sourceUrl && f.imageUrl && f.w >= 1000 && !NOT_A_PHOTO.test(`${f.title} ${f.tags}`));
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
        title: String(p.tags ?? '').slice(0, 200),
        tags: String(p.tags ?? ''),
      };
    })
    .filter((f) => f.sourceUrl && f.imageUrl && f.w >= 800);
}

/** The rights record: the licence decides (growth-rights.ts); people/brands are judged from the words. */
export function photoRights(f: Found, now = Date.now()): Rights {
  const people = PEOPLE_OR_BRANDS.test(`${f.title} ${f.tags}`);
  const v = licenseVerdict(f.license, people);
  return {
    status: v.status,
    license: f.license,
    licenseUrl: f.licenseUrl,
    source: f.sourceUrl,
    author: f.author,
    credit: '',
    commercialOk: v.commercialOk,
    editsOk: v.editsOk,
    peopleOrBrands: people,
    reason: `${v.reason}. Found by the content engine; people and brands judged from the photo's title and tags, so look at it when you approve the post.`,
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

async function searchSources(query: string, orientation: 'portrait' | 'landscape'): Promise<Found[]> {
  const out: Found[] = [];
  const keys = await getParam('/lens/growth/photos')
    .then((v) => (v ? (JSON.parse(v) as { pixabayKey?: string; pexelsKey?: string }) : {}))
    .catch(() => ({}) as { pixabayKey?: string; pexelsKey?: string });
  if (keys.pixabayKey) {
    const u = `https://pixabay.com/api/?${new URLSearchParams({ key: keys.pixabayKey, q: query.slice(0, 100), image_type: 'photo', orientation: orientation === 'portrait' ? 'vertical' : 'horizontal', safesearch: 'true', per_page: '20', order: 'popular' })}`;
    out.push(...pixabayResults(await getJson(u).catch(() => ({}))));
  }
  if (keys.pexelsKey) {
    const u = `https://api.pexels.com/v1/search?${new URLSearchParams({ query, orientation, per_page: '15', size: 'large' })}`;
    out.push(...pexelsResults(await getJson(u, { Authorization: keys.pexelsKey }).catch(() => ({}))));
  }
  const wm = (extra: string) =>
    `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: `${query} filetype:bitmap${extra}`, gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1600' })}`;
  // Quality images first (photos reviewed by the Commons community), then any; on topic only.
  for (const extra of [' incategory:Quality_images', '']) out.push(...wikimediaResults(await getJson(wm(extra)).catch(() => ({}))).filter((f) => relevant(f, query)));
  const seen = new Set<string>();
  return out.filter((f) => !seen.has(f.sourceUrl) && seen.add(f.sourceUrl));
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

const usable = (p: Photo | undefined): p is Photo => !!p && p.status === 'ready' && effectiveStatus(p.rights) === 'cleared';

/** Up to `n` cleared photos for a search, found live (or reused from the last 30 days). Never throws. */
export async function findPhotos(query: string, n = 3, orientation: 'portrait' | 'landscape' = 'portrait'): Promise<Photo[]> {
  const q = query.trim().slice(0, 80);
  if (!q || !BUCKET) return [];
  try {
    const sk = `PHOTOQ#${queryKey(q)}`;
    const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk } }))).Item;
    if (cached && Date.now() - cached.at < 30 * DAY) {
      const ids = (cached.ids as string[]).slice(0, 20);
      if (ids.length) {
        const got = await ddb.send(new BatchGetCommand({ RequestItems: { [env.table]: { Keys: ids.map((id) => ({ pk: 'GROWTH', sk: `ASSET#${id}` })) } } }));
        const byId = new Map(((got.Responses?.[env.table] ?? []) as Photo[]).map((p) => [p.id, p]));
        const ok = ids.map((id) => byId.get(id)).filter(usable);
        if (ok.length) return ok.slice(0, n);
      }
    }
    const found = await searchSources(q, orientation);
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
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk, query: q, ids: saved.map((p) => p.id), at: Date.now(), ttl: Math.floor((Date.now() + 31 * DAY) / 1000) } }));
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
