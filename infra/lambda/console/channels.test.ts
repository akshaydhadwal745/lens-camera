// Run: cd infra && npx tsx --test lambda/console/channels.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { byChannel, channelOf, type ChannelAccount } from './channels';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 11, 15, 12);
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const acct = (daysAgo: number, active: number[], extra: Partial<ChannelAccount> = {}): ChannelAccount => {
  const createdAt = NOW - daysAgo * DAY;
  return { createdAt, activeDays: new Set(active.map((n) => day(createdAt + n * DAY))), ...extra };
};

test('channel label', () => {
  assert.equal(channelOf({ source: 'google-play', medium: 'organic' }), 'google-play / organic');
  assert.equal(channelOf({ source: 'web' }), 'web');
  assert.match(channelOf(undefined), /^unknown/);
});

test('D1/D7/D30 count only accounts old enough, and only activity on that exact day', () => {
  const play = { acquisition: { source: 'google-play', medium: 'organic' } };
  const rows = byChannel(
    [
      acct(40, [0, 1, 7, 30], play), // back on 1, 7, 30
      acct(40, [0, 2, 8], play), // never on the exact days
      acct(3, [0, 1], play), // too young for D7/D30
    ],
    NOW,
  );
  const r = rows[0];
  assert.equal(r.installs, 3);
  assert.deepEqual(r.d1, { reached: 2, eligible: 3, rate: 2 / 3 });
  assert.deepEqual(r.d7, { reached: 1, eligible: 2, rate: 0.5 });
  assert.deepEqual(r.d30, { reached: 1, eligible: 2, rate: 0.5 });
});

test('activation, paying and storage cost per channel; biggest channel first', () => {
  const rows = byChannel(
    [
      acct(10, [0], { acquisition: { source: 'site', medium: 'web' }, uploadedAt: 1, usedBytes: 10 * 1024 ** 3, paying: true }),
      acct(10, [0], { acquisition: { source: 'google-play', medium: 'organic' } }),
      acct(10, [0], { acquisition: { source: 'google-play', medium: 'organic' }, signedInAt: 1 }),
    ],
    NOW,
  );
  assert.deepEqual(rows.map((r) => r.channel), ['google-play / organic', 'site / web']);
  assert.equal(rows[1].backedUp.rate, 1);
  assert.equal(rows[1].paying, 1);
  assert.equal(rows[1].storageGB, 10);
  assert.equal(rows[1].storageUsdPerMonth, 0.12);
  assert.equal(rows[0].signedIn.rate, 0.5);
});

test('an empty channel list gives no rows; a new account has no D1 yet', () => {
  assert.deepEqual(byChannel([], NOW), []);
  assert.deepEqual(byChannel([acct(0, [0])], NOW)[0].d1, { reached: 0, eligible: 0, rate: null });
});

test('retention can use a longer cohort than the window, so D30 has accounts old enough', () => {
  const recent = [acct(10, [0])];
  const older = [acct(10, [0]), acct(45, [0, 30])];
  const [r] = byChannel(recent, NOW, older);
  assert.equal(r.installs, 1);
  assert.deepEqual(r.d30, { reached: 1, eligible: 1, rate: 1 });
});
