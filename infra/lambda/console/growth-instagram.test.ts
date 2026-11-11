import assert from 'node:assert/strict';
import { test } from 'node:test';

import { feedRenders, igCaption, igPlan } from './growth-instagram';

const r = (w: number, h: number, id = `${w}x${h}`) => ({ assetId: id, label: id, w, h });

test('instagram: caption limits (2,200 characters, 30 hashtags)', () => {
  const tags = Array.from({ length: 35 }, (_, i) => `#t${i}`).join(' ');
  const c = igCaption(`Hello ${tags}`);
  assert.equal((c.match(/#t\d+/g) ?? []).length, 30);
  assert.ok(!c.includes('#t30'));
  assert.equal(igCaption('x'.repeat(3000)).length, 2200);
  assert.equal(igCaption('Plain caption'), 'Plain caption');
});

test('instagram: feed images only (4:5 to 1.91:1), at most 10', () => {
  assert.deepEqual(feedRenders([r(1080, 1350), r(1080, 1920), r(1080, 1080), r(1200, 628), r(1000, 400)]).map((x) => x.assetId), ['1080x1350', '1080x1080', '1200x628']);
  assert.equal(feedRenders(Array.from({ length: 12 }, (_, i) => r(1080, 1350, String(i)))).length, 10);
});

test('instagram: a reel post sends its reel, a carousel its slides, one image a single post', () => {
  assert.deepEqual(igPlan({ format: 'reel', reel: { assetId: 'v' }, renders: [r(1080, 1920)] }), { kind: 'reel', assetId: 'v' });
  assert.equal(igPlan({ format: 'carousel', renders: [r(1080, 1350, 'a'), r(1080, 1350, 'b'), r(1080, 1920, 'c')] })!.kind, 'carousel');
  assert.equal(igPlan({ format: 'post', renders: [r(1080, 1350)] })!.kind, 'image');
  assert.deepEqual(igPlan({ format: 'story', renders: [r(1080, 1920)], reel: { assetId: 'v' } }), { kind: 'reel', assetId: 'v' });
  assert.equal(igPlan({ format: 'post', renders: [r(1080, 1920)] }), undefined);
});
