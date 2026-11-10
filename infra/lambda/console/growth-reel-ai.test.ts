import assert from 'node:assert/strict';
import { test } from 'node:test';

import { designsByScene, readWrittenReel, reelDesignPrompt, reelSceneHtml, reelWordProblems, sceneWordProblems, type WrittenReel } from './growth-reel-ai';

const FACTS = 'Full-quality backup. 10 GB free forever. Lens Plus 50 GB for ₹59 a month. Event albums: a QR code guests open.';
const scene = (n: number, words: string, extra: Record<string, unknown> = {}) => ({ n, seconds: 3, words, beat: 'beat', media: 'phone', query: '', screen: 'library', ...extra }) as unknown as WrittenReel['scenes'][number];

test('writer: a good reel is kept and timed to the limit', () => {
  const r = readWrittenReel(
    { angle: 'Wedding photos scattered across guests', audience: 'couples', hook: 'Where are your wedding photos?', scenes: [scene(1, 'Where are your wedding photos?', { media: 'footage', query: 'wedding table' }), scene(2, 'Forty guests. Forty phones.', { seconds: 9 }), scene(3, 'One QR code on every table', { screen: 'qr-album' }), scene(4, 'Everyone adds. Full quality.'), scene(5, '10 GB free forever. Try Lens free', { seconds: 5 })] },
    FACTS,
    'Try Lens free',
  );
  assert.deepEqual(r.problems, []);
  assert.equal(r.reel!.scenes.length, 5);
  assert.equal(r.reel!.scenes[1].seconds, 5); // clamped 2–5
  assert.equal(r.reel!.scenes[0].media, 'footage');
  assert.ok(r.reel!.scenes.reduce((a, s) => a + s.seconds, 0) <= 30);
});

test('writer: claims, invented numbers, missing features, filler and long lines are rejected', () => {
  const bad = (words: string) => readWrittenReel({ angle: '', audience: '', hook: '', scenes: [scene(1, words), scene(2, 'b'), scene(3, 'c'), scene(4, 'd')] }, FACTS, 'Try Lens free').problems.join(' | ');
  assert.match(bad('Unlimited storage for everyone'), /claim we never make/);
  assert.match(bad('The best camera app'), /claim we never make/);
  assert.match(bad('Get 100 GB free today'), /numbers/);
  assert.doesNotMatch(bad('10 GB free forever'), /numbers/);
  assert.match(bad('Now on the iPhone app'), /doesn't have/);
  assert.match(bad('A seamless backup experience'), /corporate/);
  assert.match(bad('one two three four five six seven eight nine'), /too many words/);
  assert.match(readWrittenReel({ scenes: [scene(1, 'a'), scene(2, 'b')] }, FACTS, 'x').problems.join(), /fewer than 4/);
});

test('word problems: prices from the facts are fine, emoji and hashtags are not', () => {
  assert.deepEqual(reelWordProblems('Plus is ₹59 a month', FACTS), []);
  assert.match(reelWordProblems('Plus is ₹49 a month', FACTS).join(), /numbers/);
  assert.match(reelWordProblems('So good 🔥', FACTS).join(), /emoji/);
  assert.match(reelWordProblems('#wedding goals', FACTS).join(), /hashtags/);
});

test('scene html: no scripts or network, kit parts expanded, footage stepped by the page', () => {
  const html = reelSceneHtml(
    `<style>@keyframes s1-a{from{opacity:0}to{opacity:1}} .x{background:url(https://evil.example/a.png)}</style><script>alert(1)</script><div onclick="x()" class="x">Hi</div><img src="https://evil.example/b.png"><lens-footage x="0" y="0" w="1080" h="1920"></lens-footage><lens-qr-card x="200" y="700" w="560" title="Riya &amp; Kabir"></lens-qr-card><lens-photo src="p1" x="10" y="10" w="200" h="200"></lens-photo><lens-icon x="80" y="1500" size="140"></lens-icon>`,
    { photos: [{ ref: 'p1', url: 'p/abc.jpg', about: 'table', w: 1600, h: 1067 }], pool: [], icon: 'data:image/png;base64,AA', clip: { dir: 'f/0', frames: 90 }, qr: '<svg></svg>', brandDark: '#000' },
  );
  assert.doesNotMatch(html, /<script|onclick|evil\.example/);
  assert.match(html, /@keyframes s1-a/);
  assert.match(html, /data-clip="f\/0" data-n="90"/);
  assert.match(html, /EVENT ALBUM/);
  assert.match(html, /url\(p\/abc\.jpg\)/);
  assert.match(html, /class="lens-icon"/);
  // No clip and no photo: the brand glow, never an empty frame.
  const none = reelSceneHtml('<lens-footage></lens-footage>', { photos: [], pool: [], icon: '', qr: '', brandDark: '#0b1020' });
  assert.match(none, /background:#0b1020/);
});

test('designs: by scene number; unknown numbers and odd entries handled', () => {
  const d = designsByScene({ scenes: [{ n: 1, idea: 'a', entry: 'whip', html: '<div></div>' }, { n: 9, idea: 'x', entry: 'cut', html: '' }, { n: 2, idea: 'b', entry: 'spin' as never, html: '<i></i>' }] }, 3);
  assert.deepEqual([...d.keys()], [1, 2]);
  assert.equal(d.get(2)!.entry, 'cut');
});

test('scene words: the scene must show its own words; a few labels allowed', () => {
  assert.deepEqual(sceneWordProblems('Forty guests. Forty phones. LIVE', 'Forty guests. Forty phones.', FACTS), []);
  assert.match(sceneWordProblems('Forty', 'Forty guests. Forty phones. One album somewhere.', FACTS).join(), /missing/);
  assert.match(sceneWordProblems('Forty guests forty phones and also many other extra words here', 'Forty guests. Forty phones.', FACTS).join(), /aren't the scene's/);
});

test('design prompt: footage, last scene and fix notes are spelled out', () => {
  const reel: WrittenReel = { angle: 'a', audience: 'b', hook: 'h', scenes: [{ n: 1, seconds: 3, words: 'One', beat: 'pain', media: 'footage', query: 'wedding table', screen: 'library' }, { n: 2, seconds: 3, words: 'Try Lens free', beat: 'cta', media: 'none', query: '', screen: 'library' }] };
  const p = reelDesignPrompt(reel, [], new Set([1]), { primary: '#2563EB', accent: '#FACC15' }, 'lens.instagrowapp.com', new Map([[2, ['words off screen']]]));
  assert.doesNotMatch(p, /Scene 1/); // only the scene to fix
  assert.match(p, /Scene 2 .*LAST: call to action/s);
  assert.match(p, /words off screen/);
  assert.match(reelDesignPrompt(reel, [], new Set([1]), { primary: '#2563EB', accent: '#FACC15' }, 'x'), /footage: yes/);
});
