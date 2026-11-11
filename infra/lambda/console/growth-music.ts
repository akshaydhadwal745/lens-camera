// Music for reels, found automatically (owner 2026-11-10: "I want automation for music as well"). Openverse's
// audio search (no key; Jamendo, ccMixter, Freesound and more) by the writer's mood, only CC0 / public domain /
// CC BY music, 1–7 minutes, instrumental-looking. Each track used is saved as a Library asset (kind audio, origin
// discovered, rights from the licence, evidence e/<id>.json) so the post's Export carries its credit line, and so
// the next reel reuses it. Which 20–30 s of the track plays is chosen from its loudness (no quiet intro, starting
// on a strong beat). Searches are cached 30 days (MUSICQ#<mood>).
//   GROWTH / ASSET#<id>     the track (mime audio/mpeg, mood, sourceUrl), file a/<id>.mp3
//   GROWTH / MUSICQ#<mood>  { ids, at, v } the tracks found for a mood
import { createHash } from 'node:crypto';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { BatchGetCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, s3 } from '../api/lib';
import type { Asset } from './growth-assets';
import { effectiveStatus, licenseVerdict, type Rights } from './growth-rights';

const BUCKET = process.env.GROWTH_CONTENT_BUCKET ?? '';
const UA = 'LensGrowth/1.0 (https://lens.instagrowapp.com; reel music)';
const DAY = 86_400_000;
const VERSION = 1;

export const MOOD_QUERIES: Record<string, string[]> = {
  upbeat: ['upbeat', 'happy pop', 'feel good', 'upbeat corporate'],
  chill: ['chill', 'lounge', 'ambient background', 'relaxing'],
  emotional: ['emotional piano', 'cinematic emotional', 'inspirational'],
  energetic: ['energetic', 'electronic dance', 'action', 'trance'],
  warm: ['acoustic', 'acoustic guitar', 'folk instrumental', 'warm'],
};

export type Track = { sourceUrl: string; url: string; title: string; author: string; license: string; licenseUrl: string; seconds: number; genres: string; provider: string };

/** Words that mean someone sings over it (a reel's words and effects need the space). */
const VOCALS = /\b(feat\.?|ft\.|vocals?|lyrics?|singing|sung|song for|rap|acapella|a cappella|karaoke|voice|choir|spoken|podcast|interview|remix)\b/i;
const NOT_MUSIC = /\b(sound effects?|sfx|field recording|noise|test tone|ringtone|loop pack|sample pack|demo)\b/i;
const GOOD = /\b(instrumental|background|underscore|corporate|cinematic|ambient|lounge|piano|acoustic|beat|inspirational)\b/i;

/** Openverse audio results → tracks we may use, best first. */
export function openverseTracks(json: any): Track[] {
  const name = (r: any) => {
    const l = String(r.license ?? '').toLowerCase();
    if (l === 'cc0') return 'CC0';
    if (l === 'pdm') return 'Public domain';
    return `CC ${l.toUpperCase()} ${String(r.license_version ?? '').trim()}`.trim();
  };
  return ((json?.results ?? []) as any[])
    .map((r) => ({
      sourceUrl: String(r.foreign_landing_url ?? ''),
      url: String(r.url ?? ''),
      title: String(r.title ?? '').slice(0, 120),
      author: String(r.creator ?? '').slice(0, 120),
      license: name(r),
      licenseUrl: String(r.license_url ?? ''),
      seconds: Math.round((Number(r.duration) || 0) / 1000),
      genres: [...((r.genres ?? []) as string[]), ...((r.tags ?? []) as { name?: string }[]).map((t) => t?.name ?? '')].filter(Boolean).join(', ').slice(0, 300),
      provider: String(r.provider ?? r.source ?? ''),
      mature: r.mature === true,
    }))
    .filter((t) => !t.mature && /^https:/.test(t.url) && /^https:/.test(t.sourceUrl) && t.seconds >= 60 && t.seconds <= 420 && ['cc0', 'public domain', 'cc by'].some((k) => t.license.toLowerCase().startsWith(k)) && !/-(nc|nd|sa)\b/i.test(t.license) && !VOCALS.test(`${t.title} ${t.genres}`) && !NOT_MUSIC.test(`${t.title} ${t.genres}`))
    .map(({ mature: _m, ...t }) => t)
    .sort((a, b) => Number(GOOD.test(`${b.title} ${b.genres}`)) - Number(GOOD.test(`${a.title} ${a.genres}`)));
}

export const trackId = (sourceUrl: string) => createHash('sha256').update(`music|${sourceUrl}`).digest('hex').slice(0, 12);

export function trackRights(t: Track, now = Date.now()): Rights {
  const v = licenseVerdict(t.license, false);
  return { status: v.status, license: t.license, licenseUrl: t.licenseUrl, source: t.sourceUrl, author: t.author, credit: '', commercialOk: v.commercialOk, editsOk: v.editsOk, peopleOrBrands: false, reason: `${v.reason}. Music found by the content engine on Openverse (${t.provider}); judged from its title and tags, so listen before you post.`, checkedAt: now, checkedBy: 'music-search' };
}

async function saveTrack(t: Track, mood: string): Promise<Asset | undefined> {
  const id = trackId(t.sourceUrl);
  const old = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${id}` } }))).Item as Asset | undefined;
  if (old) return old;
  const r = await fetch(t.url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  const type = (r.headers.get('content-type') ?? '').split(';')[0];
  if (!r.ok || !/^audio\/|octet-stream/.test(type)) return undefined;
  const body = Buffer.from(await r.arrayBuffer());
  // An MP3 starts with an ID3 tag or a frame sync; anything else isn't the file we asked for.
  if (body.length < 200_000 || body.length > 25 * 1024 * 1024 || !(body.toString('latin1', 0, 3) === 'ID3' || (body[0] === 0xff && (body[1] & 0xe0) === 0xe0))) return undefined;
  const now = Date.now();
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `e/${id}.json`, ContentType: 'application/json', Body: JSON.stringify({ takenAt: new Date(now).toISOString(), mood, ...t }, null, 2) }));
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `a/${id}.mp3`, Body: body, ContentType: 'audio/mpeg' }));
  const asset = {
    id,
    name: t.title || 'Music',
    kind: 'audio',
    origin: 'discovered',
    key: `a/${id}.mp3`,
    mime: 'audio/mpeg',
    bytes: body.length,
    lensPhoto: false,
    checkedPersonal: true,
    rights: { ...trackRights(t, now), evidenceKey: `e/${id}.json` },
    status: 'ready',
    createdAt: now,
    createdBy: 'music-search',
    mood,
    sourceUrl: t.sourceUrl,
    seconds: t.seconds,
  } as unknown as Asset;
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `ASSET#${id}`, ...asset } }));
  return asset;
}

const usable = (a: Asset | undefined): a is Asset => !!a && a.status === 'ready' && effectiveStatus(a.rights) === 'cleared' && a.mime.startsWith('audio/');

/** Tracks for a mood: cached for 30 days, else searched and saved (up to 6). Never throws. */
export async function findMusic(mood: string, queries?: string[]): Promise<Asset[]> {
  if (!BUCKET) return [];
  const m = MOOD_QUERIES[mood] ? mood : 'upbeat';
  // This week's trending styles (growth-sound-trends.ts) search with their own words and cache under their own key.
  const qs = queries?.length ? queries.slice(0, 4) : MOOD_QUERIES[m];
  try {
    const sk = queries?.length ? `MUSICQ#t:${createHash('sha256').update(qs.join('|')).digest('hex').slice(0, 12)}` : `MUSICQ#${m}`;
    const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk } }))).Item;
    if (cached && cached.v === VERSION && Date.now() - cached.at < 30 * DAY && (cached.ids as string[]).length) {
      const got = await ddb.send(new BatchGetCommand({ RequestItems: { [env.table]: { Keys: (cached.ids as string[]).slice(0, 20).map((id) => ({ pk: 'GROWTH', sk: `ASSET#${id}` })) } } }));
      const ok = ((got.Responses?.[env.table] ?? []) as Asset[]).filter(usable);
      if (ok.length) return ok;
    }
    const seen = new Set<string>();
    const found: Track[] = [];
    for (const q of qs) {
      const r = await fetch(`https://api.openverse.org/v1/audio/?${new URLSearchParams({ q, license: 'cc0,pdm,by', category: 'music', page_size: '20', mature: 'false' })}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
      if (!r?.ok) continue;
      for (const t of openverseTracks(await r.json())) if (!seen.has(t.sourceUrl) && seen.add(t.sourceUrl)) found.push(t);
    }
    const saved: Asset[] = [];
    for (const t of found) {
      if (saved.length >= 6) break;
      const a = await saveTrack(t, m).catch(() => undefined);
      if (usable(a)) saved.push(a);
    }
    console.log(JSON.stringify({ musicSearch: m, found: found.length, saved: saved.map((a) => a.name) }));
    if (saved.length) await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk, ids: saved.map((a) => a.id), at: Date.now(), v: VERSION, ttl: Math.floor((Date.now() + 31 * DAY) / 1000) } }));
    return saved;
  } catch (e) {
    console.error(JSON.stringify({ musicFailed: (e as Error).message.slice(0, 200) }));
    return [];
  }
}

/**
 * Where the reel's music starts, in seconds: the loudest stretch of `seconds` (no quiet intro, no fade-out),
 * nudged to the strongest beat near its start. `env` = loudness per 50 ms frame (mono analysis copy).
 */
export function bestStart(envelope: Float32Array, seconds: number, frame = 0.05): number {
  const w = Math.max(1, Math.round(seconds / frame));
  if (envelope.length <= w) return 0;
  // Leave the track's last 10% alone (endings fade); prefer the first half, where songs build.
  const last = Math.max(1, Math.floor(envelope.length * 0.9) - w);
  let sum = 0;
  for (let i = 0; i < w; i++) sum += envelope[i];
  let best = 0, bestScore = -1;
  for (let s = 0; s <= last; s++) {
    if (s) sum += envelope[s + w - 1] - envelope[s - 1];
    const score = (sum / w) * (s < envelope.length / 2 ? 1 : 0.92);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  // The strongest rise in loudness within ±1 s: start on a hit, not mid-note.
  let at = best, rise = -Infinity;
  for (let s = Math.max(1, best - 20); s <= Math.min(envelope.length - 1, best + 20); s++) {
    const d = envelope[s] - envelope[s - 1];
    if (d > rise) { rise = d; at = s; }
  }
  return Math.max(0, at * frame - 0.02);
}

/**
 * Cuts on the beat (owner 2026-11-11, "real editing"): the scene lengths are fixed by the voiceover, so the
 * music moves instead. Within ±1 s of `start`, the offset whose strongest hits (rises in loudness) fall on the
 * reel's cuts. `cuts` = seconds from the reel's start; `envelope` as in bestStart. Pure.
 */
export function alignToCuts(envelope: Float32Array, start: number, cuts: number[], frame = 0.05): number {
  if (!cuts.length || envelope.length < 3) return start;
  const onset = new Float32Array(envelope.length);
  for (let i = 1; i < envelope.length; i++) onset[i] = Math.max(0, envelope[i] - envelope[i - 1]);
  const hit = (t: number) => {
    const i = Math.round(t / frame);
    return Math.max(onset[i - 1] ?? 0, onset[i] ?? 0, onset[i + 1] ?? 0);
  };
  let best = start, bestScore = -1;
  for (let d = -1; d <= 1.0001; d += frame) {
    const from = start + d;
    if (from < 0) continue;
    // A small pull towards the loudest stretch, so a tie keeps it.
    const score = cuts.reduce((a, c) => a + hit(from + c), 0) - Math.abs(d) * 1e-4;
    if (score > bestScore) { bestScore = score; best = from; }
  }
  return Math.round(best * 100) / 100;
}

/** Loudness per 50 ms frame from mono float32 at `rate`. */
export function loudness(mono: Float32Array, rate: number, frame = 0.05): Float32Array {
  const n = Math.floor(mono.length / (rate * frame));
  const out = new Float32Array(n);
  const k = Math.floor(rate * frame);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (let j = i * k; j < (i + 1) * k; j++) e += mono[j] * mono[j];
    out[i] = Math.sqrt(e / k);
  }
  return out;
}
