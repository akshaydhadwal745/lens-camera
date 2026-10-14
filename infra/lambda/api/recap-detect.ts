// Trip and event detection for recaps (docs/design/switch-features.md §4). Pure
// functions over metadata the server already has (capture time, nearest city),
// so they're cheap, need no phone work and are unit-tested (recap-detect.test.ts).
import { createHash } from 'node:crypto';

export type RecapInput = {
  id: string;
  kind: 'photo' | 'video';
  createdAt: number;
  width?: number;
  height?: number;
  place?: { city: string; country: string };
};

export type Recap = {
  /** Stable for the same stretch of photos (first + last item). */
  key: string;
  kind: 'trip' | 'event';
  title: string;
  start: number;
  end: number;
  /** Everything worth keeping (near-duplicates dropped), oldest first: the album. */
  items: string[];
  /** Up to FILM_MAX photos spread over the whole time: the film. */
  film: string[];
  orientation: 'portrait' | 'landscape';
  cover: string;
};

const HOUR = 3600 * 1000;
/** A gap this long starts a new "moment". */
const MOMENT_GAP = 8 * HOUR;
/** Away-from-home moments this close together are one trip. */
const TRIP_GAP = 36 * HOUR;
const MIN_TRIP = 12;
const MIN_EVENT = 20;
const MAX_EVENT_SPAN = 14 * HOUR;
/** Shots this close to the previous kept one count as the same moment (bursts, retakes). */
const NEAR_DUPLICATE_MS = 3000;
export const FILM_MAX = 30;
const ALBUM_MAX = 200;
/** Still going on (photos in the last few hours): not suggested yet. */
const SETTLE = 6 * HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const placeKey = (p?: { city: string; country: string }) => (p ? `${p.city}|${p.country}` : null);

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/** Where they live: the most common city, if enough photos carry a place to say. */
export function homeOf(items: RecapInput[]): string | null {
  const placed = items.map((i) => placeKey(i.place)).filter(Boolean);
  return placed.length >= 5 ? mostCommon(placed) : null;
}

/** Splits a time-sorted list where the gap between neighbours exceeds `gap`. */
function split(items: RecapInput[], gap: number): RecapInput[][] {
  const groups: RecapInput[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && item.createdAt - last[last.length - 1].createdAt <= gap) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

/** Drops shots taken within NEAR_DUPLICATE_MS of the previous one kept. */
export function dropNearDuplicates(items: RecapInput[]): RecapInput[] {
  const out: RecapInput[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.kind === item.kind && item.createdAt - last.createdAt < NEAR_DUPLICATE_MS) continue;
    out.push(item);
  }
  return out;
}

/** `n` items spread evenly over the list (first and last included). */
export function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  return out;
}

function dayLabel(t: number): string {
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function rangeLabel(start: number, end: number): string {
  const a = new Date(start);
  const b = new Date(end);
  if (a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()) {
    return a.getUTCDate() === b.getUTCDate() ? dayLabel(start) : `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
  }
  return `${dayLabel(start)} – ${dayLabel(end)}`;
}

function build(kind: Recap['kind'], group: RecapInput[], offsetMs: number): Recap {
  const kept = dropNearDuplicates(group);
  const photos = kept.filter((i) => i.kind === 'photo');
  const film = spread(photos, FILM_MAX);
  const city = mostCommon(group.map((i) => placeKey(i.place)))?.split('|')[0];
  // Dates in the person's own time zone (offset from the request), not UTC.
  const start = group[0].createdAt;
  const end = group[group.length - 1].createdAt;
  const when = rangeLabel(start + offsetMs, end + offsetMs);
  const portrait = film.filter((i) => (i.height ?? 0) > (i.width ?? 0)).length;
  return {
    key: createHash('sha256').update(`${group[0].id}|${group[group.length - 1].id}`).digest('base64url').slice(0, 16),
    kind,
    title: city ? `${city} · ${when}` : when,
    start,
    end,
    items: spread(kept, ALBUM_MAX).map((i) => i.id),
    film: film.map((i) => i.id),
    orientation: portrait * 2 >= film.length ? 'portrait' : 'landscape',
    cover: (film[Math.floor(film.length / 3)] ?? kept[0]).id,
  };
}

/**
 * Trips (away from home: consecutive moments in other places) and events (a lot
 * of photos in one stretch of hours, e.g. a wedding or a party), newest first.
 * `offsetMs`: the person's time zone, for titles.
 */
export function findRecaps(all: RecapInput[], now: number, offsetMs = 0): Recap[] {
  const items = [...all].sort((a, b) => a.createdAt - b.createdAt);
  const home = homeOf(items);
  const moments = split(items, MOMENT_GAP);
  const recaps: Recap[] = [];
  let trip: RecapInput[] = [];
  const flushTrip = () => {
    if (trip.length >= MIN_TRIP) recaps.push(build('trip', trip, offsetMs));
    trip = [];
  };
  for (const moment of moments) {
    const where = mostCommon(moment.map((i) => placeKey(i.place)));
    const away = home !== null && where !== null && where !== home;
    if (away) {
      const last = trip[trip.length - 1];
      if (last && moment[0].createdAt - last.createdAt > TRIP_GAP) flushTrip();
      trip.push(...moment);
      continue;
    }
    flushTrip();
    const span = moment[moment.length - 1].createdAt - moment[0].createdAt;
    if (moment.length >= MIN_EVENT && span <= MAX_EVENT_SPAN) recaps.push(build('event', moment, offsetMs));
  }
  flushTrip();
  // Still happening: wait until it has settled.
  return recaps.filter((r) => now - r.end >= SETTLE && r.film.length >= 2).sort((a, b) => b.end - a.end);
}
