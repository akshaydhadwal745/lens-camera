// Run: cd infra && npx tsx --test lambda/console/growth-photos.test.ts
// Photos found online: what we read from each source and what the rights check makes of it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { videoResults, fromStock, openverseResults, relevant, PEOPLE_OR_BRANDS, pexelsResults, photoPassed, pixabayResults, photoAssetId, photoRights, postTotal, readScores, sheetHtml, sheetPrompt, sheetVerdicts, type Found, type ImageScore, type Photo } from './growth-photos';

test('Pexels: licence, photographer, size capped at the downloaded width', () => {
  const r = pexelsResults({ photos: [{ url: 'https://www.pexels.com/photo/1/', width: 4000, height: 6000, photographer: 'Ana', alt: 'Snowy mountain peak', src: { large2x: 'https://images.pexels.com/1.jpg' } }] });
  assert.deepEqual(r[0], { source: 'Pexels', sourceUrl: 'https://www.pexels.com/photo/1/', imageUrl: 'https://images.pexels.com/1.jpg', w: 1880, h: 2820, license: 'Pexels License', licenseUrl: 'https://www.pexels.com/license/', author: 'Ana', title: 'Snowy mountain peak', tags: 'Snowy mountain peak' });
});

test('rights: scenery clears, people or brands wait for a manager, share-alike and NC never auto-clear', () => {
  const f = (license: string, title = 'Mountain lake at dawn'): Found => ({ source: 'Pixabay', sourceUrl: 'https://x/1', imageUrl: 'https://x/1.jpg', w: 1600, h: 1067, license, licenseUrl: '', author: 'a', title, tags: title });
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

test('Pixabay: search-stuffing tags are ignored, real people tags still count', () => {
  const hit = (tags: string) => pixabayResults({ hits: [{ pageURL: 'https://pixabay.com/photos/1/', largeImageURL: 'https://pixabay.com/get/1.jpg', imageWidth: 3000, imageHeight: 4000, user: 'a', tags }] })[0];
  const candle = hit('candle, black background, samsung wallpaper, iphone wallpaper, mobile wallpaper, flame');
  assert.equal(candle.tags, 'candle, flame');
  assert.equal(photoRights(candle).status, 'cleared');
  assert.equal(photoRights(hit('wedding, bride, candle')).status, 'review');
});

test('photo check: found photos need a yes, our own do not; unanswered numbers stay unknown', () => {
  const p = (x: Partial<Photo>) => x as Photo;
  assert.equal(photoPassed(p({ origin: 'discovered' })), false);
  assert.equal(photoPassed(p({ origin: 'discovered', looked: { ok: false, why: 'people', at: 1 } })), false);
  assert.equal(photoPassed(p({ origin: 'discovered', looked: { ok: true, why: 'fine', at: 1 } })), true);
  assert.equal(photoPassed(p({ origin: 'upload' as Photo['origin'] })), true);
  const v = sheetVerdicts({ photos: [{ n: 1, ok: true, fit: 9, why: 'clean' }, { n: 3, ok: false, fit: 40, why: 'faces' }, { n: 9, ok: true, fit: 1, why: 'out of range' }] }, 3);
  assert.deepEqual([...v.keys()], [0, 2]);
  assert.equal(v.get(2)?.ok, false);
  assert.equal(v.get(0)?.fit, 9);
  assert.equal(v.get(2)?.fit, 10); // clamped
  assert.equal(sheetVerdicts(undefined, 3).size, 0);
  assert.match(sheetPrompt('/tmp/s.jpg', 'Title: Wedding albums', ['candles', 'lake']), /\/tmp\/s\.jpg[\s\S]*Title: Wedding albums[\s\S]*1: searched for "candles"\n2: searched for "lake"/);
  assert.equal((sheetHtml(['data:image/png;base64,AA', 'data:image/png;base64,BB']).match(/<img /g) ?? []).length, 2);
});

test('photos: stock and free licences that allow commercial edits are used automatically; share-alike and NC are not', () => {
  const p = (origin: string, license: string) => ({ origin, rights: { license } }) as unknown as Photo;
  assert.equal(fromStock(p('discovered', 'Pixabay Content License')), true);
  assert.equal(fromStock(p('discovered', 'CC BY 2.0')), true);
  assert.equal(fromStock(p('discovered', 'CC0')), true);
  assert.equal(fromStock(p('discovered', 'CC BY-SA 4.0')), false);
  assert.equal(fromStock(p('discovered', 'CC BY-NC 2.0')), false);
  assert.equal(fromStock(p('upload', 'own')), true);
});

test('openverse: licences named, credit kept, small images and non-photos dropped', () => {
  const r = (o: Record<string, unknown>) => ({ foreign_landing_url: 'https://www.flickr.com/photos/a/1', url: 'https://live.staticflickr.com/1.jpg', width: 2000, height: 1300, license: 'by', license_version: '2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/', creator: 'Ann', title: 'Wedding table', tags: [{ name: 'wedding' }, { name: 'table' }], ...o });
  const got = openverseResults({ results: [r({}), r({ license: 'cc0', license_version: '1.0' }), r({ width: 600 }), r({ title: 'Oil painting of a table' })] });
  assert.equal(got.length, 2);
  assert.equal(got[0].license, 'CC BY 2.0');
  assert.equal(got[0].author, 'Ann');
  assert.equal(got[0].tags, 'wedding, table');
  assert.equal(got[1].license, 'CC0');
  assert.equal(photoRights(got[0]).status, 'cleared');
  assert.equal(relevant(got[0], 'wedding table setting'), true);
  assert.equal(relevant(got[0], 'mountain lake'), false);
});

test('score: a photo that does not belong caps the image; the weakest image pulls the post down', () => {
  const [a, b, c] = readScores({ images: [
    { n: 1, score: 90, relates: 85, clear: 90, design: 95, why: 'great', fix: '' },
    { n: 2, score: 88, relates: 10, clear: 90, design: 90, why: 'unrelated ceremony', fix: 'use a wedding photo' },
    { n: 9, score: 50, relates: 50, clear: 50, design: 50, why: 'no such image', fix: '' },
  ] }, ['Slide 1', 'Slide 2']).concat([undefined as unknown as ImageScore]);
  assert.equal(a.score, 90);
  assert.equal(b.score, 25); // relates 10 + 15
  assert.equal(b.fix, 'use a wedding photo');
  assert.equal(c, undefined); // n 9 ignored
  assert.equal(readScores(undefined, ['x']).length, 0);
  const img = (score: number) => ({ score }) as ImageScore;
  assert.equal(postTotal([img(90), img(90)], 90), 90);
  assert.ok(postTotal([img(90), img(90), img(90), img(25)], 90) < 70);
  assert.equal(postTotal([], 90), 0);
});

test('Pixabay videos: real footage at 1080p or more, no AI, people or brands, nothing huge', () => {
  const v = (id: number, tags: string, large: Record<string, unknown> = {}, duration = 15) => ({ id, pageURL: `https://pixabay.com/videos/${id}/`, duration, user: 'a', tags, videos: { large: { url: `https://cdn/${id}.mp4`, width: 1920, height: 1080, size: 9_000_000, thumbnail: `https://cdn/${id}.jpg`, ...large }, medium: { url: `https://cdn/${id}m.mp4`, width: 1280, height: 720, size: 2_000_000, thumbnail: 'https://cdn/m.jpg' } } });
  const r = videoResults({ hits: [v(1, 'candles, table'), v(2, 'ai generated, table'), v(3, 'bride, candles'), v(4, 'roses', { url: '' }), v(5, 'roses', { size: 90_000_000 }), v(6, 'roses', {}, 2), v(7, 'candle, iphone wallpaper'), v(8, 'door, green screen'), v(9, 'heart, animated, loop')] });
  assert.deepEqual(r.map((x) => x.id), ['1', '7']);
  assert.equal(r[0].url, 'https://cdn/1.mp4');
  assert.equal(r[0].thumb, 'https://cdn/1.jpg');
  assert.deepEqual(videoResults({}), []);
});
