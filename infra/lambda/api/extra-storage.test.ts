// Run: cd infra && npx tsx --test lambda/api/extra-storage.test.ts
// Extra storage above Lens Plus: the bill maths, the cap, the quota and who can turn it on.
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.QUOTA_BYTES = String(40 * 1024 ** 3);
process.env.TABLE = 'test';

const DAY = 86_400_000;
const GB = 1024 ** 3;
const NOW = Date.UTC(2026, 10, 1);

// After the env above (lib.ts reads it when loaded).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { billPaise, eligibility, extraUsedBytes } = require('./extra-storage') as typeof import('./extra-storage');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { quotaFor } = require('./lib') as typeof import('./lib');

const plan = { id: 'plus50', bytes: 50 * GB, status: 'active' as const, provider: 'razorpay' as const, ref: 'sub_1', periodEnd: NOW + 20 * DAY, startedAt: NOW - 40 * DAY, updatedAt: NOW };
const sub = { id: 'sub_1', kind: 'plus50-month' as const, status: 'active' as const, paidCount: 2, createdAt: NOW - 40 * DAY, updatedAt: NOW };
const paying = { email: 'a@b.c', welcomeUntil: NOW - 100 * DAY, plan, sub, usedBytes: 50 * GB };

test('₹3 per GB-month: 10 GB kept for 30 days = ₹30', () => {
  assert.equal(billPaise(10 * 30, 20), 3000);
});

test('partial month and part GB: 2.5 GB for 12 days = ₹3', () => {
  assert.equal(billPaise(2.5 * 12, 20), 300);
});

test('never more than the cap × ₹3 (31-day month at the cap)', () => {
  assert.equal(billPaise(20 * 31, 20), 6000);
});

test('the cap adds to the plan storage; off adds nothing', () => {
  assert.equal(quotaFor({ ...paying, extra: { capGB: 20 } }, NOW), 70 * GB);
  assert.equal(quotaFor({ ...paying, extra: { capGB: 0 } }, NOW), 50 * GB);
});

test('no extra allowance without a running plan', () => {
  assert.equal(quotaFor({ ...paying, plan: { ...plan, status: 'lapsed' }, extra: { capGB: 20 } }, NOW), 10 * GB);
});

test('grace keeps the allowance (nothing pauses because of a failed payment)', () => {
  assert.equal(quotaFor({ ...paying, plan: { ...plan, status: 'grace', graceUntil: NOW + 5 * DAY }, extra: { capGB: 20 } }, NOW), 70 * GB);
});

test('extra used = above plan + invites, not counting the cap', () => {
  assert.equal(extraUsedBytes({ ...paying, usedBytes: 63 * GB, bonusBytes: 10 * GB, extra: { capGB: 20 } as never }, NOW), 3 * GB);
  assert.equal(extraUsedBytes({ ...paying, usedBytes: 30 * GB }, NOW), 0);
});

test('eligibility: monthly Razorpay Plus only', () => {
  assert.equal(eligibility(paying, NOW).ok, true);
  assert.equal(eligibility({ ...paying, sub: { ...sub, kind: 'plus50-year' } }, NOW).reason, 'yearly');
  assert.equal(eligibility({ ...paying, plan: { ...plan, provider: 'manual' } }, NOW).reason, 'other-provider');
  assert.equal(eligibility({ ...paying, plan: { ...plan, cancelled: true } }, NOW).reason, 'cancelled');
  assert.equal(eligibility({ ...paying, plan: { ...plan, status: 'grace', graceUntil: NOW + DAY } }, NOW).reason, 'grace');
  assert.equal(eligibility({ ...paying, plan: undefined }, NOW).reason, 'needs-plus');
  assert.equal(eligibility({ ...paying, email: undefined }, NOW).reason, 'sign-in');
});
