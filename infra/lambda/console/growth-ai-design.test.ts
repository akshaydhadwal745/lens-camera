// Run: cd infra && npx tsx --test lambda/console/growth-ai-design.test.ts
// The AI designer's guard rails: cleaning, kit expansion, word checks, the prompt.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_BRAND } from './growth-brand';
import { aiPageHtml, designPrompt, designsByLabel, designSpace, expandKit, sanitizeDesign, wordProblems, type KitPhoto } from './growth-ai-design';
import { frames } from './growth-media';

const photos: KitPhoto[] = [
  { ref: 'p1', url: 'https://img.lens/aaa', about: 'city night lights: Quebec at night', w: 1600, h: 1067 },
  { ref: 'p2', url: 'https://img.lens/bbb', about: 'mountain lake', w: 1080, h: 1620 },
];

test('cleaning removes scripts, handlers, external URLs and raw images', () => {
  const dirty = `<style>@import url(https://evil.example/x.css); .a{background:url(https://evil.example/t.png)} .b{background:url(photo:p2)}</style>
<div onclick="alert(1)" class="a">Hi</div><script>alert(1)</script><img src="https://x/y.png"><iframe src="https://x"></iframe>
<svg><a href="https://x"><circle r="4"/></a><use href="#c"/><script>1</script></svg><a href="javascript:alert(1)">x</a>`;
  const clean = sanitizeDesign(dirty);
  assert.doesNotMatch(clean, /script|onclick|iframe|<img|evil|@import|javascript:/i);
  assert.match(clean, /url\(photo:p2\)/);
  assert.match(clean, /<circle r="4"\/>/);
});

test('kit tags become the real phone, photos, icon and tick', () => {
  const html = expandKit('<lens-phone screen="backup" x="600" y="400" scale="1.1" rotate="-6"></lens-phone><lens-photo src="p2" x="0" y="0" w="1080" h="1350" border="8"></lens-photo><lens-icon x="64" y="64" size="72"></lens-icon><lens-check size="40"></lens-check><div style="background:url(photo:p1)"></div>', photos, 'data:image/png;base64,AA', ['https://img.lens/pool1']);
  assert.match(html, /class="phone" style="left:600px;top:400px;transform:scale\(1\.100\) rotate\(-6deg\)"/);
  assert.match(html, />Backup</);
  assert.match(html, /class="kit-photo"[^>]*width:1080px;height:1350px[^>]*url\(https:\/\/img\.lens\/bbb\)[^>]*border:8px solid #fff/);
  assert.match(html, /<img class="lens-icon" src="data:image\/png;base64,AA" style="position:absolute;left:64px;top:64px;width:72px;height:72px/);
  assert.match(html, /class="check" style="width:40px;height:40px/);
  assert.match(html, /url\(https:\/\/img\.lens\/aaa\)/);
  // Unknown screen → library; silly numbers are clamped.
  assert.match(expandKit('<lens-phone screen="hack" scale="99"></lens-phone>', photos, '', []), /scale\(2\.500\)[\s\S]*The roll/);
});

test('the page forbids scripts and network, and keeps the canvas size', () => {
  const html = aiPageHtml({ w: 1080, h: 1920 }, '<script>x()</script><h1>Hi</h1>', { photos, pool: [], icon: 'data:image/png;base64,AA', brand: DEFAULT_BRAND, fonts: {} });
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; img-src data: https:\/\/img\.lens/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /data-w="1080" data-h="1920"/);
  assert.deepEqual(designSpace(1280, 720), { W: 1115, H: 627, k: 1280 / 1115 });
});

test('words: only the post’s words, a few labels, no new numbers or claims', () => {
  const allowed = 'Storage full. Again. Don’t delete a single photo yet. Try Lens free 10 GB free forever. No card needed. lens.instagrowapp.com Lens';
  assert.deepEqual(wordProblems('Storage full. Again. Don’t delete a single photo yet. BEFORE AFTER', allowed), []);
  assert.match(wordProblems('Storage full. 18.4 GB freed', allowed).join(), /numbers not in the post: 18/);
  assert.match(wordProblems('The best way to never lose a moment again with friends and family forever', allowed).join(), /too many words|claim/);
  assert.match(wordProblems('Unlimited storage', allowed).join(), /claim/);
  // The post's own words may say "best" (checked when the post was written); the design may not add one.
  assert.deepEqual(wordProblems('Your guests took the best photos.', 'Your guests took the best photos. Lens'), []);
  assert.match(wordProblems('The best photos. Best app.', 'The best photos. Lens app').join(), /claim/);
  assert.match(wordProblems('Storage full 🔥', allowed).join(), /emoji/);
});

test('prompt: every image with canvas, words and screen; fix round lists the problems', () => {
  const post = { id: 'abcdef0123', format: 'carousel', hook: 'Phone full? Keep every photo.', slides: [{ headline: 'Phone full? Keep every photo.', body: '', visual: 'app: library' }, { headline: 'From full to free.', body: 'One tap.', visual: 'before and after' }, { headline: '', body: '', visual: '' }], script: [], variants: { instagram: {}, linkedin: {} } };
  const list = frames(post as Parameters<typeof frames>[0], 'Try Lens free');
  const p = designPrompt({ title: 'Phone full', format: 'carousel' }, list, photos, DEFAULT_BRAND, 'Try Lens free', '10 GB free forever.', 'lens.instagrowapp.com');
  assert.match(p, /label "Slide 1" · canvas 1080×1350 · slide 1 of 3 \(cover\)/);
  assert.match(p, /label "Slide 3" · canvas 1080×1350 · call to action[\s\S]*CTA: "Try Lens free"/);
  assert.match(p, /label "LinkedIn image" · canvas 1200×627/);
  assert.match(p, /- p1: city night lights: Quebec at night \(1600×1067, landscape\)/);
  const fix = designPrompt({ title: 'Phone full', format: 'carousel' }, [list[1]], photos, DEFAULT_BRAND, 'x', 'y', 'z', new Map([['Slide 2', ['text "From" overlaps the phone']]]));
  assert.match(fix, /Design again only the images below/);
  assert.match(fix, /FAILED THESE CHECKS, fix them: text "From" overlaps the phone/);
  assert.doesNotMatch(fix, /Slide 1/);
});

test('answers: only known labels, sane sizes', () => {
  const m = designsByLabel({ designs: [{ label: 'Slide 1', idea: 'a', html: '<h1>x</h1>' }, { label: 'Nope', idea: 'b', html: 'x' }, { label: 'Slide 2', idea: 'c', html: 'x'.repeat(70_000) }] }, ['Slide 1', 'Slide 2']);
  assert.deepEqual([...m.keys()], ['Slide 1']);
  assert.equal(designsByLabel(undefined, ['x']).size, 0);
});
