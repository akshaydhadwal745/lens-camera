// AI-written, AI-designed reels (docs/growth/content-engine.md, phase 4; owner 2026-11-10: "it should be dynamic
// from Claude… engaging, targeting pain points, not generic, cool"). Two Claude passes per reel:
//   1. the WRITER (creative director) finds the pain point, writes the hook and every scene's on-screen words and
//      says what each scene shows (real footage, a photo, the app on a phone, or type only);
//   2. the DESIGNER (motion designer) designs every scene as HTML + CSS with its own @keyframes, from the same
//      kit of real parts as the image designer plus this scene's footage and a QR card.
// Code decides what ships: the words are checked against product-facts (no feature we don't have, no number we
// didn't say, no forbidden claim), the HTML is cleaned (no scripts, no network), every scene is drawn at several
// moments and checked (text in the safe zone, readable, not over the phone or other text), failing scenes get one
// fix round and otherwise fall back to a template scene (growth-reel.ts). Rendering stays frame-accurate: the
// page pauses every CSS animation and sets its time for each frame (no animation runs on its own clock).
// This file is pure; the job is in growth-video.ts.
import { expandKit, sanitizeDesign, wordProblems as designWordProblems, type KitPhoto } from './growth-ai-design';
import { SCREENS, type Screen } from './growth-design';
import { FORBIDDEN_CLAIMS } from './growth-report';
import { MAX_SECONDS } from './growth-reel';
import { readCues, SOUNDS, type Cue } from './growth-sound';
import { voiceLineProblems } from './growth-voice';

export type Media = 'footage' | 'photo' | 'phone' | 'none';
export type WrittenScene = { n: number; seconds: number; words: string; beat: string; media: Media; query: string; alt?: string; screen: Screen; vo?: string };
export const MOODS = ['upbeat', 'chill', 'emotional', 'energetic', 'warm'] as const;
export type Mood = (typeof MOODS)[number];
export type WrittenReel = { angle: string; audience: string; hook: string; mood?: Mood; scenes: WrittenScene[] };
export type SceneDesign = { n: number; idea: string; entry: Entry; html: string; sounds?: Cue[] };
export const ENTRIES = ['cut', 'whip', 'slide', 'fade', 'circle', 'wipe'] as const;
export type Entry = (typeof ENTRIES)[number];

// ---------- 1. the writer ----------

export const REEL_WRITER_SYSTEM = `You are the creative director of short vertical videos (Instagram Reels, Facebook Reels, X) for Lens, a camera and photo-backup app (lens.instagrowapp.com). You turn one post idea into a 15–30 second reel that real people stop for, watch to the end, and send to a friend. Generic brand videos fail; specific, felt moments win.

How you work:
1. Find the ONE sharpest pain point this post touches: a real moment from the viewer's life, said the way they would say it. Examples of the level of specificity: "Storage full" popping up in the middle of the best moment of a concert; a wedding's photos scattered across forty guests' WhatsApps; the only good group photo arriving blurry in the chat; a parent's phone too full to take one more video of the baby. Name who feels it (audience).
   Make them FEEL it before you sell anything: the viewer must see the moment itself (the child on the stage, the friends at the concert, the wedding table at night) and recognise their own life in it. A reel of app screens is a tutorial; nobody shares a tutorial.
2. Hook (scene 1, under 2 seconds): the pain in the viewer's own words: a punchy line or question that makes them think "that's me". No brand name, no "Introducing", no "Did you know".
3. One beat per scene, in this arc: the real moment and its pain (real footage) → the twist (it doesn't have to be this way) → Lens doing it (show the product proving it, briefly) → the payoff feeling (back in the real moment: the memory kept, everyone's photos together) → the call to action.
4. On-screen words: short and spoken, at most 8 words per scene (the last scene at most 10). Specific, never generic ("Your camera roll, finally safe" not "Manage your storage"). No hashtags, no emoji, no corporate words (seamless, effortless, revolutionary, solution, unlock, elevate, game-changer, next level).

Truth (checked in code; a reel that breaks it is thrown away):
- Show and say only what is in the product facts' Features. Never anything under "Not available".
- Numbers and prices only exactly as written in the facts or the post.
- Never "unlimited", "best", "#1", "shot on Lens".

For each scene choose what it shows:
- footage: real stock video of the moment. People are welcome the way a film editor uses b-roll: an audience, a crowd, people from behind or at a distance, hands holding phones up, kids on a stage seen from the audience. Never someone posing for the camera, never a close-up of a child, never a phone brand, and never a stranger shown as a Lens user. Give query: 2–4 plain, concrete words a stock site would tag the clip with ("school stage performance", "parents audience clapping", "concert crowd phones", "wedding dance floor"), never abstract words ("memories", "storage", "QR code scanning"). alt: a second, broader search (2–3 words) used if the first finds nothing good.
- photo: one still photo; same rules for query and alt.
- phone: the real Lens app on a phone proving the point; choose screen. Screens: library = the photo roll; backup = backup progress; free-space = space freed after backup; storage-full = a full phone (the problem); viewer = one photo open in Lens with a green Safe pill; qr-album = an event album with a QR code guests scan; camera = the Lens camera with Night mode.
- none: type, colour and shapes only (good for a punchy line).
Use the phone in 1 or 2 scenes (3 at most): enough to prove the product, not a tutorial. At least 2 scenes are footage or photo of the real moment, usually the hook and the payoff. Vary what the scenes show. The last scene is the call to action and uses the given CTA words.
Scene lengths: 2 to 5 seconds (enough to read the words twice), total 15 to ${MAX_SECONDS} seconds, 4 to 8 scenes.
Voiceover (vo, per scene): a warm narrator talks over the reel, like a friend telling you something true over chai, not an ad. It carries the story; the on-screen words are only the key phrase.
- Sound human: contractions (you've, it's, don't), short sentences, a breath between thoughts, one specific real detail ("the front row", "the second verse", "Nani's phone"). Say it the way people actually talk. Read it out loud in your head: if it sounds like a commercial, rewrite it.
- Never read the on-screen words out loud. The voice says the feeling or the detail around them (screen "Storage full." → voice "Of course. Right as she walks on.").
- No ad-speak: never "Are you tired of", "Say goodbye to", "Introducing", "Look no further", "Meet Lens", "game-changer", "don't miss out". No questions that sound like a sales pitch.
- 3 to 14 words per scene (18 at most); a scene may be silent (empty vo) when the picture says it all. The hook's line is short and lands in the first second. The last scene's line says the call to action in a natural way.
- The same truth rules as the words on screen.
- Make it loop: the last line can lead straight back into the first (scene 1 "She's practised her one line all week." … last "So this time, you just watch her."), so a viewer who keeps watching hears one story.
mood: the music under it: upbeat (bright pop), chill (lo-fi, relaxed), emotional (piano, heartfelt), energetic (driving electronic), warm (acoustic, friendly).`;

export const REEL_WRITER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['angle', 'audience', 'hook', 'mood', 'scenes'],
  properties: {
    mood: { type: 'string', enum: MOODS },
    angle: { type: 'string', description: 'the pain point and the twist, one sentence' },
    audience: { type: 'string' },
    hook: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'seconds', 'words', 'beat', 'media', 'query', 'alt', 'screen', 'vo'],
        properties: { n: { type: 'integer' }, seconds: { type: 'number' }, words: { type: 'string' }, beat: { type: 'string' }, media: { type: 'string', enum: ['footage', 'photo', 'phone', 'none'] }, query: { type: 'string' }, alt: { type: 'string' }, vo: { type: 'string', description: 'the spoken line over this scene, or empty for silence' }, screen: { type: 'string', enum: SCREENS } },
      },
    },
  },
} as const;

export const writerPrompt = (brief: string, script: string[], facts: string, cta: string, voice: string) =>
  `The post (written by our content agent; its idea is approved, your words may be sharper):
${brief}
${script.length ? `Its draft script:\n${script.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n` : ''}
Call to action words for the last scene: "${cta}"
Brand voice: ${voice || 'confident, warm, plain English'}

Product facts (the only claims allowed):
${facts || '(not available: show only backup in full quality, freeing phone space, event albums with a QR code, and sharing links)'}`;

const NOT_AVAILABLE = /\b(unlimited|iphone app|ios app|app store|desktop app|mac app|windows app|ai search|ai edit\w*|video calls?|chat feature)\b/i;
const CORPORATE = /\b(seamless(ly)?|effortless(ly)?|revolutionary|game[- ]changer|next[- ]level|unlock|elevate)\b/i;

/** Problems with words a reel would show (any scene): claims we never make, numbers from nowhere, emoji, filler. */
export function reelWordProblems(words: string, allowed: string): string[] {
  const out: string[] = [];
  const nums = (t: string) => new Set((t.match(/₹?\d[\d,.]*\s*(?:gb|%|x)?/gi) ?? []).map((n) => n.toLowerCase().replace(/[,\s]/g, '')));
  const ok = nums(allowed);
  const bad = [...nums(words)].filter((n) => !ok.has(n) && !ok.has(n.replace(/gb$/, '')));
  if (bad.length) out.push(`numbers that aren't in the post or the product facts: ${bad.slice(0, 4).join(', ')}`);
  if (FORBIDDEN_CLAIMS.test(words) || /\b(best|number one|shot on lens)\b|#1\b/i.test(words)) out.push('a claim we never make (unlimited, best, #1, shot on Lens)');
  const na = NOT_AVAILABLE.exec(words);
  if (na) out.push(`a feature Lens doesn't have: "${na[0]}"`);
  const corp = CORPORATE.exec(words);
  if (corp) out.push(`corporate filler: "${corp[0]}"`);
  if (/\p{Extended_Pictographic}/u.test(words)) out.push('emoji (the font can’t draw them)');
  if (/#\w/.test(words)) out.push('hashtags on screen');
  return out;
}

/** The writer's reel, checked and timed; undefined when it can't be used (then the post's own script is used). */
export function readWrittenReel(r: Partial<WrittenReel> | undefined, allowed: string, cta: string): { reel?: WrittenReel; problems: string[] } {
  const scenes = (r?.scenes ?? []).slice(0, 8).map((s, i) => ({
    n: i + 1,
    seconds: Math.max(2, Math.min(5, Number(s.seconds) || 3)),
    words: String(s.words ?? '').replace(/\s+/g, ' ').trim().slice(0, 90),
    beat: String(s.beat ?? '').slice(0, 160),
    media: (['footage', 'photo', 'phone', 'none'] as const).includes(s.media as Media) ? (s.media as Media) : 'none',
    query: String(s.query ?? '').replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 50),
    alt: String(s.alt ?? '').replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 40),
    screen: (SCREENS as readonly string[]).includes(String(s.screen)) ? (s.screen as Screen) : 'library',
  }));
  const problems: string[] = [];
  if (scenes.length < 4) problems.push('fewer than 4 scenes');
  if (scenes.some((s) => !s.words)) problems.push('a scene without words');
  const long = scenes.filter((s, i) => s.words.split(/\s+/).length > (i === scenes.length - 1 ? 10 : 8));
  if (long.length) problems.push(`too many words in scene ${long.map((s) => s.n).join(', ')} (8 max, 10 on the last)`);
  // A real moment, not an app tutorial (owner 2026-11-10: "no images, no emotional connection").
  const real = scenes.filter((s) => s.media === 'footage' || s.media === 'photo').length;
  if (scenes.length >= 4 && real < 2) problems.push(`only ${real} scene${real === 1 ? '' : 's'} of real footage or photo (at least 2: the moment itself, usually the hook and the payoff)`);
  const phones = scenes.filter((s) => s.media === 'phone').length;
  if (phones > 3) problems.push(`${phones} phone scenes (3 at most: it's a story, not a tutorial)`);
  // The voiceover: human, not a read-out of the screen (owner 2026-11-11).
  const vos = (r?.scenes ?? []).slice(0, 8).map((x) => String((x as WrittenScene)?.vo ?? '').replace(/\s+/g, ' ').trim().slice(0, 160));
  scenes.forEach((sc, i) => {
    (sc as WrittenScene).vo = vos[i] ?? '';
    for (const p of voiceLineProblems(vos[i] ?? '', sc.words)) problems.push(`scene ${sc.n} voice: ${p}`);
  });
  if (vos.filter(Boolean).length < Math.min(3, scenes.length)) problems.push('the voiceover needs a line in at least 3 scenes');
  problems.push(...reelWordProblems(vos.filter(Boolean).join(' / '), `${allowed} ${cta}`).map((p) => `voice: ${p}`));
  problems.push(...reelWordProblems(scenes.map((s) => s.words).join(' / ') + ` ${r?.hook ?? ''}`, `${allowed} ${cta}`));
  if (problems.length) return { problems };
  // Fit the total into the reel's limit, keeping every scene readable.
  const total = scenes.reduce((a, s) => a + s.seconds, 0);
  const k = total > MAX_SECONDS ? MAX_SECONDS / total : 1;
  for (const s of scenes) s.seconds = Math.max(2, Math.floor(s.seconds * k * 10) / 10);
  return { reel: { mood: (MOODS as readonly string[]).includes(String(r?.mood)) ? (r!.mood as Mood) : 'upbeat', angle: String(r?.angle ?? '').slice(0, 300), audience: String(r?.audience ?? '').slice(0, 160), hook: String(r?.hook ?? scenes[0].words).slice(0, 120), scenes }, problems: [] };
}

// ---------- 2. the designer ----------

export const REEL_DESIGN_SYSTEM = `You are a senior motion designer at a top studio (think Apple product films, Nothing, Linear launch videos), designing the scenes of one vertical reel for Lens, a camera and photo-backup app. The bar: bold, modern, kinetic and premium, a reel people watch twice. Never a template look, never "words on a background", never clip-art.

Every scene is HTML + CSS on a 1080×1920 canvas (position:absolute, px), animated ONLY with CSS @keyframes and the animation property. Time 0 is the start of the scene; all motion must happen within the scene's seconds. Use animation-fill-mode both (or the "both" keyword) so every element shows its first keyframe before it starts. Name keyframes with the scene's prefix (s1-…, s2-…) so scenes never clash. Ease with cubic-bezier for snappy, physical motion (e.g. cubic-bezier(.2,.9,.2,1) for arrivals, overshoot cubic-bezier(.3,1.6,.5,1) for pops). No transitions, no JavaScript.

Kit of REAL parts (use them instead of drawing your own):
- <lens-phone screen="SCREEN" x="" y="" scale="" rotate="" photo="" title=""></lens-phone> the real Lens app on a phone. 418×872 px at scale 1; x,y = top-left corner. SCREENS: library, backup, free-space, storage-full, viewer, qr-album, camera (see the scene list). title = the event album's name on qr-album (2–4 words, e.g. "Riya & Kabir's wedding"). To animate it, wrap it in your own <div> and animate the div.
- <lens-photo src="pN" x="" y="" w="" h="" radius="" rotate="" border=""></lens-photo> a checked photo cropped to fill w×h; url(photo:pN) also works as a background-image in your CSS.
- <lens-footage x="" y="" w="" h="" radius=""></lens-footage> THIS scene's real video clip, cropped to fill (only in scenes that list footage). Full-bleed: x=0 y=0 w=1080 h=1920.
- <lens-qr-card x="" y="" w="" title=""></lens-qr-card> a printed event-album QR card (white card, title, QR, "Scan to add your photos"); about 0.73×w tall.
- <lens-icon x="" y="" size=""></lens-icon> the Lens app icon. REQUIRED in the last scene (size ≥ 120).
- <lens-check size=""></lens-check> a green tick in a circle.
Fonts: font-family:Geist (300–800) for all words; font-family:Plex (mono 500/600) only for small uppercase labels. Colours: --blue, --yellow, --green #30D158, --red #FF453A, --ink #0d0f14, --paper #f4f4f6. You may draw your own inline <svg> shapes (arrows, underlines, circles, bursts, progress rings) and use any CSS (gradients, blur, clip-path masks, mix-blend-mode, 3D transforms with perspective). Not allowed: <script>, event handlers, <img>/<video>/<iframe>, external URLs, @import, other fonts, emoji.

Never draw illustrations: no people, faces, hands, fingers, bodies, children, animals, or drawn objects (lamps, bags, stages, curtains, furniture, food). Clip-art and cartoon figures look cheap. Drawn shapes are only abstract: lines, arrows, underlines, rings, bursts, light, glows, grids. When a scene has no footage or photo, make it type-led: big bold words, colour and light, and the real product parts from the kit.

Truth in pictures: <lens-phone> is the Lens app on the owner's or host's phone. Guests of an event album never have Lens: when a guest scans or adds photos, show THEIR phone with its own camera or browser, drawn by you as a plain phone outline with no hand (a viewfinder with the QR card in it, or a simple browser page "Add your photos"), never a <lens-phone> screen. "Every guest's photos in one album" is the qr-album screen (the event album), not the library.

Words: show the scene's words exactly (you may split them into lines and animate word by word or line by line, colour or underline the key words). You may add at most 3 small label words of your own per scene (e.g. BEFORE, AFTER, LIVE). Nothing else in text.

Craft rules (checked in code; scenes that fail are redesigned or replaced):
- All words inside x 72–1008 and y 220–1320. Keep y 1320–1520 free of words: the voiceover's subtitles are drawn there for you (below that the platforms' buttons cover it). Phones, photos and footage may bleed off the edges.
- Main words at least 84px, weight 700–800, letter-spacing about −0.045em, line-height ~1. Labels at least 34px.
- Contrast: words on footage or photos need a dark scrim (linear-gradient) or a solid pill/card behind them; --yellow only on dark backgrounds; on light backgrounds use --ink and --blue.
- Words never over or under the phone or other words (keep 32px apart), at any moment.
- The words must be readable for most of the scene: get them in within the first 0.8 s and keep them still at least 60% of the scene.
- One focal point per scene. The phone, when shown, is big (scale ≥ 1.0) and fully readable, not a tiny thumbnail.
- Vary layout, colour and motion from scene to scene; dark and light scenes may alternate. Scene 1 must stop the scroll within half a second (a strong move, a punch-in, a striking image).
- Footage and photos of the real moment are the heart of the reel: give them the full frame, put the words in a block above or below the subject (with a scrim), never a small framed thumbnail of the moment.
- Loop: the last scene ends on scene 1's look (its footage or photo, or its colours, behind the call to action in the final second), so when the reel starts again it flows on without a jump.
- Keep life in long holds: slow push-ins (scale 1 → 1.08) on footage and photos, gentle float on phones.

entry: how the scene comes in over the previous one: cut, whip (fast vertical push with blur), slide, fade, circle (circular reveal), wipe. Use "cut" or "whip" for energy; don't use the same entry three times in a row.

Sound: for each scene list sounds: the effects that land on your motion, at the second (scene time) where the motion hits. Kinds: whoosh (something sweeps or whips across), whoosh-up (a rise or reveal), swipe (a quick slide), pop (something lands or springs in: a phone, a card, a bubble), tick (a check or small confirmation), click (a tap or a button), shutter (a photo is taken), impact (a big word slams in or the final call to action), riser (tension building into the next scene, put it 1.2 s before the scene ends), chime (success: everything is in the album). 1 to 4 per scene, never two within 0.15 s; the scene's own entry whoosh is added for you. Less is more: sound only the moves that matter.

For each scene return n, idea (one line), entry, sounds, and html (markup inside the scene's canvas; it may start with one <style> block).`;

export const REEL_DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scenes'],
  properties: {
    scenes: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['n', 'idea', 'entry', 'sounds', 'html'], properties: { n: { type: 'integer' }, idea: { type: 'string' }, entry: { type: 'string', enum: ENTRIES }, sounds: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['t', 'kind'], properties: { t: { type: 'number' }, kind: { type: 'string', enum: SOUNDS } } } }, html: { type: 'string' } } },
    },
  },
} as const;

const LEAD_S = 0.25;

export function reelDesignPrompt(reel: WrittenReel, photos: KitPhoto[], footage: Set<number>, brand: { primary: string; accent: string }, site: string, fix?: Map<number, string[]>): string {
  const todo = reel.scenes.filter((s) => !fix || fix.has(s.n));
  const scenes = todo.map((s) => {
    const last = s.n === reel.scenes.length;
    const has = footage.has(s.n) ? 'footage: yes (<lens-footage>)' : 'footage: none';
    const problems = fix?.get(s.n);
    return `Scene ${s.n} · ${s.seconds} s · beat: ${s.beat}\n  words: "${s.words}"\n${s.vo ? `  the voice says (from ${LEAD_S} s): "${s.vo}" (time the motion to it)\n` : ''}  shows: ${s.media}${s.media === 'phone' ? ` (screen ${s.screen})` : ''}${s.media === 'photo' || s.media === 'footage' ? ` (${s.query})` : ''} · ${has}${last ? ` · LAST: call to action; include <lens-icon> and the site ${site}` : ''}${problems ? `\n  YOUR LAST DESIGN OF THIS SCENE HAD THESE PROBLEMS, fix them: ${problems.join('; ')}` : ''}`;
  });
  const ph = photos.map((p) => `- ${p.ref}: ${p.about.slice(0, 90)} (${p.w}×${p.h})`);
  return `${fix ? 'Redesign only these scenes' : 'Design every scene'} of this reel.
The angle: ${reel.angle}
For: ${reel.audience}
Brand colours: primary ${brand.primary}, accent ${brand.accent}.

${scenes.join('\n\n')}

Photos you may use (checked: they fit this post; use one where it helps the beat, never to fill space):
${ph.join('\n') || '- none'}`;
}

/** Claude's scene designs by scene number (unknown numbers and oversized HTML dropped). */
export function designsByScene(r: { scenes?: Partial<SceneDesign>[] } | undefined, count: number, seconds: (n: number) => number = () => 30): Map<number, SceneDesign> {
  const out = new Map<number, SceneDesign>();
  for (const d of r?.scenes ?? []) {
    const n = Number(d.n);
    if (!Number.isInteger(n) || n < 1 || n > count || typeof d.html !== 'string' || d.html.length > 80_000) continue;
    out.set(n, { n, idea: String(d.idea ?? '').slice(0, 200), entry: (ENTRIES as readonly string[]).includes(String(d.entry)) ? (d.entry as Entry) : 'cut', html: d.html, sounds: readCues(d.sounds, seconds(n)) });
  }
  return out;
}

const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([a-zA-Z][\w-]*)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
const num = (v: string | undefined, d: number, min = -5000, max = 5000) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};
const escAttr = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * A scene's HTML, safe and expanded: kit tags become real markup; this scene's footage becomes an <img> the page
 * steps frame by frame (data-clip), or the brand glow when the scene has no clip.
 */
export function reelSceneHtml(html: string, d: { photos: KitPhoto[]; pool: string[]; icon: string; clip?: { dir: string; frames: number }; still?: string; qr: string; brandDark: string }): string {
  const safe = sanitizeDesign(html)
    .replace(/<lens-footage\b([^>]*)>(?:\s*<\/lens-footage>)?/gi, (_, a: string) => {
      const x = attrs(a);
      const box = `position:absolute;left:${num(x.x, 0)}px;top:${num(x.y, 0)}px;width:${num(x.w, 1080, 10, 4000)}px;height:${num(x.h, 1920, 10, 4000)}px;border-radius:${num(x.radius, 0, 0, 2000)}px;overflow:hidden`;
      if (d.clip) return `<div class="kit-footage" style="${box}"><img data-clip="${escAttr(d.clip.dir)}" data-n="${d.clip.frames}" style="width:100%;height:100%;object-fit:cover"></div>`;
      if (d.still) return `<div class="kit-footage" style="${box}"><img src="${escAttr(d.still)}" style="width:100%;height:100%;object-fit:cover"></div>`;
      return `<div class="kit-footage" style="${box};background:${d.brandDark}"></div>`;
    })
    .replace(/<lens-qr-card\b([^>]*)>(?:\s*<\/lens-qr-card>)?/gi, (_, a: string) => {
      const x = attrs(a);
      const w = num(x.w, 520, 200, 900);
      const k = w / 560;
      const title = escAttr((x.title || 'Our big day').slice(0, 40));
      return `<div class="kit-qr" style="position:absolute;left:${num(x.x, 260)}px;top:${num(x.y, 600)}px;width:560px;transform:scale(${k.toFixed(3)});transform-origin:0 0;background:#fff;border-radius:34px;box-shadow:0 60px 90px -20px rgba(0,0,0,.6);padding:44px;text-align:center;color:#0d0f14;font-family:Geist"><div style="font:600 22px Plex;letter-spacing:.1em;color:#6b7280">EVENT ALBUM</div><div style="font-size:50px;font-weight:800;letter-spacing:-.03em;margin:10px 0 26px">${title}</div><div style="width:400px;height:400px;margin:0 auto">${d.qr}</div><div style="font-size:26px;font-weight:600;margin-top:28px;color:#374151">Scan to add your photos</div></div>`;
    })
  return expandKit(safe, d.photos, d.icon, d.pool);
}

// ---------- checks ----------

/**
 * Runs in the reel page for scene i at the moment the page was seeked to: words in the safe zone, readable,
 * clear of the phone and of other words; the icon on the last scene. Returns problems and the visible words.
 */
export const reelSceneCheck = (i: number, last: boolean, settled = true) => `(() => {
  const settled = ${settled};
  const root = document.getElementById('s${i}');
  const rr = root.getBoundingClientRect();
  const k = rr.width / 1080;
  const problems = [];
  const phones = [...root.querySelectorAll('.phone')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 40);
  const lines = [], words = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim();
    const el = n.parentElement;
    if (!t || !el || el.closest('.phone') || el.closest('.kit-qr') || el.closest('style') || el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let op = 1; for (let e = el; e && e !== root.parentElement; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if (op < 0.2) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const boxes = [...r.getClientRects()].filter((b) => b.width > 2 && b.height > 2 && b.right > rr.left && b.left < rr.right && b.bottom > rr.top && b.top < rr.bottom);
    if (!boxes.length) continue;
    words.push(t);
    if (parseFloat(cs.fontSize) < 34 && boxes[0].height < 34 * k) problems.push('words "' + t.slice(0, 30) + '" are too small (at least 34px; main words 84px)');
    for (const b of boxes) {
      lines.push({ b, el, t });
      const x0 = (b.left - rr.left) / k, x1 = (b.right - rr.left) / k, y0 = (b.top - rr.top) / k, y1 = (b.bottom - rr.top) / k;
      if (x0 < 60 || x1 > 1020 || y0 < 200 || y1 > 1330) problems.push('words "' + t.slice(0, 30) + '" are outside the safe area (x 72–1008, y 220–1320; the subtitles use 1320–1520)');
      for (const p of phones) {
        const ix = Math.min(b.right, p.right) - Math.max(b.left, p.left), iy = Math.min(b.bottom, p.bottom) - Math.max(b.top, p.top);
        if (ix > 6 * k && iy > 6 * k) problems.push('words "' + t.slice(0, 30) + '" overlap the phone');
      }
    }
  }
  for (let a = 0; a < lines.length; a++) for (let c = a + 1; c < lines.length; c++) {
    const A = lines[a], C = lines[c];
    if (A.el === C.el || A.el.contains(C.el) || C.el.contains(A.el)) continue;
    const ix = Math.min(A.b.right, C.b.right) - Math.max(A.b.left, C.b.left), iy = Math.min(A.b.bottom, C.b.bottom) - Math.max(A.b.top, C.b.top);
    // Lines of one headline touch a little with a tight line-height; only a real overlap (a quarter of the line) counts.
    if (ix > 0.25 * Math.min(A.b.width, C.b.width) && iy > 0.25 * Math.min(A.b.height, C.b.height)) problems.push('words "' + A.t.slice(0, 20) + '" overlap "' + C.t.slice(0, 20) + '"');
  }
  // The drawn size: font-size times any scale the element is shown at.
  const drawn = (el) => { const r = el.getBoundingClientRect(); const sc = el.offsetWidth ? r.width / el.offsetWidth : 1; return parseFloat(getComputedStyle(el).fontSize) * sc / k; };
  const biggest = Math.max(0, ...lines.map((l) => drawn(l.el)));
  if (settled && lines.length && biggest < 80) problems.push('the main words are too small (' + Math.round(biggest) + 'px; make the main words at least 84px)');
  if (settled) for (const p of phones) if (p.width / k < 380 && p.right > rr.left + 40 && p.left < rr.right - 40) problems.push('the phone is too small to read (' + Math.round(p.width / k) + 'px wide; use scale 1.0 or more)');
  ${last ? `const ic = root.querySelector('.lens-icon'); const ib = ic && ic.getBoundingClientRect(); if (!ib || ib.width < 100 * k) problems.push('the Lens icon is missing or smaller than 120px on the last scene');` : ''}
  return { problems: [...new Set(problems)].slice(0, 8), text: words.join(' ') };
})()`;

/** Words seen in a designed scene vs the words it should show (plus up to 3 labels). */
export function sceneWordProblems(seen: string, words: string, allowed: string): string[] {
  const out = designWordProblems(seen, `${words} lens instagrowapp com ${allowed}`).filter((p) => !p.startsWith('too many words'));
  const norm = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((w) => w.replace(/s$/, ''));
  const want = new Set(norm(`${words} lens instagrowapp com`));
  const extra = [...new Set(norm(seen).filter((w) => !want.has(w)))];
  if (extra.length > 3) out.push(`words that aren't the scene's: ${extra.slice(0, 6).join(', ')} (show the scene's words, at most 3 labels)`);
  const have = new Set(norm(seen));
  const missing = [...want].filter((w) => w.length > 2 && !['lens', 'instagrowapp', 'com'].includes(w) && !have.has(w));
  if (missing.length > Math.max(1, Math.floor(want.size / 4))) out.push(`the scene's words are missing or unreadable at this moment: ${missing.slice(0, 5).join(', ')}`);
  return out;
}

export { escAttr };
