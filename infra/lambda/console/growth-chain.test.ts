import assert from 'node:assert/strict';
import { test } from 'node:test';

import { photoDayMoments, score, SENSITIVE } from '../api/growth-moments';
import { nextStep } from './growth-chain';
import { momentBrief } from './growth-moments';
import { nameWords, readScouted } from './growth-scout';

const free = { analyst: true, render: true, reel: true };

test('chain: drafts first, then images, then the reel once images are done; busy jobs wait', () => {
  const task = { id: 'T-1', status: 'ready', type: 'social', spec: { makeAll: true } };
  const reel = { id: 'r', status: 'in_review', format: 'reel', make: { images: 'todo', reel: 'todo' } };
  const car = { id: 'c', status: 'in_review', format: 'carousel', make: { images: 'done', reel: 'none' } };
  assert.deepEqual(nextStep([task], [reel], free), { kind: 'draft', taskId: 'T-1' });
  assert.equal(nextStep([task], [reel], { ...free, analyst: false })?.kind, 'images');
  assert.equal(nextStep([], [reel], free)?.kind, 'images');
  assert.equal(nextStep([], [{ ...reel, make: { images: 'done', reel: 'todo' } }], free)?.kind, 'reel');
  assert.equal(nextStep([], [{ ...reel, make: { images: 'done', reel: 'todo' } }], { ...free, reel: false }), undefined);
  assert.equal(nextStep([], [car], free), undefined);
  assert.equal(nextStep([{ ...task, spec: {} }], [], free), undefined); // only "Make content" tasks
  assert.equal(nextStep([], [{ ...reel, status: 'published' }], free), undefined);
});

test('photo days: computed dates (Mother’s Day, Father’s Day) and fixed ones in the window', () => {
  const days = photoDayMoments('2026-05-01', '2026-06-30').map((m) => `${m.day} ${m.title}`);
  assert.ok(days.includes("2026-05-10 Mother's Day"));
  assert.ok(days.includes("2026-06-21 Father's Day"));
  assert.ok(photoDayMoments('2026-12-20', '2027-01-10').some((m) => m.day === '2026-12-31'));
});

test('moment brief asks for the full set: a reel, a carousel and an X post', () => {
  const b = momentBrief({ id: 'a', title: 'Halloween', kind: 'festival', day: '2026-10-31', countries: ['US'], source: 's', url: 'u', score: 80, angle: 'night photos', formats: ['reel'], hashtags: ['#Halloween'] }, '2026-10-20');
  assert.match(b.description, /reel .*carousel .*X post/s);
});

test('party days: Super Bowl Sunday and Oktoberfest on their real dates', () => {
  const d = photoDayMoments('2026-01-01', '2026-12-31').map((m) => `${m.day} ${m.title}`);
  assert.ok(d.includes('2026-02-08 Super Bowl Sunday parties'));
  assert.ok(d.includes('2026-09-19 Oktoberfest begins'));
  assert.ok(d.includes("2026-12-31 New Year's Eve parties"));
});

test('moments: mourning and solemn days never; Japan’s Labor Thanksgiving is not Thanksgiving', () => {
  for (const t of ['Sunday of the Dead', 'Commemoration Day', 'Repentance Day (Saxony)', 'Black Awareness Day', 'Ash Wednesday']) assert.ok(SENSITIVE.test(t), t);
  assert.ok(!SENSITIVE.test('Christmas party season'));
  const s = (title: string) => score({ title, kind: 'holiday', day: '2026-11-23', countries: ['JP'], source: 's', url: 'u' });
  assert.ok(s('Labor Thanksgiving Day') < s('Thanksgiving Day'));
});

test('chain: a post whose reel was made by hand gets no second reel', () => {
  const p = { id: 'a', status: 'in_review', format: 'reel', make: { images: 'done', reel: 'todo' }, reel: { at: 1 } };
  assert.equal(nextStep([], [p], { analyst: true, render: true, reel: true }), undefined);
  assert.equal(nextStep([], [{ ...p, reel: undefined }], { analyst: true, render: true, reel: true })?.kind, 'reel');
});

test('scout: real dates in the window, our countries, nothing sensitive, https sources; names checked on the page', () => {
  const ev = (o: Record<string, unknown>) => ({ title: 'Coldplay Music of the Spheres', kind: 'concert', start: '2026-12-05', end: '2026-12-05', city: 'Mumbai', country: 'IN', why: 'stadium show', sources: ['https://in.bookmyshow.com/events/coldplay'], ...o });
  const got = readScouted({ events: [ev({}), ev({ start: '2027-03-01' }), ev({ country: 'XX' }), ev({ title: 'Memorial concert for flood victims' }), ev({ sources: ['http://x.com', 'nope'] }), ev({ start: '12/05/2026' }), ev({}), ev({ title: 'Sunburn Festival', kind: 'festival', start: '2026-12-27', end: '2026-12-29', city: 'Goa', sources: ['https://sunburn.in'] }), ev({ title: 'IPL style final', kind: 'sports' })] }, '2026-11-11');
  assert.deepEqual(got.map((g) => g.raw.title), ['Coldplay Music of the Spheres (Mumbai)', 'Sunburn Festival (Goa)', 'IPL style final (Mumbai)']);
  assert.equal(got[1].raw.ends, '2026-12-29');
  assert.equal(got[2].raw.kind, 'match');
  assert.deepEqual(nameWords('Coldplay Music of the Spheres (Mumbai)'), ['Coldplay', 'Spheres']);
  assert.deepEqual(readScouted(undefined, '2026-11-11'), []);
});
