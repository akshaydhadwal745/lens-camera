import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alignToCuts, bestStart, openverseTracks } from './growth-music';
import { mixReel, RATE, readCues, SOUNDS, synth, wav } from './growth-sound';
import { fitToVoice, stretchMarks, subChunks, voiceLineProblems, VOICE_MAX_SECONDS, withPunctuation } from './growth-voice';
import { designsByScene, readWrittenReel, reelDesignPrompt, reelSceneHtml, reelWordProblems, sceneWordProblems, type WrittenReel } from './growth-reel-ai';

const FACTS = 'Full-quality backup. 10 GB free forever. Lens Plus 50 GB for ₹59 a month. Event albums: a QR code guests open.';
const scene = (n: number, words: string, extra: Record<string, unknown> = {}) => ({ n, seconds: 3, words, beat: 'beat', media: 'phone', query: '', screen: 'library', vo: 'You know exactly how that feels.', ...extra }) as unknown as WrittenReel['scenes'][number];

test('writer: a good reel is kept and timed to the limit', () => {
  const r = readWrittenReel(
    { angle: 'Wedding photos scattered across guests', audience: 'couples', hook: 'Where are your wedding photos?', scenes: [scene(1, 'Where are your wedding photos?', { media: 'footage', query: 'wedding table' }), scene(2, 'Forty guests. Forty phones.', { seconds: 9 }), scene(3, 'One QR code on every table', { screen: 'qr-album' }), scene(4, 'Everyone adds. Full quality.', { media: 'footage', query: 'wedding dance floor', alt: 'wedding party' }), scene(5, '10 GB free forever. Try Lens free', { seconds: 5 })] },
    FACTS,
    'Try Lens free',
  );
  assert.deepEqual(r.problems, []);
  assert.equal(r.reel!.scenes.length, 5);
  assert.equal(r.reel!.scenes[1].seconds, 5); // clamped 2–5
  assert.equal(r.reel!.scenes[0].media, 'footage');
  assert.ok(r.reel!.scenes.reduce((a, s) => a + s.seconds, 0) <= 30);
  assert.equal(r.reel!.scenes[3].alt, 'wedding party');
});

test('writer: a reel needs the real moment, not an app tutorial', () => {
  const phones = readWrittenReel({ angle: '', audience: '', hook: '', scenes: [scene(1, 'a'), scene(2, 'b'), scene(3, 'c'), scene(4, 'd'), scene(5, 'e', { media: 'footage', query: 'school stage' })] }, FACTS, 'Try Lens free').problems.join(' | ');
  assert.match(phones, /only 1 scene of real footage/);
  assert.match(phones, /5 phone scenes|4 phone scenes/);
  const ok = readWrittenReel({ angle: '', audience: '', hook: '', scenes: [scene(1, 'a', { media: 'footage', query: 'school stage' }), scene(2, 'b'), scene(3, 'c', { media: 'none' }), scene(4, 'd', { media: 'photo', query: 'parents audience' })] }, FACTS, 'Try Lens free');
  assert.deepEqual(ok.problems, []);
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

test('sound: effects are made in code, cues are checked, the mix is stereo at 48 kHz', () => {
  for (const k of SOUNDS) {
    const s = synth(k);
    assert.ok(s.length > 0 && s.length < RATE * 1.5, k);
    assert.ok(s.reduce((a, v) => Math.max(a, Math.abs(v)), 0) <= 1.0001, k);
  }
  assert.deepEqual(readCues([{ t: 0.5, kind: 'pop' }, { t: 0.55, kind: 'tick' }, { t: 9, kind: 'pop' }, { t: 1, kind: 'boom' }], 3), [{ t: 0.5, kind: 'pop' }]);
  const m = mixReel(2, [{ t: 0.1, kind: 'impact' }]);
  assert.equal(m.length, 2 * RATE * 2);
  assert.ok(m.reduce((a, v) => Math.max(a, Math.abs(v)), 0) <= 1);
  const w = wav(m);
  assert.equal(w.toString('ascii', 0, 4), 'RIFF');
  assert.equal(w.readUInt32LE(24), 48000);
});

test('music: only free licences, instrumental-looking, 1–7 min; the loud stretch starts on a hit', () => {
  const r = (o: Record<string, unknown>) => ({ foreign_landing_url: 'https://www.jamendo.com/track/1', url: 'https://prod-1.storage.jamendo.com/?trackid=1', title: 'Upbeat Corporate', creator: 'A', license: 'by', license_version: '3.0', license_url: 'x', duration: 100000, genres: ['corporate'], tags: [], provider: 'jamendo', ...o });
  const got = openverseTracks({ results: [r({}), r({ license: 'by-nc' }), r({ title: 'My song feat. Ann' }), r({ duration: 20000 }), r({ title: 'Rain sound effects' }), r({ license: 'cc0', title: 'Morning' })] });
  assert.deepEqual(got.map((t) => t.license), ['CC BY 3.0', 'CC0']);
  const env = new Float32Array(400).fill(0.05);
  for (let i = 120; i < 400; i++) env[i] = 0.4; // quiet intro, then the song
  env[121] = 0.9; // a hit right after it starts
  const s = bestStart(env, 10);
  assert.ok(s >= 5.9 && s <= 6.2, String(s));
  assert.equal(bestStart(new Float32Array(10), 10), 0);
});

test('voice: human lines pass; ad-speak, read-outs of the screen and long lines are sent back', () => {
  assert.deepEqual(voiceLineProblems("Of course. Right as she walks on.", 'Storage full.'), []);
  assert.match(voiceLineProblems('Are you tired of a full phone?', 'Phone full').join(), /ad-speak/);
  assert.match(voiceLineProblems('Say goodbye to storage worries', 'x').join(), /ad-speak/);
  assert.match(voiceLineProblems('One album for the day with one QR code', 'One album for the day. One QR code.').join(), /repeats the on-screen words/);
  assert.match(voiceLineProblems('a b c d e f g h i j k l m n o p q r s t', 'x').join(), /18 at most/);
});

test('writer: the voiceover is checked like the words', () => {
  const base = [scene(1, 'Storage full.', { media: 'footage', query: 'school stage', vo: 'Right as she walks on stage.' }), scene(2, 'b', { vo: '' }), scene(3, 'c', { media: 'photo', query: 'parents audience', vo: "Forty parents. Forty galleries. You'll never see half." }), scene(4, 'Try Lens free', { vo: 'Sort it tonight. Try Lens free.' })];
  const ok = readWrittenReel({ angle: '', audience: '', hook: '', scenes: base }, FACTS, 'Try Lens free');
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.reel!.scenes[0].vo, 'Right as she walks on stage.');
  const silent = readWrittenReel({ angle: '', audience: '', hook: '', scenes: base.map((x) => ({ ...x, vo: '' })) }, FACTS, 'Try Lens free');
  assert.match(silent.problems.join(), /at least 3 scenes/);
  const claim = readWrittenReel({ angle: '', audience: '', hook: '', scenes: base.map((x, i) => (i === 1 ? { ...x, vo: 'Get 500 GB free, honestly.' } : x)) }, FACTS, 'Try Lens free');
  assert.match(claim.problems.join(), /voice: numbers/);
});

test('voice timing: scenes stretch to their lines, the reel stays under the limit, lines are never cut', () => {
  const sc = [1, 2, 3, 4].map((n) => ({ n, seconds: 3 }));
  assert.deepEqual(fitToVoice(sc, new Map([[1, 4], [3, 1]])), [4.6, 3, 3, 3]);
  const long = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, seconds: 5 }));
  const f = fitToVoice(long, new Map(long.map((s) => [s.n, 3.5])));
  assert.ok(f.reduce((a, b) => a + b, 0) <= VOICE_MAX_SECONDS + 0.05);
  for (const v of f) assert.ok(v >= 0.25 + 3.5 + 0.35 - 0.05);
});

test('mix: the voice sits on top and the music ducks under it', () => {
  const music = new Float32Array(2 * RATE * 2).fill(0.3);
  const voice = new Float32Array(Math.floor(0.5 * RATE)).fill(0);
  const m = mixReel(2, [], music, [{ at: 1, pcm: voice }]);
  const at = (t: number) => Math.abs(m[Math.floor(t * RATE) * 2]);
  assert.ok(at(1.2) < at(0.6) * 0.4, `${at(1.2)} vs ${at(0.6)}`);
});

test('subtitles: neural word times stretched to the generative clip; 3-word chunks broken at punctuation', () => {
  const marks = [{ w: "She's", t: 0.2 }, { w: 'practised', t: 0.4 }, { w: 'her', t: 0.9 }, { w: 'one', t: 1.0 }, { w: 'line.', t: 1.2 }, { w: 'All', t: 1.8 }, { w: 'week', t: 2.0 }];
  const s = stretchMarks(marks, 2.5, 3);
  assert.equal(s[1].t, 0.48);
  const c = subChunks(s, 10, 3);
  assert.deepEqual(c.map((x) => x.words.map((w) => w.w).join(' ')), ["She's practised her", 'one line.', 'All week']);
  assert.equal(c[0].t0, 10.24);
  assert.equal(c[0].t1, c[1].t0);
  assert.equal(c[2].t1, 13.15);
  assert.deepEqual(subChunks([], 0, 1), []);
});

test('beat cuts: the music slides (±1 s) so its hits land on the cuts', () => {
  const env = new Float32Array(400).fill(0.1);
  // Hits every 0.5 s from 5.3 s on.
  for (let t = 5.3; t < 20; t += 0.5) env[Math.round(t / 0.05)] = 0.9;
  const from = alignToCuts(env, 5, [1.0, 2.5, 4.0]);
  for (const c of [1.0, 2.5, 4.0]) {
    const at = from + c;
    assert.ok(Math.abs(((at - 5.3) / 0.5) - Math.round((at - 5.3) / 0.5)) < 0.15, `cut at ${at}`);
  }
  assert.equal(alignToCuts(env, 5, []), 5);
});

test('subtitles: punctuation the word marks dropped comes back from the text', () => {
  const t = "Open the browser. Nobody's begging, right?";
  assert.equal(withPunctuation(t, 'browser', 16), 'browser.');
  assert.equal(withPunctuation(t, "Nobody's", 26), "Nobody's");
  assert.equal(withPunctuation(t, 'begging', 34), 'begging,');
  assert.equal(withPunctuation(t, 'right', 41), 'right?');
  assert.equal(withPunctuation(t, 'x'), 'x');
});
