import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EVERGREEN, nextSlot, pickIdea } from './growth-daily';

const m = (o: Record<string, unknown>) => ({ id: 'm1', title: 'Sunburn Festival Mumbai', day: '2026-11-14', score: 80, kind: 'festival', ...o }) as never;

test('daily idea: a strong moment 2–5 days out first, unused; else the next evergreen idea not used lately', () => {
  assert.equal(pickIdea('2026-11-11', [m({})], []).source, 'moment');
  assert.equal(pickIdea('2026-11-11', [m({ day: '2026-11-12' })], []).source, 'evergreen'); // tomorrow: too late to be useful
  assert.equal(pickIdea('2026-11-11', [m({ score: 50 })], []).source, 'evergreen');
  assert.equal(pickIdea('2026-11-11', [m({ taskId: 'T-1' })], []).source, 'evergreen');
  assert.equal(pickIdea('2026-11-11', [m({ kind: 'holiday' })], []).source, 'evergreen');
  const first = pickIdea('2026-11-11', [], []);
  assert.equal(first.source, 'evergreen');
  const used = `evergreen:${(first as { idea: (typeof EVERGREEN)[number] }).idea.idea.slice(0, 40)}`;
  const second = pickIdea('2026-11-11', [], [used]);
  assert.notEqual((second as { idea: { idea: string } }).idea.idea, (first as { idea: { idea: string } }).idea.idea);
});

test('daily slot: 13:00 UTC today if at least 30 minutes away, else tomorrow', () => {
  assert.equal(new Date(nextSlot(Date.parse('2026-11-11T09:00:00Z'))).toISOString(), '2026-11-11T13:00:00.000Z');
  assert.equal(new Date(nextSlot(Date.parse('2026-11-11T12:45:00Z'))).toISOString(), '2026-11-12T13:00:00.000Z');
});
