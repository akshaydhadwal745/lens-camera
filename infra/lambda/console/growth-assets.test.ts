// Run: cd infra && npx tsx --test lambda/console/growth-assets.test.ts
// Library rules a post's media must pass: uploaded, rights cleared, stock only as background/reference.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assetProblems, credits, hasLensPhoto, readAssetRefs, signatureMatches, type Asset } from './growth-assets';
import { licenseVerdict } from './growth-rights';

const asset = (id: string, o: Partial<Asset> = {}, license = 'own', people = false): Asset => {
  const v = licenseVerdict(license, people);
  return {
    id, name: `File ${id}`, kind: 'photo', origin: license === 'own' ? 'upload' : 'discovered', key: `a/${id}.jpg`, mime: 'image/jpeg', bytes: 10, lensPhoto: false, checkedPersonal: true, status: 'ready', createdAt: 0, createdBy: 'o',
    rights: { status: v.status, license, licenseUrl: '', source: license === 'own' ? '' : 'https://unsplash.com/p', author: license === 'own' ? '' : 'Ravi', credit: '', commercialOk: v.commercialOk, editsOk: v.editsOk, peopleOrBrands: people, reason: v.reason, checkedAt: 0, checkedBy: 'o' },
    ...o,
  };
};

test('file signatures', () => {
  assert.equal(signatureMatches('image/jpeg', Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(signatureMatches('image/png', Buffer.from('89504e470d0a1a0a0000', 'hex')), true);
  assert.equal(signatureMatches('image/webp', Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')), true);
  assert.equal(signatureMatches('video/mp4', Buffer.from('\x00\x00\x00\x18ftypmp42', 'latin1')), true);
  assert.equal(signatureMatches('image/jpeg', Buffer.from('89504e47', 'hex')), false);
  assert.equal(signatureMatches('image/png', Buffer.from('<svg onload=', 'latin1')), false);
});

test('references are cleaned', () => {
  assert.deepEqual(readAssetRefs([{ id: 'aaaaaaaaaaaa', role: 'background' }, { id: 'aaaaaaaaaaaa' }, { id: '../etc' }, { id: 'bbbbbbbbbbbb', role: 'hero' }]), [
    { id: 'aaaaaaaaaaaa', role: 'background' },
    { id: 'bbbbbbbbbbbb', role: 'media' },
  ]);
});

test('what media can block', () => {
  const m = new Map<string, Asset>([
    ['aaaaaaaaaaaa', asset('aaaaaaaaaaaa')],
    ['bbbbbbbbbbbb', asset('bbbbbbbbbbbb', {}, 'Unsplash License')],
    ['cccccccccccc', asset('cccccccccccc', {}, 'CC BY-NC 4.0')],
    ['dddddddddddd', asset('dddddddddddd', { status: 'uploading' })],
    ['eeeeeeeeeeee', asset('eeeeeeeeeeee', {}, 'own', true)],
  ]);
  assert.deepEqual(assetProblems([{ id: 'aaaaaaaaaaaa', role: 'media' }, { id: 'bbbbbbbbbbbb', role: 'background' }], m), []);
  const p = assetProblems(
    [
      { id: 'bbbbbbbbbbbb', role: 'media' },
      { id: 'cccccccccccc', role: 'background' },
      { id: 'dddddddddddd', role: 'media' },
      { id: 'eeeeeeeeeeee', role: 'media' },
      { id: 'ffffffffffff', role: 'media' },
    ],
    m,
  ).join(' | ');
  assert.match(p, /licensed stock: use it only as a background/);
  assert.match(p, /can't be used: Non-commercial/);
  assert.match(p, /hasn't finished uploading/);
  assert.match(p, /needs a rights decision/);
  assert.match(p, /deleted from the library/);
});

test('"shot on Lens" needs a cleared, uploaded photo taken with Lens', () => {
  const m = new Map<string, Asset>([
    ['aaaaaaaaaaaa', asset('aaaaaaaaaaaa', { lensPhoto: true })],
    ['bbbbbbbbbbbb', asset('bbbbbbbbbbbb', { lensPhoto: true }, 'own', true)],
  ]);
  assert.equal(hasLensPhoto([{ id: 'aaaaaaaaaaaa', role: 'media' }], m), true);
  assert.equal(hasLensPhoto([{ id: 'bbbbbbbbbbbb', role: 'media' }], m), false);
  assert.equal(hasLensPhoto([], m), false);
});

test('credits list licensed media only', () => {
  const m = new Map<string, Asset>([
    ['aaaaaaaaaaaa', asset('aaaaaaaaaaaa')],
    ['bbbbbbbbbbbb', asset('bbbbbbbbbbbb', {}, 'Unsplash License')],
  ]);
  assert.deepEqual(credits([{ id: 'aaaaaaaaaaaa', role: 'media' }, { id: 'bbbbbbbbbbbb', role: 'background' }], m), ['Photo: Ravi on Unsplash']);
});
