// Reels (docs/growth/content-engine.md, phase 4; owner-approved look 2026-11-04): professional motion design,
// not images in a row. A reel is a list of scenes from a small library (real footage with kinetic type, the Lens
// phone, the QR card landing on a table, guests scanning, photos flying into an album, chat copy vs original, an
// end card). The words and timing are the post's own script; Claude only directs (which scene, which footage).
// This file is pure: the plan, and the page that draws any moment of the reel when told to seek(t). The job in
// growth-video.ts steps through it frame by frame in headless Chromium and encodes with ffmpeg.
// Text stays inside the area Reels, Facebook and X leave free of their own buttons (x 72–952, y 240–1500).
import { bg, css, esc, phone, qrPattern, screenHtml, SCREENS, TICK, type Screen } from './growth-design';

export const FPS = 30;
export const MAX_SECONDS = 30;
export const SCENE_TYPES = ['footage', 'phone', 'album', 'qr-card', 'scan', 'fill', 'compare', 'end'] as const;
export type SceneType = (typeof SCENE_TYPES)[number];
export type ReelScene = { type: SceneType; seconds: number; text: string; query?: string; screen: Screen; ai?: { html: string; entry: string } };
type ScriptLine = { seconds?: number; onScreen?: string; visual?: string };

const EVENT = /wedding|event album|guest|qr\b|party|reception|album/i;
const EVENT_ONLY: SceneType[] = ['album', 'qr-card', 'scan', 'fill'];
const NEEDS_FOOTAGE: SceneType[] = ['footage', 'qr-card', 'scan'];

const screenWords: [RegExp, Screen][] = [
  [/storage[ -]?full|out of (space|storage)|phone (is )?full/i, 'storage-full'],
  [/free[ -]?(up )?space|free up|delete/i, 'free-space'],
  [/qr|event album/i, 'qr-album'],
  [/night|camera|shoot|shutter/i, 'camera'],
  [/back(ed|ing)? ?up|safe|cloud/i, 'backup'],
  [/viewer|open (a|one|the) photo/i, 'viewer'],
];
const screenOf = (text: string): Screen => screenWords.find(([re]) => re.test(text))?.[1] ?? 'library';

/** The scene that suits a script line, by its words (used when Claude can't direct). */
function sceneFor(line: ScriptLine, event: boolean): SceneType {
  const t = `${line.onScreen ?? ''} ${line.visual ?? ''}`;
  if (event) {
    if (/\bscan/i.test(line.onScreen ?? '')) return 'scan';
    if (/print|tables?\b|qr card/i.test(line.onScreen ?? '')) return 'qr-card';
    if (/every guest|one album|arrive/i.test(t)) return 'fill';
    if (/(make|create|set up) (one|an?) .*album/i.test(line.onScreen ?? '')) return 'album';
  }
  if (/original|chat cop|compress|full quality/i.test(line.onScreen ?? '')) return 'compare';
  return 'phone';
}

/** Fit the script's seconds to the limit, with each scene long enough to read. */
function timing(lines: ScriptLine[]): number[] {
  const wanted = lines.map((l) => Math.max(2, Math.min(6, Number(l.seconds) || 3)));
  const total = wanted.reduce((a, b) => a + b, 0);
  const k = total > MAX_SECONDS ? MAX_SECONDS / total : 1;
  return wanted.map((s) => Math.floor(s * k * 10) / 10);
}

const scriptOf = (post: { hook?: string; script?: ScriptLine[] }, cta: string): ScriptLine[] => {
  const lines = (post.script ?? []).filter((l) => l.onScreen?.trim()).slice(0, 10);
  if (lines.length >= 2) return lines;
  return [{ seconds: 4, onScreen: post.hook || lines[0]?.onScreen || cta, visual: '' }, { seconds: 3, onScreen: cta, visual: '' }];
};

/** A plan from the words alone: real footage to open, the app in the middle, the end card last. */
export function defaultPlan(post: { hook?: string; script?: ScriptLine[] }, topic: string, cta: string): ReelScene[] {
  const lines = scriptOf(post, cta);
  const all = lines.map((l) => `${l.onScreen} ${l.visual}`).join(' ');
  const event = EVENT.test(all);
  const seconds = timing(lines);
  return lines.map((l, i) => {
    const type: SceneType = i === lines.length - 1 ? 'end' : i === 0 ? 'footage' : sceneFor(l, event);
    return { type, seconds: seconds[i], text: String(l.onScreen).trim(), screen: screenOf(`${l.onScreen} ${l.visual}`), ...(NEEDS_FOOTAGE.includes(type) || type === 'compare' ? { query: topic } : {}) };
  });
}

// ---------- Claude as director ----------

export const DIRECTOR_SYSTEM = `You are the director of short vertical videos for Lens, a camera and photo-backup app. You get a script of scenes with fixed words. For each scene choose how it is shown. You never write or change words.

Scene types:
- footage: real video filling the screen behind big moving type. For emotion and opening hooks.
- phone: the real Lens app on a phone on a bright background; choose the screen.
- album: a phone where an event album gets named, then its QR code appears. Only for "make an event album".
- qr-card: a printed QR card lands on real footage of a table. Only for printing or placing the code.
- scan: a second phone scans the card and adds photos in the browser. Only for guests scanning.
- fill: photos fly in from all sides and fill an album. Only for "everyone's photos in one album".
- compare: a slider between a blurry chat copy and the sharp original. Only for quality.
- end: the closing card with the logo. Always and only the last scene.

Screens for phone: ${SCREENS.join(', ')}.

For footage, qr-card, scan and compare give query: 2 to 4 English words for stock footage or a photo that clearly belongs with the scene and the post (scenery and objects, never people, never a brand). For other types give an empty query. Scene 1 should stop someone scrolling. Don't use the same type three times in a row. Show only what Lens really does according to the script.`;

export const DIRECTOR_SCHEMA = {
  type: 'object',
  properties: {
    scenes: {
      type: 'array',
      items: { type: 'object', properties: { n: { type: 'integer' }, type: { type: 'string', enum: SCENE_TYPES }, screen: { type: 'string', enum: SCREENS }, query: { type: 'string' } }, required: ['n', 'type', 'screen', 'query'], additionalProperties: false },
    },
  },
  required: ['scenes'],
  additionalProperties: false,
};

export const directorPrompt = (brief: string, plan: ReelScene[]) => `The post:\n${brief}\n\nThe script:\n${plan.map((s, i) => `${i + 1}. (${s.seconds} s) "${s.text}"`).join('\n')}`;

/** Claude's choices on top of the plan from the words; the words and timing never change, and the rules still hold. */
export function readPlan(report: { scenes?: { n: number; type: string; screen: string; query: string }[] } | undefined, plan: ReelScene[], topic: string): ReelScene[] {
  const event = EVENT.test(plan.map((s) => s.text).join(' ') + topic);
  return plan.map((s, i) => {
    const c = report?.scenes?.find((x) => x.n === i + 1);
    if (!c) return s;
    let type = (SCENE_TYPES as readonly string[]).includes(c.type) ? (c.type as SceneType) : s.type;
    if (i === plan.length - 1) type = 'end';
    else if (type === 'end' || (!event && EVENT_ONLY.includes(type))) type = s.type === 'end' ? 'phone' : s.type;
    const screen = (SCREENS as readonly string[]).includes(c.screen) ? (c.screen as Screen) : s.screen;
    const query = String(c.query ?? '').replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 60);
    const needs = NEEDS_FOOTAGE.includes(type) || type === 'compare';
    const { query: _old, ...rest } = s;
    return { ...rest, type, screen, ...(needs ? { query: query || topic } : {}) };
  });
}

// ---------- the page ----------

export type SceneMedia = { frames?: number; still?: string; hero?: string; heroChat?: string };
export type ReelPageData = { subs?: { t0: number; t1: number; words: { w: string; t: number }[] }[]; scenes: ReelScene[]; media: SceneMedia[]; pool: string[]; icon: string; fonts: { geist?: string; plex500?: string; plex600?: string }; cta: string; site: string; brand?: { primary: string; accent: string } };

const ARROW = '<svg viewBox="0 0 24 24" width=".8em" height=".8em" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-.04em"><path d="M4 12h16M13 5l7 7-7 7"/></svg>';
/** Geist has Latin letters, digits and punctuation: an arrow is drawn, anything else it can't show (emoji) is left out. */
export const reelWord = (w: string) => esc(w.replace(/[^\p{Script=Latin}\p{N}\p{P}\p{Sc}+=→]/gu, '')).replace(/→/g, ARROW);

/** Words as masked spans. Sentences come one after another; the last sentence (or the last two words) is the accent. */
export function kinetic(text: string, id: string, style: string, dark = false): string {
  const parts = text.trim().split(/(?<=[.?!:])\s+/);
  const accentFrom = parts.length > 1 ? parts.slice(0, -1).join(' ').split(/\s+/).length : Math.max(0, parts[0].split(/\s+/).length - 2);
  let delay = 0;
  let n = 0;
  const words = parts
    .map((part, p) => {
      if (p) delay += 0.55;
      return part
        .split(/\s+/)
        .map((w) => {
          const d = (delay += 0.07);
          return `<span class="w"><span class="i${n++ >= accentFrom ? ' y' : ''}" data-d="${d.toFixed(2)}">${reelWord(w)}</span></span>`;
        })
        .join(' ');
    })
    .join(' ');
  return `<div class="k${dark ? ' dark' : ''}" id="${id}" style="${style}">${words}</div>`;
}

export const textSize = (text: string) => (text.length <= 22 ? 132 : text.length <= 34 ? 116 : text.length <= 50 ? 100 : 84);

const statusBar = `<div class="sb"><span>9:41</span><span>5G</span></div>`;
const BRIGHT = [
  'radial-gradient(70% 50% at 85% 80%,#c7dcff 0%,transparent 60%),radial-gradient(60% 40% at 5% 95%,#ffe3c2 0%,transparent 60%),linear-gradient(160deg,#f7f5f2,#eef1f7)',
  'radial-gradient(70% 50% at 20% 85%,#ffe1ea 0%,transparent 60%),radial-gradient(60% 45% at 95% 20%,#dbe8ff 0%,transparent 60%),linear-gradient(170deg,#faf8f6,#eff2f8)',
  'radial-gradient(70% 55% at 20% 80%,#d4f5e2 0%,transparent 60%),radial-gradient(60% 50% at 90% 10%,#dbe8ff 0%,transparent 60%),linear-gradient(170deg,#f6faf8,#eef3f8)',
];

/** Dark brand glow for a scene whose footage and photos didn't fit the post (better than unrelated scenery). */
const BRAND_DARK = 'radial-gradient(60% 40% at 85% 20%,#2563eb 0%,transparent 70%),radial-gradient(60% 45% at 10% 85%,#7c3aed 0%,transparent 70%),#0b1020';

const footageLayer = (m: SceneMedia, id: string, extra = '') =>
  m.frames || m.still
    ? `<div class="layer" id="${id}" style="overflow:hidden;${extra}"><img id="${id}-v" class="layer" style="width:100%;height:100%;object-fit:cover" ${m.frames ? '' : `src="${esc(m.still ?? '')}"`}></div>`
    : `<div class="layer" id="${id}" style="background:${BRAND_DARK};${extra}"></div>`;

const footageRun = (i: number, m: SceneMedia, x = 'v-v') => (m.frames ? `await frame($('${x}'),'f/${i}',Math.min(${m.frames},Math.round(lt*30)+1));` : '');


/** One scene's markup and the code that draws it at local time lt. `s` is a fixed clock, so timing scales with the scene's length. */
function scene(sc: ReelScene, i: number, d: ReelPageData): { html: string; run: string; entry: string } {
  // Designed by Claude (growth-reel-ai.ts): its own markup and CSS animations, stepped by the page's clock.
  if (sc.ai) return { entry: sc.ai.entry, html: `<div class="ai">${sc.ai.html}</div>`, run: `await ai(${i},lt);` };
  const id = (x: string) => `s${i}-${x}`;
  const m = d.media[i] ?? {};
  const qr = qrPattern(7);
  const size = textSize(sc.text);
  const pool = d.pool;
  const pick = (n: number) => (pool.length ? pool[n % pool.length] : undefined);
  switch (sc.type) {
    case 'footage':
      return {
        entry: i ? 'whip' : 'none',
        html: `${footageLayer(m, id('v'), 'transform-origin:50% 45%')}<div class="layer" style="background:linear-gradient(180deg,rgba(0,0,0,.72) 0%,rgba(0,0,0,.15) 55%,rgba(0,0,0,.5) 100%)"></div>${kinetic(sc.text, id('t'), `top:290px;font-size:${size}px`)}`,
        run: `${footageRun(i, m)}$('v').style.transform='scale('+mix(1,1.14,lt/dur)+')';words($('t'),lt,.15);`,
      };
    case 'phone':
      return {
        entry: 'whip',
        html: `<div class="layer" style="background:${BRIGHT[i % BRIGHT.length]}"></div>${kinetic(sc.text, id('t'), `top:240px;font-size:${Math.min(size, 104)}px`, true)}<div class="wrap" id="${id('ph')}">${phone(screenHtml(sc.screen, { pool }, i), 0, 0, 1)}</div>`,
        run: `words($('t'),lt,.2);const a=spring(p(lt,.2,1.15));place($('ph'),540,mix(2300,1190,a)-Math.sin(lt*.9)*8,1.26+lt*.012,mix(-9,-2,a)+Math.sin(lt*.7));`,
      };
    case 'album':
      return {
        entry: 'whip',
        html: `<div class="layer" style="background:${BRIGHT[0]}"></div>${kinetic(sc.text, id('t'), `top:240px;font-size:${Math.min(size, 112)}px`, true)}
<div class="wrap" id="${id('ph')}">${phone(`<div class="ui" id="${id('a')}">${statusBar}<div style="padding:34px 26px"><div class="mono" style="font-size:13px;color:#FACC15">NEW EVENT ALBUM</div><div style="font-size:34px;font-weight:700;margin-top:10px">Name it</div><div style="margin-top:26px;height:72px;border-radius:18px;background:#1c1c1e;display:flex;align-items:center;padding:0 20px;font-size:26px;font-weight:600"><span id="${id('typed')}"></span><span id="${id('caret')}" style="display:inline-block;width:3px;height:30px;background:#FACC15;margin-left:2px"></span></div></div><div class="btn" id="${id('inv')}" style="bottom:70px;background:#fff;color:#000">Invite with QR</div><div class="tap" id="${id('tap')}" style="left:209px;top:752px"></div></div><div class="ui" id="${id('b')}" style="visibility:hidden">${screenHtml('qr-album', { pool }, 3)}</div>`, 0, 0, 1)}</div>`,
        run: `const s=lt*4.5/dur;words($('t'),lt,.25);const a=spring(p(s,.3,1.25));const push=cubic(p(s,4.05,4.75));$('typed').textContent='Our big day'.slice(0,Math.floor(p(s,1,2)*11));$('caret').style.opacity=Math.floor(lt*4)%2?0:1;const on=s>=2.55;$('b').style.visibility=on?'inherit':'hidden';$('b').style.transform='translateY('+(1-expo(p(s,2.55,3.05)))*872+'px)';$('inv').style.opacity=expo(p(s,1.95,2.25));$('inv').style.transform='scale('+(1-Math.sin(p(s,2.25,2.6)*3.14)*.07)+')';tap($('tap'),s,2.4);place($('ph'),540,mix(2300,1130,a)-Math.sin(lt*.9)*8+mix(0,-260,push),1.45+mix(0,4.6,inCubic(push)),mix(-9,mix(-2,0,push),a));`,
      };
    case 'qr-card':
      return {
        entry: 'fade',
        html: `${footageLayer(m, id('v'))}<div class="layer" style="background:linear-gradient(180deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.05) 48%,rgba(0,0,0,.25) 100%)"></div><div class="layer" style="perspective:1800px"><div class="qcard" id="${id('c')}" style="left:260px;top:700px;transform-origin:50% 60%"><div style="font:600 22px Plex;letter-spacing:.1em;color:#6b7280">EVENT ALBUM</div><div style="font-size:50px;font-weight:800;letter-spacing:-.03em;margin:10px 0 26px">Our big day</div><div style="width:400px;height:400px;margin:0 auto">${qr}</div><div style="font-size:26px;font-weight:600;margin-top:28px;color:#374151">Scan to add your photos</div></div></div>${kinetic(sc.text, id('t'), `top:250px;font-size:${Math.min(size, 112)}px`)}`,
        run: `${footageRun(i, m)}const s=lt*4/dur;const land=spring(p(s,.15,1));$('c').style.transform='translateY('+mix(-160,0,land)+'px) scale('+mix(1.9,1,expo(p(s,0,.7)))+') rotateX('+mix(0,34,land)+'deg) rotateZ('+mix(0,-6,land)+'deg)';words($('t'),lt,.3);`,
      };
    case 'scan':
      return {
        entry: 'fade',
        html: `${footageLayer(m, id('v'))}<div class="layer" style="background:linear-gradient(180deg,rgba(0,0,0,.62) 0%,rgba(0,0,0,.05) 48%,rgba(0,0,0,.25) 100%)"></div>${kinetic(sc.text, id('t'), `top:250px;font-size:${Math.min(size, 112)}px`)}
<div class="wrap" id="${id('ph')}">${phone(`<div class="ui" style="background:#111">${m.frames || m.still ? `<img id="${id('w')}" class="layer" style="width:100%;height:100%;object-fit:cover;filter:brightness(.8)" ${m.frames ? '' : `src="${esc(m.still ?? '')}"`}>` : `<div class="layer" style="background:${BRAND_DARK}"></div>`}<div style="position:absolute;left:60px;top:140px;width:298px;height:298px;background:#fff;border-radius:18px;padding:30px;transform:rotate(-2deg)">${qr}</div><svg id="${id('brk')}" style="position:absolute;left:40px;top:120px" width="338" height="338" fill="none" stroke-width="9" stroke-linecap="round"><g id="${id('bc')}" stroke="#fff"><path d="M6 70V6h64M268 6h64v64M332 268v64h-64M70 332H6v-64"/></g></svg></div>
<div class="ui" id="${id('b')}" style="visibility:hidden;background:#fff;color:#0d0f14"><div style="padding:58px 22px 12px;background:#f2f2f4;text-align:center;font-size:15px;color:#6b7280">${esc(d.site)}</div><div style="padding:26px"><div class="mono" style="font-size:13px;color:#a16207">EVENT ALBUM</div><div style="font-size:38px;font-weight:800;letter-spacing:-.03em;margin-top:6px">Our big day</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:22px">${[0, 1, 2, 3, 4, 5].map((n) => `<div style="position:relative;aspect-ratio:1;border-radius:10px;${bg(pick(n + 2))}"><div id="${id(`k${n}`)}" style="position:absolute;right:6px;bottom:6px;width:30px;height:30px;border-radius:50%;background:#30D158;display:grid;place-items:center;opacity:0">${TICK(16, '#000')}</div></div>`).join('')}</div></div><div class="btn" style="bottom:60px;background:#2563EB;color:#fff">Add your photos</div><div class="tap" id="${id('tap')}" style="left:209px;top:780px"></div></div>`, 0, 0, 1)}</div>`,
        run: `${footageRun(i, m)}${footageRun(i, m, 'w')}const s=lt*4/dur;words($('t'),lt,.1);const u=expo(p(s,.1,.8));place($('ph'),600,mix(2500,1120,u)+Math.sin(lt*1.1)*6,1.14,mix(7,3,u));$('bc').setAttribute('stroke',s>=1.2?'#30D158':'#fff');$('brk').style.transform='scale('+(mix(1.12,1,expo(p(s,.5,1.2)))+Math.sin(p(s,1.2,1.5)*3.14)*.05)+')';$('b').style.visibility=s>=1.85?'inherit':'hidden';$('b').style.transform='translateY('+(1-expo(p(s,1.85,2.3)))*872+'px)';for(let n=0;n<6;n++){const x=spring(p(s,2.35+n*.14,2.75+n*.14));$('k'+n).style.opacity=x>0?1:0;$('k'+n).style.transform='scale('+x+')';}tap($('tap'),s,3.3);`,
      };
    case 'fill': {
      const slots = Array.from({ length: 15 }, (_, n) => `<div class="slot" id="${id(`sl${n}`)}"></div>`).join('');
      const fly = Array.from({ length: 15 }, (_, n) => `<div class="fly" id="${id(`f${n}`)}" style="${bg(pick(n))}"></div>`).join('');
      return {
        entry: 'circle',
        html: `<div class="layer" style="background:${BRIGHT[1]}"></div>${kinetic(sc.text, id('t'), `top:220px;font-size:${Math.min(size, 104)}px`, true)}<div class="wrap" id="${id('ph')}">${phone(`<div class="ui">${statusBar}<div style="padding:18px 16px 0"><div class="mono" style="font-size:12px;color:#FACC15">EVENT ALBUM</div><div style="font-size:30px;font-weight:700;margin:4px 0 14px">Our big day</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px">${slots}</div></div></div>`, 0, 0, 1)}</div>${fly}`,
        run: `const s=lt*4/dur;words($('t'),lt,.2);place($('ph'),540,mix(1350,1190,expo(p(s,.1,.8))),1.26,0);const X=[-300,1300,-300,1300,540,-300,1300,540,-300,1300,-300,1300,540,-300,1300],Y=[700,1000,1400,600,2200,1700,1500,2300,500,1900,1100,800,2200,1300,1800];for(let n=0;n<15;n++){const a=.6+n*.15;const x=cubic(p(s,a,a+.5));const e=$('f'+n),sl=$('sl'+n);const r=sl.getBoundingClientRect();const tg=r.width/300;const sx=r.left+r.width/2-150,sy=r.top+r.height/2-150;const on=x>=1;e.style.visibility=x>0&&!on?'inherit':'hidden';e.style.transform='translate('+mix(X[n],sx,x)+'px,'+mix(Y[n],sy,x)+'px) rotate('+mix(n%2?18:-16,0,x)+'deg) scale('+mix(1.3,tg,x)+')';sl.style.background=on?e.style.background:'#1c1c1e';sl.style.transform='scale('+(on?1+Math.sin(p(s,a+.5,a+.72)*3.14)*.1:1)+')';}`,
      };
    }
    case 'compare':
      // The same crop of the photo twice, one above the other: the chat copy (blocky, washed out) and the original.
      // Same framing on both, so the only difference anyone sees is quality.
      return {
        entry: 'slide',
        html: `<div class="layer" style="background:${BRAND_DARK}"></div>${kinetic(sc.text, id('t'), `top:240px;font-size:${Math.min(size, 100)}px`)}
<div class="cmp" id="${id('p1')}" style="top:580px"><img src="${esc(m.heroChat ?? '')}" id="${id('z1')}" style="filter:saturate(.75) contrast(.92)"><div class="pill big" style="left:24px;bottom:24px">CHAT COPY</div></div>
<div class="cmp" id="${id('p2')}" style="top:1040px"><img src="${esc(m.hero ?? '')}" id="${id('z2')}"><div class="pill big" style="left:24px;bottom:24px;background:#30D158;color:#000">ORIGINAL</div></div>`,
        run: `const s=lt*3/dur;words($('t'),lt,.2);const z='scale('+mix(1.15,1.25,p(s,0,3))+')';$('z1').style.transform=z;$('z2').style.transform=z;const a=expo(p(s,.15,.7)),b=expo(p(s,.8,1.35));$('p1').style.transform='translateX('+mix(-1100,0,a)+'px)';$('p2').style.transform='translateX('+mix(1100,0,b)+'px)';`,
      };
    case 'end':
      // Icon and line at the top, the app on a phone in the middle (fully in frame), the button over its lower edge.
      return {
        entry: 'wipe',
        html: `<div class="layer" style="background:radial-gradient(70% 45% at 80% 15%,#3b82f6 0%,transparent 70%),radial-gradient(70% 45% at 10% 90%,#7c3aed 0%,transparent 70%),#0b1020"></div><img id="${id('i')}" src="${d.icon}" style="position:absolute;left:465px;top:210px;width:150px;height:150px;border-radius:36px;box-shadow:0 30px 70px rgba(0,0,0,.5)">${kinetic(sc.text, id('t'), `top:400px;left:72px;width:936px;text-align:center;font-size:${Math.min(size, 84)}px`)}<div class="wrap" id="${id('ph')}">${phone(screenHtml(sc.screen === 'qr-album' || EVENT.test(d.scenes.map((x) => x.text).join(' ')) ? 'qr-album' : 'library', { pool }, 3), 0, 0, 1)}</div><div id="${id('c')}" style="position:absolute;left:290px;top:1290px;width:500px;height:112px;border-radius:56px;background:#fff;color:#0d0f14;display:grid;place-items:center;font:800 46px Geist;letter-spacing:-.02em;box-shadow:0 30px 60px -10px rgba(0,0,0,.6)">${esc(d.cta)}</div><div id="${id('w')}" style="position:absolute;left:0;right:0;top:1430px;text-align:center;font:500 38px Geist;color:#cbd5e1">${esc(d.site)}</div>`,
        run: `const s=lt*3/dur;const a=spring(p(s,.2,1));$('i').style.transform='scale('+a+') rotate('+mix(-22,0,a)+'deg)';words($('t'),lt,.5,.05);place($('ph'),540,mix(2400,1060,expo(p(s,.7,1.5)))-Math.sin(lt*.9)*6,.8,0);$('c').style.transform='scale('+spring(p(s,1.2,1.9))+')';$('w').style.opacity=expo(p(s,1.5,1.9));`,
      };
  }
}

/** The whole reel as one page: window.seek(t) draws any moment, nothing moves on its own, nothing loads from the network. */
export function reelHtml(d: ReelPageData): string {
  let at = 0;
  const parts = d.scenes.map((sc, i) => {
    const r = scene(sc, i, d);
    const start = at;
    at += sc.seconds;
    return { ...r, start, dur: sc.seconds, i };
  });
  const html = parts.map((x) => `<div class="scene" id="s${x.i}" style="z-index:${x.i + 1}">${x.html}</div>`).join('\n');
  const list = parts.map((x) => `{start:${x.start},dur:${x.dur},entry:'${x.entry}',run:async(lt,dur,$)=>{${x.run}}}`).join(',\n');
  return `<!doctype html><meta charset="utf-8"><style>${css({ w: 1080, h: 1920, fonts: d.fonts })}
html,body{background:#000}
:root{--blue:${d.brand?.primary ?? '#2563EB'};--yellow:${d.brand?.accent ?? '#FACC15'};--green:#30D158;--red:#FF453A;--ink:#0d0f14;--muted:#4a505c;--paper:#f4f4f6}
.ai{position:absolute;inset:0;overflow:hidden;font-family:Geist,sans-serif;color:var(--ink);background:var(--paper)}
.check{border-radius:50%;background:#30D158;place-items:center;flex:none}
.scene{position:absolute;inset:0;overflow:hidden;visibility:hidden}
.layer{position:absolute;inset:0}
.k{position:absolute;left:72px;width:880px;font-family:Geist;font-weight:800;line-height:1.04;letter-spacing:-.045em;color:#fff;text-wrap:balance}
.k.dark{color:#0d0f14}
.w{display:inline-block;overflow:hidden;vertical-align:top;padding:0 .04em .14em 0;margin-bottom:-.1em}
.i{display:inline-block}
.y{color:#FACC15}.k.dark .y{color:#2563EB}
.wrap{position:absolute;left:0;top:0;width:418px;height:872px;transform-origin:50% 50%}
.wrap .phone{position:absolute;left:0;top:0;transform:none!important;box-shadow:0 70px 120px -30px rgba(0,0,0,.55)}
.ui{position:absolute;inset:0;background:#000;color:#fff;font-family:Geist;overflow:hidden}
.sb{display:flex;justify-content:space-between;padding:16px 30px 0;font-size:15px;font-weight:600}
.btn{position:absolute;left:26px;right:26px;height:62px;border-radius:31px;display:grid;place-items:center;font-size:20px;font-weight:700}
.tap{position:absolute;width:74px;height:74px;border-radius:50%;background:rgba(255,255,255,.55);border:3px solid #fff;margin:-37px 0 0 -37px;visibility:hidden}
.qcard{position:absolute;display:block;width:560px;height:760px;background:#fff;border-radius:34px;box-shadow:0 60px 90px -20px rgba(0,0,0,.6);padding:44px;text-align:center;color:#0d0f14;font-family:Geist}
.slot{border-radius:6px;aspect-ratio:1;background:#1c1c1e;background-size:cover!important}
.fly{position:absolute;left:0;top:0;width:300px;height:300px;border-radius:26px;border:8px solid #fff;box-shadow:0 30px 60px -10px rgba(0,0,0,.45);visibility:hidden}
.mono{font-family:Plex;font-weight:600;letter-spacing:.08em}
.pill{position:absolute;padding:12px 22px;border-radius:40px;font:600 30px Plex;letter-spacing:.06em;background:rgba(0,0,0,.6);color:#fff}
.cmp{position:absolute;left:72px;width:936px;height:420px;border-radius:36px;overflow:hidden;box-shadow:0 40px 80px -24px rgba(0,0,0,.7)}
.cmp img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform-origin:50% 50%}
.pill.big{padding:16px 28px;font-size:36px;background:rgba(0,0,0,.72)}
#sub{position:absolute;left:72px;right:120px;top:1352px;z-index:999;display:flex;justify-content:center;pointer-events:none}
#sub span{font:800 58px/1.1 Geist,sans-serif;letter-spacing:-.02em;color:#fff;background:rgba(10,12,18,.72);padding:12px 26px 16px;border-radius:22px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.35)}
#sub b{font-weight:800;color:#fff}#sub b.on{color:var(--yellow)}
</style>
${html}
<div id="sub"></div>
<script>
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const p=(t,a,b)=>clamp((t-a)/(b-a));
const expo=(x)=>x>=1?1:1-Math.pow(2,-10*x);
const cubic=(x)=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
const inCubic=(x)=>x*x*x;
const spring=(x)=>x<=0?0:1-Math.exp(-7*x)*Math.cos(11*x);
const mix=(a,b,x)=>a+(b-a)*x;
function words(e,t,start,slow){e.querySelectorAll('.i').forEach((s)=>{const d=start+Number(s.dataset.d)*(slow?slow/.07:1);s.style.transform='translateY('+mix(112,0,expo(p(t,d,d+.55)))+'%)';});}
function place(e,cx,cy,sc,rot){e.style.transform='translate('+(cx-209)+'px,'+(cy-436)+'px) scale('+sc+') rotate('+(rot||0)+'deg)';}
function tap(e,t,at){const x=p(t,at-.15,at+.3);e.style.visibility=x>0&&x<1?'inherit':'hidden';e.style.transform='scale('+mix(1.2,.8,Math.sin(x*3.14))+')';e.style.opacity=Math.sin(x*3.14);}
async function ai(i,lt){const el=document.getElementById('s'+i);for(const a of el.getAnimations({subtree:true})){a.pause();a.currentTime=lt*1000;}for(const im of el.querySelectorAll('img[data-clip]'))await frame(im,im.dataset.clip,Math.min(Number(im.dataset.n),Math.round(lt*30)+1));}
async function frame(el,dir,n){const src=dir+'/'+String(n).padStart(4,'0')+'.jpg';if(el.getAttribute('src')!==src){el.src=src;await el.decode();}}
const SC=[${list}];
const SUBS=${JSON.stringify((d.subs ?? []).map((c) => ({ t0: c.t0, t1: c.t1, w: c.words.map((w) => [reelWord(w.w), w.t]) })))};
function subs(t){const box=document.getElementById('sub');const c=SUBS.find((x)=>t>=x.t0&&t<x.t1);if(!c){box.innerHTML='';return;}box.innerHTML='<span>'+c.w.map(([w,at])=>'<b class="'+(t>=at?'on':'')+'">'+w+'</b>').join(' ')+'</span>';}
const OVER=.5;
window.seek=async function(t){subs(t);for(let i=0;i<SC.length;i++){const c=SC[i],n=SC[i+1],el=document.getElementById('s'+i);const on=t>=c.start&&(!n||t<c.start+c.dur+OVER);el.style.visibility=on?'visible':'hidden';if(!on)continue;const lt=t-c.start;
 const e=expo(p(lt,0,.5));let tf='none',clip='none',op=1,flt='none';
 if(c.entry==='whip')tf='translateY('+(1-e)*1920+'px)';else if(c.entry==='slide')tf='translateX('+(1-e)*1080+'px)';else if(c.entry==='circle')clip='circle('+e*150+'% at 62% 56%)';else if(c.entry==='wipe')clip='inset('+(1-e)*50+'% 0 '+(1-e)*50+'% 0)';else if(c.entry==='fade')op=p(lt,0,.3);
 if(n&&n.entry==='whip'&&t>=n.start){const w=expo(p(t,n.start,n.start+.5));tf='translateY('+(-w*1920)+'px)';flt=w>0&&w<1?'blur('+Math.round(w*(1-w)*80)+'px)':'none';}
 el.style.transform=tf;el.style.clipPath=clip;el.style.opacity=op;el.style.filter=flt;
 await c.run(lt,c.dur,(x)=>document.getElementById('s'+i+'-'+x));}};
</script>`;
}
