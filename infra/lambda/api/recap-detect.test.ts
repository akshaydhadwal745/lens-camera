// Run: cd infra && npx tsx --test lambda/api/recap-detect.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dropNearDuplicates, findRecaps, homeOf, RecapInput, spread } from './recap-detect';

const H = 3600 * 1000;
const DAY = 24 * H;
const T0 = Date.UTC(2026, 9, 1, 8); // 1 Oct 2026, 08:00 UTC
const HOME = { city: 'Chandigarh', country: 'IN' };
const GOA = { city: 'Goa', country: 'IN' };

let n = 0;
function shot(at: number, place?: { city: string; country: string }, extra: Partial<RecapInput> = {}): RecapInput {
  n += 1;
  return { id: `${at.toString(36)}-${n}`, kind: 'photo', createdAt: at, width: 3000, height: 4000, place, ...extra };
}
/** `count` photos `every` ms apart from `start`. */
function burst(start: number, count: number, every: number, place?: { city: string; country: string }): RecapInput[] {
  return Array.from({ length: count }, (_, i) => shot(start + i * every, place));
}

test('home is the most common city once enough photos have a place', () => {
  assert.equal(homeOf([...burst(T0, 4, H, HOME)]), null);
  assert.equal(homeOf([...burst(T0, 6, H, HOME), ...burst(T0 + 10 * DAY, 3, H, GOA)]), 'Chandigarh|IN');
});

test('near-duplicates (bursts, retakes) collapse to one shot', () => {
  const kept = dropNearDuplicates([shot(T0), shot(T0 + 500), shot(T0 + 1500), shot(T0 + 5000)]);
  assert.equal(kept.length, 2);
});

test('spread picks evenly, first and last included', () => {
  assert.deepEqual(spread([0, 1, 2, 3, 4, 5, 6, 7, 8], 3), [0, 4, 8]);
  assert.deepEqual(spread([1, 2], 5), [1, 2]);
});

test('a trip away from home becomes one recap across days; home days do not', () => {
  const items = [
    ...burst(T0, 30, 2 * H, HOME), // two-and-a-half days at home, spread out: no event
    ...burst(T0 + 5 * DAY, 10, 20 * 60 * 1000, GOA), // day 1 in Goa
    ...burst(T0 + 6 * DAY, 10, 20 * 60 * 1000, GOA), // day 2 in Goa (overnight gap < 36 h)
    ...burst(T0 + 9 * DAY, 6, H, HOME),
  ];
  const recaps = findRecaps(items, T0 + 20 * DAY);
  assert.equal(recaps.length, 1);
  assert.equal(recaps[0].kind, 'trip');
  assert.equal(recaps[0].items.length, 20);
  assert.match(recaps[0].title, /^Goa · 6–7 Oct$/);
});

test('an event: many photos within hours, even at home (no place needed)', () => {
  const items = [...burst(T0, 40, 10 * 60 * 1000), ...burst(T0 + 3 * DAY, 5, H)];
  const recaps = findRecaps(items, T0 + 10 * DAY);
  assert.equal(recaps.length, 1);
  assert.equal(recaps[0].kind, 'event');
  assert.equal(recaps[0].title, '1 Oct');
  assert.ok(recaps[0].film.length <= 30 && recaps[0].film.length >= 2);
});

test('not suggested while it is still going on', () => {
  const items = burst(T0, 40, 10 * 60 * 1000);
  const end = items[items.length - 1].createdAt;
  assert.equal(findRecaps(items, end + 2 * H).length, 0);
  assert.equal(findRecaps(items, end + 7 * H).length, 1);
});

test('the same stretch of photos keeps the same key; the film is portrait when most photos are', () => {
  const items = burst(T0, 25, 15 * 60 * 1000);
  const a = findRecaps(items, T0 + 5 * DAY)[0];
  const b = findRecaps([...items].reverse(), T0 + 6 * DAY)[0];
  assert.equal(a.key, b.key);
  assert.equal(a.orientation, 'portrait');
});

test('titles use the person’s own time zone', () => {
  // 1 Oct 20:00 UTC is already 2 Oct in India (+5:30).
  const items = burst(Date.UTC(2026, 9, 1, 20), 25, 5 * 60 * 1000);
  const r = findRecaps(items, Date.UTC(2026, 9, 10), 5.5 * H)[0];
  assert.equal(r.title, '2 Oct');
});
