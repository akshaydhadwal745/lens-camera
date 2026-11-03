// Run: cd infra && npx tsx --test lambda/console/growth-moments.test.ts
// Moments in the Content tab: what's listed, the brief "Make content" writes, and when its packages go out.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Moment } from '../api/growth-moments';
import { momentBrief, packageDay, upcoming } from './growth-moments';

const m = (o: Partial<Moment> = {}): Moment & { at: number } => ({
  id: 'abcdef0123',
  title: 'Diwali/Deepavali',
  kind: 'festival',
  day: '2026-11-08',
  countries: ['IN', 'GB'],
  source: 'Google public holidays',
  url: 'u',
  score: 94,
  angle: 'Lights and fireworks: Night mode.',
  formats: ['reel', 'carousel'],
  hashtags: ['#Diwali', '#Diwali2026'],
  at: 0,
  ...o,
});

test('upcoming: past days drop off, seasons on now stay, soonest first then best score', () => {
  const list = upcoming(
    [m({ id: 'a', day: '2026-11-01' }), m({ id: 'b', day: '2026-11-01', ends: '2027-02-28', score: 84 }), m({ id: 'c', day: '2026-11-08', score: 50 }), m({ id: 'd', day: '2026-11-08', score: 94 })],
    '2026-11-03',
  );
  assert.deepEqual(list.map((x) => x.id), ['b', 'd', 'c']);
});

test('the brief: moment, angle, timing, legal rules; due three days before (never in the past)', () => {
  const b = momentBrief(m(), '2026-11-03');
  assert.equal(b.title, 'Moment: Diwali/Deepavali (2026-11-08)');
  assert.equal(b.due, '2026-11-05');
  assert.match(b.description, /IN, GB/);
  assert.match(b.description, /Night mode/);
  assert.match(b.description, /a few days before/);
  assert.match(b.description, /no logos/);
  assert.match(b.description, /official, a partner, a sponsor/);
  assert.equal(momentBrief(m({ day: '2026-11-04' }), '2026-11-03').due, '2026-11-03');
  assert.match(momentBrief(m({ kind: 'season', ends: '2027-02-28' }), '2026-11-03').description, /early in the season/);
  assert.match(momentBrief(m({ countries: ['WW'] }), '2026-11-03').description, /worldwide/);
});

test('package days: from today without a moment, from the moment with one, never in the past', () => {
  const started = Date.parse('2026-11-03T10:00:00Z');
  assert.equal(packageDay(started, 2), '2026-11-05');
  assert.equal(packageDay(started, 40), '2026-11-17');
  assert.equal(packageDay(started, -3, '2026-11-08'), '2026-11-05');
  assert.equal(packageDay(started, 1, '2026-11-08'), '2026-11-09');
  assert.equal(packageDay(started, -10, '2026-11-08'), '2026-11-03');
  assert.equal(packageDay(started, 30, '2026-11-08'), '2026-11-15');
});
