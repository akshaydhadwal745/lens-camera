// Run: cd infra && npx tsx --test lambda/console/growth-money.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { campaignLink, economics, spendByMonth } from './growth-money';

test('unit economics: CAC, cost per activated and paying, estimated ROI; null when nothing to divide by', () => {
  const e = economics(1000, { visits: 400, installs: 40, backedUp: 25, signedIn: 20, paying: 2 });
  assert.equal(e.costPerVisit, 2.5);
  assert.equal(e.cac, 25);
  assert.equal(e.costPerActivated, 40);
  assert.equal(e.costPerPaying, 500);
  assert.equal(e.estMonthlyRevenue, 118);
  assert.equal(e.roi, -0.882);
  assert.equal(e.paybackMonths, 8.5);
  const none = economics(0, { visits: 0, installs: 0, backedUp: 0, signedIn: 0, paying: 0 });
  assert.equal(none.cac, null);
  assert.equal(none.roi, null);
  assert.equal(none.paybackMonths, null);
});

test('spend by month and category; tagged campaign links', () => {
  assert.deepEqual(spendByMonth([{ date: '2026-11-03', amount: 500, category: 'ads' }, { date: '2026-11-20', amount: 250, category: 'events-and-print' }, { date: '2026-12-01', amount: 100, category: 'ads' }]), [
    { month: '2026-11', total: 750, byCategory: { ads: 500, 'events-and-print': 250 } },
    { month: '2026-12', total: 100, byCategory: { ads: 100 } },
  ]);
  assert.equal(campaignLink({ landingPage: '/guides/collect-wedding-photos-qr-code/', channel: 'instagram', medium: 'social', code: 'wedding-qr-ab12' }), 'https://lens.instagrowapp.com/guides/collect-wedding-photos-qr-code/?utm_source=instagram&utm_medium=social&utm_campaign=wedding-qr-ab12');
  assert.equal(campaignLink({ landingPage: 'javascript:x', channel: 'reddit', medium: 'social', code: 'c' }), 'https://lens.instagrowapp.com/?utm_source=reddit&utm_medium=social&utm_campaign=c');
});
