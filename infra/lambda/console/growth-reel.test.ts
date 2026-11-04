// Run: cd infra && npx tsx --test lambda/console/growth-reel.test.ts
// Reels: the plan keeps the script's words and timing, the rules hold whatever Claude says, the page is self-contained.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultPlan, kinetic, MAX_SECONDS, readPlan, reelHtml, textSize, type ReelScene } from './growth-reel';

const wedding = { hook: 'Wedding photos stuck?', script: [
  { seconds: 3, onScreen: "Wedding photos stuck on guests' phones?", visual: 'gallery' },
  { seconds: 4, onScreen: 'Make one event album', visual: 'Lens app' },
  { seconds: 4, onScreen: 'Print the QR. Put it on tables.', visual: 'card' },
  { seconds: 4, onScreen: 'Guests scan. No app needed.', visual: 'phone' },
  { seconds: 4, onScreen: "Every guest's photos, one album", visual: 'library' },
  { seconds: 3, onScreen: 'Original quality, not chat copies', visual: 'viewer' },
  { seconds: 3, onScreen: 'Make an event album for your next party', visual: 'end card' },
] };

test('plan from the words: footage opens, the end card closes, each line gets its scene', () => {
  const plan = defaultPlan(wedding, 'wedding table decoration', 'Try Lens free');
  assert.deepEqual(plan.map((s) => s.type), ['footage', 'album', 'qr-card', 'scan', 'fill', 'compare', 'end']);
  assert.equal(plan[2].query, 'wedding table decoration');
  assert.equal(plan[1].query, undefined);
  assert.equal(plan[0].text, wedding.script[0].onScreen);
  assert.deepEqual(plan.map((s) => s.seconds), [3, 4, 4, 4, 4, 3, 3]);
});

test('plan: never over the limit; a post with no script still gets a reel', () => {
  const long = { script: Array.from({ length: 10 }, (_, i) => ({ seconds: 6, onScreen: `Line ${i}`, visual: '' })) };
  assert.ok(defaultPlan(long, 'x', 'c').reduce((a, s) => a + s.seconds, 0) <= MAX_SECONDS);
  const bare = defaultPlan({ hook: 'Phone full?' }, 'sunset sea', 'Try Lens free');
  assert.deepEqual(bare.map((s) => s.text), ['Phone full?', 'Try Lens free']);
  assert.deepEqual(bare.map((s) => s.type), ['footage', 'end']);
});

test('director: chooses scenes, but words stay, the last is the end card, and event scenes need an event post', () => {
  const plan = defaultPlan(wedding, 'wedding', 'c');
  const out = readPlan({ scenes: [{ n: 1, type: 'footage', screen: 'library', query: 'candles on <b>table</b>' }, { n: 2, type: 'phone', screen: 'qr-album', query: '' }, { n: 7, type: 'footage', screen: 'library', query: 'x' }, { n: 3, type: 'nonsense', screen: 'hack', query: '' }] }, plan, 'wedding');
  assert.equal(out[0].query, 'candles on btableb');
  assert.equal(out[1].type, 'phone');
  assert.equal(out[1].screen, 'qr-album');
  assert.equal(out[2].type, 'qr-card');
  assert.equal(out[6].type, 'end');
  assert.deepEqual(out.map((s) => s.text), plan.map((s) => s.text));
  assert.deepEqual(readPlan(undefined, plan, 'x'), plan);
  const storage = defaultPlan({ script: [{ seconds: 3, onScreen: 'Storage full', visual: '' }, { seconds: 3, onScreen: 'Free up space', visual: '' }, { seconds: 3, onScreen: 'Try it', visual: '' }] }, 'sunset', 'c');
  const forced = readPlan({ scenes: [{ n: 2, type: 'scan', screen: 'free-space', query: '' }] }, storage, 'sunset');
  assert.equal(forced[1].type, 'phone');
});

test('type: the last sentence is the accent, words are escaped', () => {
  const k = kinetic('Print the QR. Put it "here".', 'x', '');
  assert.equal((k.match(/class="i y"/g) ?? []).length, 3);
  assert.equal((k.match(/class="i"/g) ?? []).length, 3);
  assert.match(k, /&quot;here&quot;/);
  assert.match(kinetic('Lens → Settings', 'x', ''), /<svg[^>]*>.*M4 12h16/);
  assert.doesNotMatch(kinetic('Nice 🔥 one', 'x', ''), /🔥/);
  assert.ok(textSize('short') > textSize('a much much much much much longer line of words here'));
});

test('the page: one layer per scene, every word on it, nothing from the network', () => {
  const scenes: ReelScene[] = defaultPlan(wedding, 'wedding', 'Try Lens free');
  const html = reelHtml({ scenes, media: scenes.map((s) => (s.type === 'compare' ? { hero: 'h.jpg', heroChat: 'c.jpg' } : s.query ? { frames: 100 } : {})), pool: ['p/a.jpg'], icon: 'data:image/png;base64,AA', fonts: {}, cta: 'Try Lens free', site: 'lens.instagrowapp.com' });
  assert.equal((html.match(/class="scene"/g) ?? []).length, 7);
  assert.match(html, /window\.seek/);
  assert.doesNotMatch(html.replace(/http:\/\/www\.w3\.org\/\d+\/svg/g, ''), /https?:\/\//);
  assert.match(html, /Print/);
  // A child of a hidden scene must never stay visible on its own.
  assert.doesNotMatch(html.replace("el.style.visibility=on?'visible':'hidden'", ''), /\?'visible':'hidden'/);
});
