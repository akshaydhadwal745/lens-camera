// Run: cd infra && npx tsx --test lambda/api/plus-prompt.test.ts
// Tests the app's Lens Plus prompt rules (src/lib/plus-prompt-rules.ts, pure TS).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decidePlus, PlusContext, PlusPromptState } from '../../../src/lib/plus-prompt-rules';

const DAY = 86_400_000;
const GB = 1024 ** 3;
const NOW = Date.UTC(2026, 10, 1);
const base: PlusContext = { eligible: true, usedBytes: 1 * GB, quotaBytes: 40 * GB, welcomeUntil: NOW + 60 * DAY, backups: 5 };
const empty: PlusPromptState = { shown: [] };

test('nothing to offer for a new, light user', () => {
  assert.equal(decidePlus(empty, base, NOW), null);
});

test('not eligible (Play build, already Plus, guest) → never', () => {
  assert.equal(decidePlus(empty, { ...base, eligible: false, usedBytes: 39 * GB }, NOW), null);
});

test('20 backups → the lock-in moment, once', () => {
  const ctx = { ...base, backups: 20 };
  assert.equal(decidePlus(empty, ctx, NOW), 'backups20');
  assert.equal(decidePlus({ shown: [{ at: NOW - 40 * DAY, reason: 'backups20' }] }, ctx, NOW), null);
});

test('storage beats everything; 95% comes back after 30 days even after "never"', () => {
  assert.equal(decidePlus(empty, { ...base, usedBytes: 33 * GB, backups: 50 }, NOW), 'storage80');
  const full = { ...base, usedBytes: 38.5 * GB };
  assert.equal(decidePlus({ shown: [], never: true }, full, NOW), 'storage95');
  assert.equal(decidePlus({ shown: [{ at: NOW - 10 * DAY, reason: 'storage95' }], never: true }, full, NOW), null);
  assert.equal(decidePlus({ shown: [{ at: NOW - 31 * DAY, reason: 'storage95' }], never: true }, full, NOW), 'storage95');
});

test('at most one offer every 5 days', () => {
  assert.equal(decidePlus({ shown: [{ at: NOW - 2 * DAY, reason: 'recap' }] }, { ...base, usedBytes: 39 * GB }, NOW), null);
});

test('last welcome week, once', () => {
  const ctx = { ...base, welcomeUntil: NOW + 3 * DAY };
  assert.equal(decidePlus(empty, ctx, NOW), 'welcome');
  assert.equal(decidePlus({ shown: [{ at: NOW - 6 * DAY, reason: 'welcome' }] }, ctx, NOW), null);
});

test('recap seen in the last 2 days → offer, at most monthly', () => {
  assert.equal(decidePlus({ shown: [], recapSeenAt: NOW - DAY }, base, NOW), 'recap');
  assert.equal(decidePlus({ shown: [{ at: NOW - 20 * DAY, reason: 'recap' }], recapSeenAt: NOW - DAY }, base, NOW), null);
  assert.equal(decidePlus({ shown: [], recapSeenAt: NOW - 3 * DAY }, base, NOW), null);
});
