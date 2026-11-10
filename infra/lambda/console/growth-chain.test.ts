import assert from 'node:assert/strict';
import { test } from 'node:test';

import { photoDayMoments } from '../api/growth-moments';
import { nextStep } from './growth-chain';
import { momentBrief } from './growth-moments';

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
