// Run: cd infra && npx tsx --test lambda/console/growth-content.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calendarItems, checkMeta } from './growth-content';
import { unsubscribeToken } from '../api/growth-integrations';

test('meta changes: path, lengths and "same as now" are checked; whitespace is cleaned', () => {
  const ok = checkMeta({ path: '/compare/google-photos/', title: '  Lens vs Google Photos:   full quality backup ', description: 'Compare Lens and Google Photos for backing up every photo and video in full quality, sharing and storage.', oldTitle: 'Old', oldDescription: '' });
  assert.equal(typeof ok, 'object');
  assert.equal((ok as { title: string }).title, 'Lens vs Google Photos: full quality backup');
  assert.match(checkMeta({ path: 'https://evil.example/', title: 'A good enough title here' }) as string, /Bad page path/);
  assert.match(checkMeta({ path: '/x/', title: 'Short' }) as string, /titles should be/);
  assert.match(checkMeta({ path: '/x/', description: 'too short' }) as string, /descriptions should be/);
  assert.match(checkMeta({ path: '/x/' }) as string, /nothing to change/);
  assert.match(checkMeta({ path: '/x/', title: 'A good enough title here', oldTitle: 'A good enough title here', description: '', oldDescription: '' }) as string, /same as now/);
});

test('calendar: dated tasks, posts, partner follow-ups and campaign dates in the month, sorted; content-only filter', () => {
  const data = {
    tasks: [
      { id: 'T-1', title: 'Guide page', type: 'page', status: 'ready', owner: 'a', due: '2026-11-10' },
      { id: 'T-2', title: 'Fix bug', type: 'fix', status: 'ready', owner: 'a', due: '2026-11-03' },
      { id: 'T-3', title: 'Dropped', type: 'content', status: 'wontdo', owner: 'a', due: '2026-11-04' },
      { id: 'T-4', title: 'Next month', type: 'content', status: 'ready', owner: 'a', due: '2026-12-01' },
    ],
    posts: [{ id: 'p1', title: 'Reel', channel: 'instagram', date: '2026-11-05', status: 'drafted' }],
    partners: [
      { id: 'q1', name: 'Studio', nextStep: 'call', nextDate: '2026-11-02', stage: 'contacted' },
      { id: 'q2', name: 'Lost one', nextDate: '2026-11-02', stage: 'lost' },
    ],
    campaigns: [{ id: 'c1', name: 'Diwali', start: '2026-10-25', end: '2026-11-08', status: 'live', channel: 'instagram' }],
  };
  const all = calendarItems('2026-11', data);
  assert.deepEqual(all.map((i) => `${i.date} ${i.kind} ${i.id}`), ['2026-11-02 partner q1', '2026-11-03 task T-2', '2026-11-05 post p1', '2026-11-08 campaign-end c1', '2026-11-10 task T-1']);
  assert.deepEqual(calendarItems('2026-11', data, true).map((i) => i.id), ['p1', 'c1', 'T-1']);
});

test('unsubscribe tokens are per account and per secret', () => {
  assert.equal(unsubscribeToken('abc', 's1'), unsubscribeToken('abc', 's1'));
  assert.notEqual(unsubscribeToken('abc', 's1'), unsubscribeToken('abd', 's1'));
  assert.notEqual(unsubscribeToken('abc', 's1'), unsubscribeToken('abc', 's2'));
  assert.equal(unsubscribeToken('abc', 's1').length, 32);
});
