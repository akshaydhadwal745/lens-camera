// Run: cd infra && npx tsx --test lambda/console/growth-design.test.ts
// Designed content images: self-contained HTML, escaped text, two-tone headlines, no number claims on cards.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_BRAND } from './growth-brand';
import { designHtml, fitSize, LAYOUTS, PROOF, qrPattern, SCREENS, screenHtml, splitHeadline } from './growth-design';

const d = (o: Partial<Parameters<typeof designHtml>[0]> = {}) =>
  designHtml({ w: 1080, h: 1350, layout: 'hero', screen: 'library', headline: 'Phone full? Keep every photo.', body: 'Lens backs up everything.', index: 1, total: 4, cta: 'Try Lens free', site: 'lens.instagrowapp.com', pool: ['https://img.lens/aaa', 'https://img.lens/bbb'], icon: 'data:image/png;base64,AA', fonts: { geist: 'GG' }, brand: DEFAULT_BRAND, ...o });

test('self-contained: only inline data and the in-memory photo host', () => {
  for (const layout of LAYOUTS)
    for (const screen of SCREENS) {
      const html = d({ layout, screen, photo: 'https://img.lens/scene' });
      const urls = [...html.matchAll(/url\(([^)]+)\)|src="([^"]+)"/g)].map((m) => m[1] ?? m[2]);
      for (const u of urls) assert.match(u, /^(data:|https:\/\/img\.lens\/|"data:)/, `${layout}/${screen}: ${u.slice(0, 40)}`);
      assert.doesNotMatch(html.replace(/https:\/\/img\.lens\//g, '').replace(/http:\/\/www\.w3\.org\/2000\/svg/g, ''), /https?:\/\//, `${layout}/${screen}`);
    }
});

test('text is escaped and the headline is two-tone', () => {
  const html = d({ headline: 'Phone <b>full</b>? Keep "every" photo.' });
  assert.match(html, /Phone &lt;b&gt;full&lt;\/b&gt;\?<br><em style="color:#2563EB">Keep &quot;every&quot; photo\.<\/em>/);
  assert.deepEqual(splitHeadline('Phone full? Keep every photo.'), ['Phone full?', 'Keep every photo.']);
  assert.deepEqual(splitHeadline('One line only'), ['One line only', '']);
});

test('sizes: scaled from the design space, counter on carousels only', () => {
  assert.match(d(), /transform:scale\(1\.0000\)/);
  assert.match(d({ w: 1000, h: 1500 }), /width:1080px;height:1620px;transform:scale\(0\.9259\)/);
  assert.match(d({ w: 1280, h: 720 }), /width:1115px;height:627px/);
  assert.match(d(), />1\/4</);
  assert.doesNotMatch(d({ total: 1 }), /class="count"/);
});

test('cards promise, never count; the call to action uses the offer', () => {
  for (const [title, sub] of Object.values(PROOF).flat()) assert.doesNotMatch(`${title} ${sub}`.replace(/4K/g, ''), /\d/, title);
  const cta = d({ layout: 'cta', body: '' });
  assert.match(cta, /Try Lens free/);
  assert.match(cta, /10 GB free forever\. No card needed\./);
  assert.match(cta, /lens\.instagrowapp\.com/);
});

test('screens: library tiles use the pool, viewer the scene; QR is stable', () => {
  const lib = screenHtml('library', { pool: ['https://img.lens/p1'] }, 0);
  assert.equal((lib.match(/https:\/\/img\.lens\/p1/g) ?? []).length, 15);
  assert.match(lib, /The roll/);
  assert.match(screenHtml('viewer', { pool: [], photo: 'https://img.lens/scene' }), /img\.lens\/scene/);
  assert.doesNotMatch(screenHtml('viewer', { pool: [], photo: 'x' }), /MP|shot on/i);
  assert.equal(qrPattern(3), qrPattern(3));
  assert.notEqual(qrPattern(3), qrPattern(4));
  // No photos at all still draws (grey tiles).
  assert.match(screenHtml('library', { pool: [] }), /linear-gradient\(135deg,#1C1C1E/);
});

test('headline size fits the column', () => {
  assert.equal(fitSize('Phone full?', 600, 96), 96);
  assert.ok(fitSize('A very long headline that keeps going and going for a long while', 600, 96) < 96);
  assert.ok(fitSize('x'.repeat(400), 600, 96) >= 40);
});
