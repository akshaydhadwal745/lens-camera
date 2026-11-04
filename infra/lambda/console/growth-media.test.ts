// Run: cd infra && npx tsx --test lambda/console/growth-media.test.ts
// The render engine's pure parts: which images a post needs, and the HTML each is drawn from.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_BRAND } from './growth-brand';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { designHtml } from './growth-design';
import { drawable, esc, frames, hasDevanagari, parseVisual, renderAssetId, screenFor, topicQuery, whereToPost, zipName, zipStore } from './growth-media';

const post = (o: Record<string, unknown> = {}) => ({ id: 'abcdef0123', format: 'post', hook: 'Phone full?', slides: [], script: [], variants: { instagram: {} }, ...o }) as Parameters<typeof frames>[0];

test('images per format and platform', () => {
  const sizes = (p: Parameters<typeof frames>[0]) => frames(p, 'Try Lens free').map((f) => `${f.label} ${f.w}x${f.h}`);
  assert.deepEqual(sizes(post()), ['Post image 1080x1350']);
  assert.deepEqual(sizes(post({ variants: { instagram: {}, linkedin: {}, pinterest: {} } })), ['Post image 1080x1350', 'Wide image 1200x627', 'Pin 1000x1500']);
  assert.deepEqual(sizes(post({ format: 'short', variants: { instagram: {}, youtube: {} } })), ['Cover 1080x1920', 'YouTube thumbnail 1280x720']);
  assert.deepEqual(sizes(post({ format: 'story' })), ['Story 1080x1920']);
  assert.deepEqual(sizes(post({ format: 'pin', variants: { pinterest: {} } })), ['Pin 1000x1500']);
  assert.deepEqual(sizes(post({ format: 'thread', variants: { x: {} } })), ['Header image 1200x627']);
  // A reel without a hook takes its first scene's words.
  assert.equal(frames(post({ format: 'reel', hook: '', script: [{ seconds: 3, onScreen: 'Storage full. Again.', visual: '' }] }), 'x')[0].headline, 'Storage full. Again.');
  // Nothing to say → nothing to draw.
  assert.deepEqual(frames(post({ hook: '' }), 'x'), []);
});

test('carousel: cover, numbered slides, call to action last', () => {
  const slides = [
    { headline: 'Phone full?', body: '', visual: '' },
    { headline: 'Back up first', body: 'Every photo at full quality.', visual: '' },
    { headline: '', body: '', visual: '' },
  ];
  const f = frames(post({ format: 'carousel', slides, variants: { instagram: {}, linkedin: {} } }), 'Try Lens free');
  assert.deepEqual(f.map((x) => [x.label, x.style, x.index, x.total]), [
    ['Slide 1', 'cover', 1, 3],
    ['Slide 2', 'slide', 2, 3],
    ['Slide 3', 'cta', 3, 3],
    ['LinkedIn image', 'cover', undefined, undefined],
  ]);
  assert.equal(f[2].headline, 'Try Lens free');
});

test('escaping', () => {
  assert.equal(esc('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
});

test('image text keeps what the font can draw', () => {
  assert.equal(drawable('Plus is ₹59 a month 🎉'), 'Plus is ₹59 a month');
  assert.equal(drawable('Don’t lose it — “ever”… café €5'), 'Don’t lose it — “ever”… café €5');
  assert.equal(drawable('Swipe → नमस्ते 😀'), 'Swipe -> नमस्ते');
  assert.equal(drawable('फ़ोन भर गया? ज़रूरी फ़ोटो बचाएँ।'), 'फ़ोन भर गया? ज़रूरी फ़ोटो बचाएँ।');
  assert.equal(drawable('日本 Привет'), '');
});

test('render ids are stable per post and image', () => {
  assert.equal(renderAssetId('abcdef0123', 'Slide 1'), renderAssetId('abcdef0123', 'Slide 1'));
  assert.notEqual(renderAssetId('abcdef0123', 'Slide 1'), renderAssetId('abcdef0123', 'Slide 2'));
  assert.match(renderAssetId('abcdef0123', 'Cover'), /^[a-f0-9]{12}$/);
});

test('Hindi text gets the Devanagari font (English is the default)', () => {
  assert.ok(hasDevanagari('फ़ोन भर गया?'));
  assert.ok(!hasDevanagari('Phone full?'));
});

test('each image says which platforms it is for', () => {
  const to = (p: Parameters<typeof frames>[0]) => frames(p, 'x').map((f) => `${f.label}: ${f.for.join(',')}`);
  assert.deepEqual(to(post({ variants: { instagram: {}, facebook: {}, linkedin: {}, x: {}, pinterest: {} } })), ['Post image: instagram,facebook', 'Wide image: linkedin,x', 'Pin: pinterest']);
  assert.deepEqual(to(post({ format: 'short', variants: { instagram: {}, youtube: {} } })), ['Cover: instagram', 'YouTube thumbnail: youtube']);
  assert.deepEqual(to(post({ format: 'story', variants: { instagram: {}, youtube: {} } })), ['Story: instagram,youtube']);
  const slides = [{ headline: 'a', body: '', visual: '' }, { headline: 'b', body: '', visual: '' }];
  assert.deepEqual(to(post({ format: 'carousel', slides, variants: { instagram: {}, linkedin: {} } })), ['Slide 1: instagram', 'Slide 2: instagram', 'LinkedIn image: linkedin']);
  const list = frames(post({ variants: { linkedin: {} } }), 'x');
  const note = whereToPost('Phone full', list);
  assert.match(note, /01 Post image 1080x1350\.png\r\n {4}Spare/);
  assert.match(note, /02 Wide image 1200x627\.png\r\n {4}LinkedIn/);
  assert.equal(zipName(9, { label: 'Slide 10 / “x”', w: 1, h: 2 }), '10 Slide 10  x 1x2.png');
});

test('the zip opens in standard tools with every file intact', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]);
  const zip = zipStore([{ name: '01 Slide 1 1080x1350.png', data: png }, { name: 'where-to-post.txt', data: Buffer.from('नमस्ते\r\n') }], new Date('2026-11-04T10:20:30Z'));
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), 2);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 'a.zip');
  writeFileSync(file, zip);
  // Python's zipfile checks every CRC (testzip) and reads the names back.
  const out = execFileSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("|".join(i.filename+":"+str(i.file_size) for i in z.infolist()));print(z.read("where-to-post.txt").decode())', file], { encoding: 'utf8' });
  assert.equal(out.split('\n')[0], '01 Slide 1 1080x1350.png:9|where-to-post.txt:20');
  assert.match(out, /नमस्ते/);
});

test('each image gets a design: hero cover, varied middle slides, call to action last', () => {
  const slides = [
    { headline: 'Phone full? Keep every photo.', body: '', visual: 'app screen: the library' },
    { headline: 'From full to free.', body: 'One tap.', visual: 'before and after: storage full vs freed' },
    { headline: 'Shoot all night.', body: '', visual: 'photo: concert stage lights' },
    { headline: 'Every original, untouched', body: 'Full quality backup', visual: '' },
    { headline: '', body: '', visual: '' },
  ];
  const f = frames(post({ format: 'carousel', slides, variants: { instagram: {}, linkedin: {} } }), 'Try Lens free');
  assert.deepEqual(f.map((x) => `${x.label}: ${x.layout}/${x.screen}`), [
    'Slide 1: hero/library',
    'Slide 2: compare/free-space',
    'Slide 3: moment/viewer',
    'Slide 4: phone/backup',
    'Slide 5: cta/library',
    'LinkedIn image: hero/library',
  ]);
  assert.equal(f[2].query, 'concert stage lights');
  // No notes: the topic picks the screen and the scene.
  const plain = frames(post({ hook: 'Wedding photos from every guest', format: 'short', variants: { instagram: {}, youtube: {} } }), 'x');
  assert.deepEqual(plain.map((x) => `${x.layout}/${x.screen}/${x.query}`), ['hero/qr-album/wedding table decoration', 'moment/qr-album/wedding table decoration']);
});

test('screens, scenes and visual notes', () => {
  assert.equal(screenFor('Storage full again?'), 'storage-full');
  assert.equal(screenFor('Free up 20 GB safely'), 'free-space');
  assert.equal(screenFor('Shoot in Night mode'), 'camera');
  assert.equal(screenFor('Guests scan one QR code'), 'qr-album');
  assert.equal(screenFor('Hello'), 'library');
  assert.equal(topicQuery('Diwali lights'), 'fireworks night sky');
  assert.equal(topicQuery('nothing here'), 'sunset sea');
  assert.deepEqual(parseVisual('photo: misty mountain road. Phone shows it backed up'), { layout: 'moment', query: 'misty mountain road', screen: 'backup' });
  assert.deepEqual(parseVisual('app: Free up space screen'), { layout: 'phone', screen: 'free-space' });
  assert.deepEqual(parseVisual('just words'), {});
});

test('every layout draws at every size without throwing', () => {
  const sizes = [[1080, 1350], [1080, 1920], [1000, 1500], [1200, 627], [1280, 720]];
  for (const layout of ['hero', 'compare', 'moment', 'phone', 'cta'] as const)
    for (const [w, h] of sizes) {
      const html = designHtml({ w, h, layout, screen: 'library', headline: 'Phone full? Keep every photo.', body: 'Body', index: 1, total: 4, cta: 'Try Lens free', site: 'lens.instagrowapp.com', pool: ['https://img.lens/a'], icon: 'data:image/png;base64,AA', fonts: {}, brand: DEFAULT_BRAND });
      assert.match(html, new RegExp(`html,body\\{width:${w}px;height:${h}px`));
    }
});
