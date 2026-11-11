import assert from 'node:assert/strict';
import { test } from 'node:test';

import { postFacts, realLessons } from './growth-brain';
import { readStats, statsDue } from './growth-ig-stats';

const H = 3_600_000;

test('stats: read at 1 h, 1 d, 3 d, 7 d, 14 d and 28 d after posting', () => {
  const t0 = 1_000_000_000_000;
  assert.equal(statsDue(t0, undefined, t0 + 30 * 60_000), false);
  assert.equal(statsDue(t0, undefined, t0 + 1.1 * H), true);
  assert.equal(statsDue(t0, t0 + 1.1 * H, t0 + 5 * H), false);
  assert.equal(statsDue(t0, t0 + 1.1 * H, t0 + 25 * H), true);
  assert.equal(statsDue(t0, t0 + 700 * H, t0 + 900 * H), false);
});

test('stats: Instagram numbers to ours, with watch share and per-reach rates', () => {
  const d = [['views', 22], ['reach', 20], ['saved', 2], ['shares', 1], ['total_interactions', 5], ['ig_reels_avg_watch_time', 2063]].map(([name, value]) => ({ name: String(name), values: [{ value: Number(value) }] }));
  const s = readStats(d, 28, 0, 48 * H);
  assert.equal(s.views, 22);
  assert.equal(s.avgWatchSec, 2.1);
  assert.equal(s.watchedPct, 7);
  assert.equal(s.saveRate, 0.1);
  assert.equal(s.shareRate, 0.05);
  assert.equal(s.ageHours, 48);
  assert.equal(readStats([], undefined, 0, H).avgWatchSec, undefined);
});

test('brain: lessons must rest on real posts; facts carry what the post was and its results', () => {
  const l = (posts: string[]) => ({ lesson: 'x', evidence: 'y', posts, confidence: 'low' as const, applyTo: 'writer' as const });
  assert.equal(realLessons([l(['a']), l(['a', 'zz']), l([])], new Set(['a'])).length, 1);
  const f = postFacts({ id: 'p1', title: 'T', format: 'reel', published: { instagram: { at: Date.parse('2026-11-12T13:00:00Z'), kind: 'reel' } }, reel: { seconds: 28 }, reelScript: { hook: 'H', mood: 'warm', scenes: [{ words: 'W', vo: 'V', shows: 'footage', seconds: 3 }] }, reelScore: { total: 66 }, statsHistory: { instagram: [{ views: 5 }] } });
  assert.equal(f.weekday, 'Thursday');
  assert.equal(f.scenes[0].voice, 'V');
  assert.equal(f.ourScore, 66);
  assert.equal(f.results.length, 1);
});
