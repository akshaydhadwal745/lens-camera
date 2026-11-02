// Run: cd infra && npx tsx --test lambda/console/growth-content-rules.test.ts
// What blocks approval of a content package: platform limits, missing pieces, forbidden or untrue claims.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanHashtags, packageProblems, postText, readPackage, variantProblems, type Variant } from './growth-content-rules';

const v = (o: Partial<Variant> = {}): Variant => ({ caption: 'Phone full? Back up every photo at full quality.', hashtags: ['#photobackup'], cta: 'Try Lens free', title: '', altText: 'A phone showing Backup complete', ...o });
const link = 'https://lens.instagrowapp.com/?utm_source=x&utm_medium=social&utm_campaign=t-1a2b';

test('hashtags are cleaned, deduplicated and capped', () => {
  assert.deepEqual(cleanHashtags(['photo backup', '#PhotoBackup', '##storage', '', 'नमस्ते'], 8), ['#photobackup', '#storage', '#नमस्ते']);
  assert.deepEqual(cleanHashtags('#a, #b #c', 2), ['#a', '#b']);
});

test('Instagram text leaves the link out (captions are not clickable); others include it', () => {
  assert.doesNotMatch(postText(v(), link, 'instagram'), /https:/);
  assert.match(postText(v(), link, 'facebook'), /utm_campaign=t-1a2b/);
});

test('platform limits and required pieces', () => {
  assert.deepEqual(variantProblems('instagram', 'carousel', v(), link, false), []);
  assert.match(variantProblems('x', 'post', v({ caption: 'a'.repeat(260) }), link, false).join(), /characters, the limit is 280/);
  assert.match(variantProblems('youtube', 'short', v(), link, false).join(), /add a title/);
  assert.match(variantProblems('youtube', 'post', v({ title: 'T' }), link, false).join(), /doesn't take a post/);
  assert.match(variantProblems('instagram', 'post', v({ hashtags: Array.from({ length: 9 }, (_, i) => `#t${i}`) }), link, false).join(), /use at most 8/);
  assert.match(variantProblems('pinterest', 'pin', v({ title: 'Pin', altText: '' }), link, false).join(), /alt text/);
  assert.deepEqual(variantProblems('reddit', 'post', v({ title: 'How do you back up 4K video?', hashtags: [], altText: '' }), link, false), []);
});

test('forbidden and untrue claims block approval', () => {
  assert.match(variantProblems('instagram', 'post', v({ caption: 'Unlimited backup for everyone' }), link, false).join(), /forbids/);
  assert.match(variantProblems('instagram', 'post', v({ caption: 'Shot on Lens at night' }), link, false).join(), /no real Lens photo/);
  assert.deepEqual(variantProblems('instagram', 'post', v({ caption: 'Shot on Lens at night' }), link, true), []);
});

test('package checks: slides, script length, claims in slides, at least one platform', () => {
  const base = readPackage({ format: 'carousel', hook: 'Phone full?', slides: [{ headline: 'One', body: '', visual: '' }], variants: {} });
  const p = packageProblems(base, () => link).join(' | ');
  assert.match(p, /at least one platform/);
  assert.match(p, /2–10 slides/);
  const reel = readPackage({ format: 'reel', script: Array.from({ length: 13 }, () => ({ seconds: 6, onScreen: 'Unlimited space', visual: '' })), variants: { instagram: v() } });
  const r = packageProblems(reel, () => link).join(' | ');
  assert.match(r, /keep it at 60 or less/);
  assert.match(r, /forbids/);
  const ok = readPackage({ format: 'reel', hook: 'Phone full?', script: [{ seconds: 5, onScreen: 'Phone full?', visual: 'screen recording' }], variants: { instagram: v({ altText: '' }), youtube: v({ title: 'Phone full? Do this', altText: '' }) } });
  assert.deepEqual(packageProblems(ok, () => link), []);
});

test('reading input keeps only known platforms and clamps scene seconds', () => {
  const p = readPackage({ format: 'nope', variants: { instagram: v(), myspace: v() }, script: [{ seconds: 99, onScreen: 'x', visual: '' }] });
  assert.equal(p.format, 'post');
  assert.deepEqual(Object.keys(p.variants), ['instagram']);
  assert.equal(p.script[0].seconds, 30);
  assert.equal(p.realPhoto, false);
});
