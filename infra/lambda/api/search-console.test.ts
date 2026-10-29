// Run: cd infra && npx tsx --test lambda/api/search-console.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.TABLE = 'test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pathOf, rowsForDay } = require('./search-console') as typeof import('./search-console');

test('result URLs on our site become paths', () => {
  assert.equal(pathOf('https://lens.instagrowapp.com/compare/google-photos/'), '/compare/google-photos/');
  assert.equal(pathOf('https://lens.instagrowapp.com/'), '/');
  assert.equal(pathOf('https://elsewhere.example/x'), 'https://elsewhere.example/x');
});

test('one day becomes total + per query, page, country and device rows', () => {
  const r = (key: string | undefined, clicks: number, impressions: number, position: number) => ({ ...(key ? { keys: [key] } : {}), clicks, impressions, position });
  const rows = rowsForDay(
    '2026-11-01',
    {
      total: [r(undefined, 3, 120, 18.456)],
      q: [r('phone storage full', 2, 80, 12.04)],
      p: [r('https://lens.instagrowapp.com/features/phone-storage-full/', 3, 100, 15)],
      c: [r('ind', 3, 90, 14)],
      d: [r('MOBILE', 3, 110, 17)],
    },
    99,
  );
  assert.deepEqual(
    rows.map((x) => x.sk),
    ['total', 'q#phone storage full', 'p#/features/phone-storage-full/', 'c#ind', 'd#MOBILE'],
  );
  assert.deepEqual(rows[0], { pk: 'GSC#2026-11-01', sk: 'total', clicks: 3, impressions: 120, position: 18.5, ttl: 99 });
});

test('a day with no search data stores nothing', () => {
  assert.deepEqual(rowsForDay('2026-11-01', { total: [], q: [], p: [], c: [], d: [] }, 1), []);
});
