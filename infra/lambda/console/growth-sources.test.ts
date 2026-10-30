// Run: cd infra && npx tsx --test lambda/console/growth-sources.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTrending, wikiTrend } from './growth-sources';

test('trending RSS: titles, traffic, news, and relevance to our space', () => {
  const xml = `<rss><channel><item><title>Google Photos down</title><ht:approx_traffic>10K+</ht:approx_traffic><ht:news_item><ht:news_item_title>Outage hits &amp; users</ht:news_item_title></ht:news_item></item><item><title>Cricket final</title><ht:approx_traffic>500K+</ht:approx_traffic></item></channel></rss>`;
  assert.deepEqual(parseTrending(xml), [
    { title: 'Google Photos down', traffic: '10K+', relevant: true, news: ['Outage hits & users'] },
    { title: 'Cricket final', traffic: '500K+', relevant: false, news: [] },
  ]);
});

test('Wikipedia trend: last 3 full months vs the same months a year before (current month dropped)', () => {
  const months = Array.from({ length: 16 }, (_, i) => ({ month: `m${i}`, views: i < 3 ? 100 : i >= 12 && i < 15 ? 150 : 10 }));
  const t = wikiTrend('Cloud_storage', months);
  assert.equal(t.last3Months, 450);
  assert.equal(t.sameMonthsYearBefore, 300);
  assert.equal(t.change, 0.5);
  assert.equal(wikiTrend('X', months.slice(0, 5)).change, null);
});
