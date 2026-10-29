// Run: cd infra && npx tsx --test lambda/api/test-accounts.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { testAccounts } from './test-accounts';

const LAUNCH = Date.UTC(2026, 9, 29, 9, 0);
const profile = (id: string, createdAt: number, extra: Record<string, unknown> = {}) => ({ pk: `D#${id}`, sk: 'PROFILE', createdAt, ...extra });

test('before the closed test: guests that never signed in are test phones; signed-in people are real', () => {
  const t = testAccounts([profile('guest', LAUNCH - 1), profile('owner', LAUNCH - 1, { email: 'me@gmail.com' })], []);
  assert.deepEqual([...t], ['guest']);
});

test('after the closed test: guests count unless flagged (test, emulator or Test Lab)', () => {
  const t = testAccounts(
    [profile('tester', LAUNCH + 1), profile('flagged', LAUNCH + 1, { test: true }), profile('lab', LAUNCH + 1), profile('e2e', LAUNCH + 1, { email: 'x@e2e.lens.invalid' })],
    [{ pk: 'FP#abc', sk: 'DEVICE', guestId: 'lab', emulator: true }],
  );
  assert.deepEqual([...t].sort(), ['e2e', 'flagged', 'lab']);
});
