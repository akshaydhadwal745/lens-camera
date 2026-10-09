// Intent preloading (Instagram-style): when the user is likely to open a video
// (finger on its tile, its poster showing in the viewer, scrolling stopped near
// it), resolve where it plays from and buffer its first ~3 s in a hidden
// player. The player page then takes that same player, so playback starts
// at once. Cost-first: max 2 hidden players; on mobile data only strong
// signals (touch, viewer); nothing when the phone is hot.
import { Image } from 'expo-image';
import { createVideoPlayer, setVideoCacheSizeAsync, VideoPlayer, VideoSource } from 'expo-video';
import { Platform } from 'react-native';

import { api } from './api';
import { originalSource } from './storage';
import type { GalleryItem } from './types';

/** high: touch / viewer · medium: scroll stopped, gallery opened · low: viewer neighbours. */
export type Intent = 'high' | 'medium' | 'low';
const RANK: Record<Intent, number> = { high: 3, medium: 2, low: 1 };

const MAX_PLAYERS = 2;
/** Seconds buffered ahead by a hidden player. */
const PRELOAD_SECONDS = 3;
/** Unused hidden players are released after this long. */
const IDLE_MS = 45_000;
/** Disk cache for video bytes (preloaded starts, replays). */
const CACHE_BYTES = 200 * 1024 * 1024;

// Same rule as useStream: long or big cloud videos stream (HLS).
const LONG_SECONDS = 60;
const BIG_BYTES = 100 * 1024 * 1024;
/** Stream links are valid 6 h; reuse an answer for 1 h. */
const STREAM_TTL_MS = 60 * 60 * 1000;

export type StreamAnswer = { url: string | null; preparing: boolean; at: number };

type Context = { cellular: boolean; hot: boolean };
let context: Context = { cellular: false, hot: false };

/** The store tells us about the network and heat (avoids an import cycle). */
export function setPrefetchContext(next: Context) {
  context = next;
}

// ---------- Stream answers (shared with useStream: no extra round trip on open) ----------

const streams = new Map<string, StreamAnswer>();
const asking = new Map<string, Promise<StreamAnswer>>();

export function streamEligible(item: GalleryItem): boolean {
  return (
    item.kind === 'video' &&
    !item.localUri &&
    !item.location &&
    ((item.duration ?? 0) >= LONG_SECONDS || (item.size ?? 0) >= BIG_BYTES)
  );
}

export function cachedStream(id: string): StreamAnswer | undefined {
  const s = streams.get(id);
  // "Preparing" answers go stale fast (the conversion finishes in about a minute).
  if (!s || Date.now() - s.at > (s.preparing ? 20_000 : STREAM_TTL_MS)) return undefined;
  return s;
}

export function askStream(item: GalleryItem): Promise<StreamAnswer> {
  const hit = cachedStream(item.id);
  if (hit) return Promise.resolve(hit);
  const pending = asking.get(item.id);
  if (pending) return pending;
  const p = api
    .stream(item.id, item.ownerId)
    .then((r) => ({ url: r.status === 'ready' ? (r.url ?? null) : null, preparing: r.status === 'preparing', at: Date.now() }))
    .catch(() => ({ url: null, preparing: false, at: Date.now() }))
    .then((answer) => {
      streams.set(item.id, answer);
      asking.delete(item.id);
      return answer;
    });
  asking.set(item.id, p);
  return p;
}

// ---------- Where a video plays from ----------

/** The source the player page would use (same order: stream, local, cloud, own storage). */
export async function resolveVideoSource(item: GalleryItem): Promise<VideoSource | null> {
  if (streamEligible(item)) {
    const answer = await askStream(item);
    if (answer.url) return { uri: answer.url, useCaching: true };
  }
  const direct = item.localUri ?? item.remoteUrl;
  if (direct) return isRemote(direct) ? { uri: direct, useCaching: true } : { uri: direct };
  if (item.location && !item.ownerName) {
    const source = await originalSource(item.location).catch(() => null);
    return source ? { uri: source.uri, headers: source.headers } : null;
  }
  return null;
}

const isRemote = (uri: string) => uri.startsWith('http');

// ---------- Hidden players ----------

type Entry = { player: VideoPlayer; intent: Intent; used: number; key: string };
const pool = new Map<string, Entry>();
const loading = new Set<string>();
let cacheSized = false;

function allowed(intent: Intent, item: GalleryItem): boolean {
  if (Platform.OS === 'web' || context.hot) return false;
  // Videos on this phone cost no data: always fine to warm up the player.
  if (item.localUri && !isRemote(item.localUri)) return true;
  return !context.cellular || intent === 'high';
}

/** A likely open: buffer the start of this video (no-op if not allowed or already warm). */
export function prefetchVideo(item: GalleryItem | undefined, intent: Intent) {
  if (!item || item.kind !== 'video' || !allowed(intent, item)) return;
  const existing = pool.get(item.id);
  if (existing) {
    existing.used = Date.now();
    if (RANK[intent] > RANK[existing.intent]) existing.intent = intent;
    return;
  }
  if (loading.has(item.id)) return;
  loading.add(item.id);
  if (!cacheSized) {
    cacheSized = true;
    void setVideoCacheSizeAsync(CACHE_BYTES).catch(() => {});
  }
  void resolveVideoSource(item)
    .then((source) => {
      if (!source || typeof source !== 'object' || !source.uri) return;
      makeRoom(intent);
      if (pool.size >= MAX_PLAYERS) return; // only stronger intents are warm
      // Small buffer first, then the source: it loads only the first few seconds.
      const player = createVideoPlayer(null);
      player.muted = true;
      player.bufferOptions = { preferredForwardBufferDuration: PRELOAD_SECONDS, minBufferForPlayback: 1 };
      void player.replaceAsync(source).catch(() => release(item.id));
      pool.set(item.id, { player, intent, used: Date.now(), key: source.uri });
      scheduleSweep();
    })
    .catch(() => {})
    .finally(() => loading.delete(item.id));
}

/** Frees a slot for `intent`: drops the weakest, oldest hidden player if it's not stronger. */
function makeRoom(intent: Intent) {
  if (pool.size < MAX_PLAYERS) return;
  const weakest = [...pool.entries()].sort((a, b) => RANK[a[1].intent] - RANK[b[1].intent] || a[1].used - b[1].used)[0];
  if (weakest && RANK[weakest[1].intent] <= RANK[intent]) release(weakest[0]);
}

function release(id: string) {
  const entry = pool.get(id);
  if (!entry) return;
  pool.delete(id);
  try {
    entry.player.release();
  } catch {
    // Already gone.
  }
}

let sweepTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSweep() {
  if (sweepTimer) return;
  sweepTimer = setTimeout(() => {
    sweepTimer = null;
    const now = Date.now();
    for (const [id, e] of pool) if (now - e.used > IDLE_MS) release(id);
    if (pool.size) scheduleSweep();
  }, IDLE_MS);
}

/**
 * The player page takes a warm player (it becomes the page's to release).
 * Its buffer goes back to normal so playback continues smoothly.
 */
export function takePreloaded(id: string): VideoPlayer | null {
  const entry = pool.get(id);
  if (!entry) return null;
  pool.delete(id);
  entry.player.bufferOptions = { preferredForwardBufferDuration: 20, minBufferForPlayback: 2 }; // Android defaults
  entry.player.muted = false;
  return entry.player;
}

/** Scrolled/swiped away: drop weak preloads that aren't among `keep`. */
export function keepOnly(keep: string[]) {
  const wanted = new Set(keep);
  for (const [id, e] of pool) if (!wanted.has(id) && e.intent !== 'high') release(id);
}

// ---------- Photos ----------

/** Finger on a photo tile (Wi-Fi): start fetching the full-quality original. */
export function prefetchPhoto(item: GalleryItem | undefined) {
  if (!item || item.kind !== 'photo' || context.cellular || context.hot || item.localUri || !item.remoteUrl) return;
  void Image.prefetch(item.remoteUrl, 'memory-disk').catch(() => {});
}
