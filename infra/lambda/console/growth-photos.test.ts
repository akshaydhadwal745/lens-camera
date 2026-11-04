// Run: cd infra && npx tsx --test lambda/console/growth-photos.test.ts
// Photos found online: what we read from each source and what the rights check makes of it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NOT_A_PHOTO, PEOPLE_OR_BRANDS, pexelsResults, pixabayResults, relevant, photoAssetId, photoRights, wikimediaResults } from './growth-photos';

const wm = (title: string, license: string, extra: Record<string, unknown> = {}) => ({
  index: 1,
  title: `File:${title}.jpg`,
  imageinfo: [{ descriptionurl: `https://commons.wikimedia.org/wiki/File:${title}.jpg`, thumburl: `https://upload.wikimedia.org/t/${title}.jpg`, thumbwidth: 1600, thumbheight: 1067, extmetadata: { LicenseShortName: { value: license }, LicenseUrl: { value: 'https://creativecommons.org/x' }, Artist: { value: '<a href="//x">Jane &amp; Co</a>' }, ImageDescription: { value: '<p>Lake at dawn</p>' }, Categories: { value: 'Lakes|Dawn' }, ...extra } }],
});

test('Wikimedia: page order, plain-text author, small files dropped', () => {
  const tiny = wm('Tiny', 'CC0');
  tiny.imageinfo[0].thumbwidth = 300;
  const r = wikimediaResults({ query: { pages: { a: { ...wm('Second', 'CC0'), index: 2 }, b: wm('First lake', 'CC BY 4.0'), c: { ...tiny, index: 3 } } } });
  assert.deepEqual(r.map((x) => x.title), ['First lake', 'Second']);
  assert.equal(r[0].author, 'Jane & Co');
  assert.equal(r[0].license, 'CC BY 4.0');
  assert.match(r[0].tags, /Lake at dawn Lakes Dawn/);
  assert.deepEqual(wikimediaResults({}), []);
});

test('Pexels: licence, photographer, size capped at the downloaded width', () => {
  const r = pexelsResults({ photos: [{ url: 'https://www.pexels.com/photo/1/', width: 4000, height: 6000, photographer: 'Ana', alt: 'Snowy mountain peak', src: { large2x: 'https://images.pexels.com/1.jpg' } }] });
  assert.deepEqual(r[0], { source: 'Pexels', sourceUrl: 'https://www.pexels.com/photo/1/', imageUrl: 'https://images.pexels.com/1.jpg', w: 1880, h: 2820, license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', author: 'Ana', title: 'Snowy mountain peak', tags: 'Snowy mountain peak' });
});

test('rights: scenery clears, people or brands wait for a manager, share-alike and NC never auto-clear', () => {
  const f = (license: string, title = 'Mountain lake at dawn') => wikimediaResults({ query: { pages: { a: wm(title, license) } } })[0];
  assert.equal(photoRights(f('CC0')).status, 'cleared');
  assert.equal(photoRights(f('Public domain')).status, 'cleared');
  assert.equal(photoRights(f('CC BY 4.0')).status, 'cleared');
  assert.equal(photoRights(f('CC BY-SA 4.0')).status, 'review');
  assert.equal(photoRights(f('CC BY-NC 2.0')).status, 'blocked');
  const crowd = photoRights(f('CC0', 'Concert crowd with fans'));
  assert.equal(crowd.status, 'review');
  assert.equal(crowd.peopleOrBrands, true);
  assert.match(crowd.reason, /look at it when you approve/);
  for (const t of ['Bride and groom', 'Woman with iPhone', 'Nike logo wall', 'Family on the beach']) assert.ok(PEOPLE_OR_BRANDS.test(t), t);
  for (const t of ['Mountain lake at dawn', 'City night lights', 'Fireworks over the river', 'Manhattan skyline']) assert.ok(!PEOPLE_OR_BRANDS.test(t), t);
  assert.equal(photoAssetId('https://x/1'), photoAssetId('https://x/1'));
  assert.match(photoAssetId('https://x/1'), /^[a-f0-9]{12}$/);
});

test('only photos, and only on topic', () => {
  for (const t of ['Sea after sunset, by Piet Mondriaan oil on canvas', 'Mountain Lake Park from Book of the Royal Blue', 'Autumn forest 1871 painting', 'Map of the city']) assert.ok(NOT_A_PHOTO.test(t), t);
  for (const t of ['Moraine Lake 17092005', 'Snowy Annapurna Range - panorama', 'Price Building illuminated at night in Quebec City 2016']) assert.ok(!NOT_A_PHOTO.test(t), t);
  assert.ok(relevant({ title: 'Price Building illuminated at night', tags: 'City lights Quebec' }, 'city night lights'));
  assert.ok(!relevant({ title: 'Trip buses in Sri Lanka', tags: 'Buses Lights' }, 'wedding decoration lights'));
  assert.ok(relevant({ title: 'Moraine Lake', tags: 'Mountains Lakes' }, 'mountain lake'));
});

test('Pixabay: page link, large image, tags as words, licence clears scenery', () => {
  const r = pixabayResults({ hits: [
    { pageURL: 'https://pixabay.com/photos/lake-1/', largeImageURL: 'https://pixabay.com/get/1_1280.jpg', imageWidth: 6000, imageHeight: 4000, tags: 'lake, mountains, sunrise', user: 'Kanenori' },
    { pageURL: 'https://pixabay.com/photos/small-2/', largeImageURL: 'https://pixabay.com/get/2.jpg', imageWidth: 500, imageHeight: 400, tags: 'small', user: 'x' },
  ] });
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].w, r[0].h, r[0].title, r[0].author], [1280, 853, 'lake, mountains, sunrise', 'Kanenori']);
  assert.equal(photoRights(r[0]).status, 'cleared');
  assert.equal(photoRights({ ...r[0], tags: 'woman, portrait' }).status, 'review');
  assert.deepEqual(pixabayResults({}), []);
});
