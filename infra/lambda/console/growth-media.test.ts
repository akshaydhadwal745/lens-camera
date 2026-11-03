// Run: cd infra && npx tsx --test lambda/console/growth-media.test.ts
// The render engine's pure parts: which images a post needs, and the HTML each is drawn from.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_BRAND } from './growth-brand';
import { drawable, esc, frameHtml, frames, headlineSize, renderAssetId } from './growth-media';

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

test('the HTML is self-contained and escaped', () => {
  const [fr] = frames(post({ hook: 'Back up <b>"all"</b> & more' }), 'x');
  const html = frameHtml(fr, DEFAULT_BRAND, { font: 'AAAA', mark: '<svg></svg>' });
  assert.match(html, /Back up &lt;b&gt;&quot;all&quot;&lt;\/b&gt; &amp; more/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.match(html, /width:1080px;height:1350px/);
  assert.match(html, new RegExp(DEFAULT_BRAND.colors.accent));
  assert.equal(esc('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  // A photo of our own goes in the cover; the call to action shows the button.
  assert.match(frameHtml(fr, DEFAULT_BRAND, { photo: 'data:image/png;base64,AA' }), /class="photo"/);
  assert.match(frameHtml({ ...fr, style: 'cta' }, DEFAULT_BRAND), /class="action">Try Lens free</);
});

test('image text keeps what the font can draw', () => {
  assert.equal(drawable('Plus is ₹59 a month 🎉'), 'Plus is Rs 59 a month');
  assert.equal(drawable('Don’t lose it — “ever”… café €5'), 'Don’t lose it — “ever”… café €5');
  assert.equal(drawable('Swipe → नमस्ते'), 'Swipe ->');
  const [fr] = frames(post({ hook: 'Backup 🔥 done', format: 'carousel', slides: [{ headline: 'Backup 🔥 done', body: '', visual: '' }, { headline: 'b', body: '', visual: '' }] }), 'x');
  const html = frameHtml(fr, DEFAULT_BRAND);
  assert.match(html, /<h1>Backup done<\/h1>/);
  assert.doesNotMatch(html, /→/);
});

test('headline size shrinks with length and stays readable on wide frames', () => {
  assert.ok(headlineSize('Phone full?', 1080, 1350) > headlineSize('A much longer headline that keeps going on and on for a while', 1080, 1350));
  assert.ok(headlineSize('Our first growth report said 147 installs. 0% came back.', 1200, 627) >= 48);
});

test('render ids are stable per post and image', () => {
  assert.equal(renderAssetId('abcdef0123', 'Slide 1'), renderAssetId('abcdef0123', 'Slide 1'));
  assert.notEqual(renderAssetId('abcdef0123', 'Slide 1'), renderAssetId('abcdef0123', 'Slide 2'));
  assert.match(renderAssetId('abcdef0123', 'Cover'), /^[a-f0-9]{12}$/);
});
