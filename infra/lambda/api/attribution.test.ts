// Run: cd infra && npx tsx --test lambda/api/attribution.test.ts
// Install source from the Play install referrer (docs/growth/growth-engine.md M1).
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.TABLE = 'test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseAcquisition, parseRef } = require('./attribution') as typeof import('./attribution');

test('organic Play install', () => {
  assert.deepEqual(parseAcquisition('utm_source=google-play&utm_medium=organic'), { source: 'google-play', medium: 'organic' });
});

test('website, social and partner links keep every utm field', () => {
  assert.deepEqual(parseAcquisition('utm_source=site&utm_medium=web&utm_campaign=compare-google-photos&utm_content=hero'), {
    source: 'site',
    medium: 'web',
    campaign: 'compare-google-photos',
    content: 'hero',
  });
});

test('referral and affiliate codes without utm', () => {
  assert.deepEqual(parseAcquisition('lens_ref=ABCD234'), { source: 'lens', medium: 'referral' });
  assert.deepEqual(parseAcquisition('lens_aff=ABCD234&utm_source=insta'), { source: 'insta', medium: 'affiliate' });
  assert.equal(parseRef('lens_ref=ABCD234&utm_source=insta'), 'ABCD234');
});

test('ads click id is flagged, values are cleaned and capped', () => {
  const a = parseAcquisition('utm_source=Google<script>&gclid=xyz&utm_campaign=' + 'a'.repeat(80));
  assert.equal(a.source, 'googlescript');
  assert.equal(a.ads, true);
  assert.equal(a.campaign?.length, 40);
});

test('no referrer, garbage or not a string → direct', () => {
  assert.deepEqual(parseAcquisition(undefined), { source: 'direct' });
  assert.deepEqual(parseAcquisition('ABCD234'), { source: 'direct' });
  assert.deepEqual(parseAcquisition(42), { source: 'direct' });
});
