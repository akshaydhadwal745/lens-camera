// Designed content images (docs/growth/content-engine.md, phase 3, owner-approved look 2026-11-04): the real
// Lens app on a phone, bright backgrounds, before/after, photo moments, proof cards and a photo fan, in the
// style of big app launches. Pure: everything comes in as data (fonts, icon, photos as data URLs).
// The phone screens are drawn from the app's own design (docs/design/app-design.md: The roll, Keynote Glass,
// colours and fonts), so they look like the app people will install.
// Brand rules kept here: cards make no number claims; no camera details on found photos (never "shot on
// Lens"); found photos are only scenery and screen content.
import type { Brand } from './growth-brand';

export const SCREENS = ['library', 'free-space', 'storage-full', 'backup', 'viewer', 'qr-album', 'camera'] as const;
export type Screen = (typeof SCREENS)[number];
export const LAYOUTS = ['hero', 'compare', 'moment', 'phone', 'cta'] as const;
export type Layout = (typeof LAYOUTS)[number];

export type Design = {
  w: number;
  h: number;
  layout: Layout;
  screen: Screen;
  headline: string;
  body: string;
  index?: number;
  total?: number;
  cta: string;
  site: string;
  photo?: string; // the scene (moment background, viewer, camera)
  pool: string[]; // photos for phone screens and the fan
  icon: string; // app icon data URL
  fonts: { geist?: string; deva?: string; plex500?: string; plex600?: string };
  brand: Brand;
};

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Headline in two tones: the first sentence dark, the rest in the brand colour ("Phone full? | Keep every photo."). */
export function splitHeadline(h: string): [string, string] {
  const m = /^(.+?[?!.:])\s+(\S.*)$/.exec(h.trim());
  return m ? [m[1], m[2]] : [h.trim(), ''];
}

/** Big for short headlines, smaller for long ones; `width` is the text column in design pixels. */
export function fitSize(text: string, width: number, max: number, lines = 3): number {
  const n = Math.max(1, [...text].length);
  // Geist Bold at -0.04em averages ~0.5em per character.
  const perLine = Math.ceil(n / lines);
  return Math.max(Math.round(max * 0.42), Math.min(max, Math.floor(width / (perLine * 0.5))));
}

const pick = <T>(list: T[], i: number): T | undefined => (list.length ? list[((i % list.length) + list.length) % list.length] : undefined);

// ---------- the phone and its screens (drawn at 390×844, scaled) ----------

const TICK = (size: number, color = '#000') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const statusBar = () => `<div class="sb"><span>9:41</span><span>5G<i></i></span></div>`;
const bg = (src: string | undefined, pos = 'center') => (src ? `background:url(${src}) ${pos}/cover` : 'background:linear-gradient(135deg,#1C1C1E,#3A3A3C)');

function tile(src: string | undefined, n: number) {
  return `<div class="tile" style="${bg(src)}"><span class="mono">#${n}</span></div>`;
}

function library(pool: string[], seed: number) {
  const tiles = Array.from({ length: 15 }, (_, i) => tile(pick(pool, seed + i), 2412 - i)).join('');
  const holes = '<div class="hole"></div>'.repeat(36);
  return `${statusBar()}
<div style="padding:6px 20px 0">
 <div style="font-size:34px;font-weight:700;letter-spacing:-.02em">The roll</div>
 <div class="mono" style="font-size:11px;color:#30D158;letter-spacing:.04em;margin-top:4px">2 412 FRAMES · NEVER ENDS · ALL SAFE</div>
 <div class="chips"><span class="on">All</span><span>Videos</span><span>Shared</span><span style="margin-left:auto;color:#2997FF">38/100 GB</span></div>
</div>
<div style="display:flex;margin-top:16px">
 <div style="width:20px;background:#1C1C1E">${holes}</div>
 <div style="flex:1;padding:0 20px 0 8px">
  <div class="mono" style="font-size:11px;color:#FACC15;letter-spacing:.06em;margin-bottom:8px">TODAY · 42 FRAMES</div>
  <div class="grid">${tiles}</div>
 </div>
</div>
<div class="pill-white" style="position:absolute;bottom:34px;left:50%;transform:translateX(-50%)">Keep shooting</div>`;
}

function storageFull() {
  const rows: [string, string, string][] = [
    ['Photos & videos', '41.2 GB', '#FF453A'],
    ['Apps', '12.6 GB', '#FF9F0A'],
    ['System', '7.4 GB', '#8E8E93'],
    ['Other', '2.6 GB', '#636366'],
  ];
  return `${statusBar()}
<div style="padding:14px 22px">
 <div style="font-size:30px;font-weight:700">Storage</div>
 <div style="margin-top:26px;font-size:46px;font-weight:700;letter-spacing:-.03em">63.8 GB</div>
 <div style="color:#A1A1A6;font-size:16px">used of 64 GB</div>
 <div style="margin-top:16px;height:14px;border-radius:99px;background:#2C2C2E;display:flex;overflow:hidden"><span style="width:64%;background:#FF453A"></span><span style="width:20%;background:#FF9F0A"></span><span style="width:11.5%;background:#8E8E93"></span><span style="width:4.2%;background:#636366"></span></div>
 <div style="margin-top:22px;background:rgba(255,69,58,.14);border:1px solid rgba(255,69,58,.4);color:#FF6961;border-radius:18px;padding:16px;font-size:15px;line-height:1.4"><b style="font-size:17px">Storage full</b><br>You can’t take photos or videos until you free up space.</div>
 <div style="margin-top:16px">${rows.map(([n, s, c]) => `<div class="row"><span style="width:12px;height:12px;border-radius:3px;background:${c}"></span>${n}<span style="margin-left:auto;color:#A1A1A6">${s}</span></div>`).join('')}</div>
</div>`;
}

function freeSpace() {
  return `${statusBar()}
<div style="padding:14px 22px">
 <div style="font-size:30px;font-weight:700">Free up space</div>
 <div style="margin:26px auto 0;width:210px;height:210px;border-radius:50%;background:conic-gradient(#30D158 0 72%,#2C2C2E 72% 100%);display:grid;place-items:center">
  <div style="width:172px;height:172px;border-radius:50%;background:#000;display:grid;place-items:center;text-align:center"><div><div style="font-size:44px;font-weight:700;letter-spacing:-.03em">18.4</div><div style="color:#A1A1A6;font-size:15px">GB freed</div></div></div></div>
 <div class="panel" style="margin-top:26px"><div style="display:flex;align-items:center;gap:12px;font-size:16px;font-weight:600"><span class="dot">${TICK(15)}</span>3 214 photos safe in the cloud</div>
  <div style="color:#A1A1A6;font-size:14px;margin-top:8px;line-height:1.45">Full quality. Removed from the phone only after the backup was checked.</div></div>
 <div class="panel" style="margin-top:14px;display:flex;justify-content:space-between;font-size:16px"><span>Phone storage</span><span style="color:#30D158;font-weight:600">45.4 of 64 GB</span></div>
 <div class="pill-blue" style="margin-top:20px">Done</div>
</div>`;
}

function backup(pool: string[], seed: number) {
  const names = ['IMG_2412', 'IMG_2411', 'VID_2410', 'IMG_2409', 'IMG_2408', 'IMG_2407'];
  const sizes = ['4.8 MB', '3.9 MB', '412 MB · 4K', '5.1 MB', '4.4 MB', '3.7 MB'];
  const rows = names
    .map((name, i) => {
      const done = i > 0;
      return `<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid #1C1C1E">
 <div style="width:54px;height:54px;border-radius:6px;${bg(pick(pool, seed + i))}"></div>
 <div style="flex:1"><div style="font-size:15px;font-weight:600">${name}</div><div class="mono" style="font-size:11px;color:#86868B;margin-top:3px">${sizes[i]}</div>
  ${done ? '' : '<div style="margin-top:6px;height:5px;border-radius:9px;background:#2C2C2E"><div style="width:64%;height:100%;border-radius:9px;background:#2997FF"></div></div>'}</div>
 ${done ? `<span class="dot">${TICK(14)}</span>` : '<span class="mono" style="font-size:12px;color:#2997FF">64%</span>'}</div>`;
    })
    .join('');
  return `${statusBar()}
<div style="padding:14px 22px">
 <div style="font-size:30px;font-weight:700">Backup</div>
 <div class="mono" style="font-size:11px;color:#30D158;letter-spacing:.05em;margin-top:6px">FULL QUALITY · ORIGINAL FILES</div>
 <div class="panel" style="margin-top:20px;display:flex;align-items:center;gap:14px"><span class="dot" style="width:40px;height:40px">${TICK(20)}</span><div><div style="font-size:17px;font-weight:600">Everything else is safe</div><div style="color:#A1A1A6;font-size:14px;margin-top:2px">Nothing compressed</div></div></div>
 <div style="margin-top:14px">${rows}</div>
</div>`;
}

function viewer(photo: string | undefined) {
  return `<div style="position:absolute;inset:0;${bg(photo)}"></div>
<div style="position:absolute;inset:0;background:linear-gradient(rgba(0,0,0,.35),transparent 18%,transparent 70%,rgba(0,0,0,.55))"></div>
<div style="position:relative">${statusBar()}</div>
<div style="position:relative;display:flex;gap:8px;padding:8px 16px;font-size:13px;font-weight:600;white-space:nowrap">
 <span class="glass">‹</span><span class="glass">Today · Backed up</span>
 <span style="margin-left:auto;background:rgba(48,209,88,.92);color:#000;padding:9px 14px;border-radius:99px">${TICK(14)} Safe</span></div>
<div class="glass-bar"><span>Share</span><span>Send</span><span class="pill-white" style="padding:12px 24px;font-size:15px;box-shadow:none">Edit</span><span>Save</span><span>Delete</span></div>`;
}

/** A QR-style pattern (deterministic; drawn, not scannable: the real album link is in the caption). */
export function qrPattern(seed: number): string {
  const n = 25;
  let cells = '';
  let x = (seed * 2654435761) >>> 0;
  const finder = (r: number, c: number) => {
    for (const [fr, fc] of [
      [0, 0],
      [0, n - 7],
      [n - 7, 0],
    ]) {
      const dr = r - fr;
      const dc = c - fc;
      if (dr >= 0 && dr < 7 && dc >= 0 && dc < 7) return dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4) ? 1 : 0;
    }
    return -1;
  };
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const f = finder(r, c);
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      if (f === 1 || (f === -1 && (x >>> 16) % 2 === 0)) cells += `<rect x="${c}" y="${r}" width="1.02" height="1.02"/>`;
    }
  return `<svg viewBox="0 0 ${n} ${n}" width="100%" height="100%" fill="#000" shape-rendering="crispEdges">${cells}</svg>`;
}

function qrAlbum(pool: string[], seed: number) {
  const faces = [0, 1, 2, 3].map((i) => `<div style="width:36px;height:36px;border-radius:50%;border:2px solid #000;margin-left:${i ? -10 : 0}px;${bg(pick(pool, seed + 7 + i))}"></div>`).join('');
  return `${statusBar()}
<div style="padding:14px 22px;text-align:center">
 <div class="mono" style="font-size:11px;color:#FACC15;letter-spacing:.08em;margin-top:6px">EVENT ALBUM</div>
 <div style="font-size:28px;font-weight:700;margin-top:6px">Our big day</div>
 <div style="color:#A1A1A6;font-size:15px;margin-top:4px">Guests scan to add their photos</div>
 <div style="margin:22px auto 0;width:250px;height:250px;background:#fff;border-radius:24px;padding:18px">${qrPattern(seed)}</div>
 <div style="display:flex;justify-content:center;align-items:center;gap:10px;margin-top:22px">${faces}<span style="font-size:14px;color:#A1A1A6">guests adding photos</span></div>
 <div class="grid" style="margin-top:20px">${[0, 1, 2, 3, 4, 5].map((i) => tile(pick(pool, seed + 3 + i), 318 - i)).join('')}</div>
</div>`;
}

function camera(photo: string | undefined) {
  return `<div style="position:absolute;inset:0;${bg(photo)}"></div>
<div style="position:relative">${statusBar()}</div>
<div style="position:relative;display:flex;justify-content:space-between;padding:8px 18px;font-size:13px;font-weight:600">
 <span class="glass">Flash</span><span class="glass" style="color:#FACC15"><svg width="9" height="9" viewBox="0 0 10 10" style="vertical-align:0"><circle cx="5" cy="5" r="5" fill="#FACC15"/></svg> Night</span><span class="glass">PRO</span></div>
<div style="position:absolute;left:12px;right:12px;bottom:22px;background:rgba(10,10,12,.66);border:1px solid rgba(255,255,255,.14);border-radius:34px;padding:16px 16px 20px">
 <div style="display:flex;justify-content:center;gap:10px;font-size:13px;font-weight:600"><span class="glass" style="padding:6px 10px">.6</span><span style="background:#fff;color:#000;padding:6px 10px;border-radius:99px">1×</span><span class="glass" style="padding:6px 10px">2</span></div>
 <div class="mono" style="display:flex;justify-content:center;gap:18px;margin-top:14px;font-size:12px;color:#A1A1A6;letter-spacing:.06em"><span>PORTRAIT</span><span style="color:#FACC15">PHOTO</span><span>VIDEO</span></div>
 <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding:0 18px">
  <div style="width:44px;height:44px;border-radius:10px;${bg(photo)};border:2px solid #fff"></div>
  <div style="width:80px;height:80px;border-radius:50%;border:4px solid #FACC15;display:grid;place-items:center"><div style="width:64px;height:64px;border-radius:50%;background:#fff"></div></div>
  <div style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.18);display:grid;place-items:center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg></div></div>
</div>`;
}

export function screenHtml(s: Screen, d: Pick<Design, 'pool' | 'photo'>, seed = 0): string {
  switch (s) {
    case 'library':
      return library(d.pool, seed);
    case 'free-space':
      return freeSpace();
    case 'storage-full':
      return storageFull();
    case 'backup':
      return backup(d.pool, seed);
    case 'viewer':
      return viewer(d.photo ?? pick(d.pool, seed));
    case 'qr-album':
      return qrAlbum(d.pool, seed);
    case 'camera':
      return camera(d.photo ?? pick(d.pool, seed));
  }
}

const phone = (screen: string, x: number, y: number, scale: number, rotate = 0) =>
  `<div class="phone" style="left:${Math.round(x)}px;top:${Math.round(y)}px;transform:scale(${scale.toFixed(3)}) rotate(${rotate}deg)"><div class="screen"><div class="island"></div>${screen}<div class="glare"></div></div></div>`;

// ---------- the page ----------

const BACKDROPS = [
  'radial-gradient(70% 60% at 85% 75%,#c7dcff 0%,transparent 60%),radial-gradient(60% 50% at 10% 100%,#ffe3c2 0%,transparent 60%),linear-gradient(160deg,#f7f5f2,#eef1f7)',
  'linear-gradient(180deg,#eef0ff 0%,#f6f1ff 55%,#fdf3ec 100%)',
  'radial-gradient(70% 55% at 20% 80%,#d4f5e2 0%,transparent 60%),radial-gradient(60% 50% at 90% 10%,#dbe8ff 0%,transparent 60%),linear-gradient(170deg,#f6faf8,#eef3f8)',
  'radial-gradient(70% 60% at 80% 85%,#ffd9e2 0%,transparent 60%),radial-gradient(60% 50% at 0% 0%,#e3e6ff 0%,transparent 60%),linear-gradient(160deg,#fbf7f8,#f1f1f8)',
];

function css(d: Design) {
  const f = d.fonts;
  const face = (fam: string, data: string | undefined, fmt: 'woff2' | 'ttf', w: string, extra = '') =>
    data ? `@font-face{font-family:'${fam}';src:url(data:font/${fmt};base64,${data}) format('${fmt === 'ttf' ? 'truetype' : fmt}');font-weight:${w}${extra}}` : '';
  return `${face('Geist', f.geist, 'woff2', '300 800')}${face('Noto Sans Devanagari', f.deva, 'woff2', '100 900', ';unicode-range:U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20B9,U+25CC,U+A8E0-A8FF')}${face('Plex', f.plex500, 'ttf', '500')}${face('Plex', f.plex600, 'ttf', '600')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${d.w}px;height:${d.h}px;overflow:hidden}
body{font-family:Geist,'Noto Sans Devanagari',sans-serif;-webkit-font-smoothing:antialiased;background:#f4f4f6;position:relative}
.stage{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden}
.mono{font-family:Plex,monospace}
.phone{position:absolute;width:418px;height:872px;border-radius:66px;padding:14px;transform-origin:top left;background:linear-gradient(145deg,#5b5e66 0%,#1d1f24 18%,#0c0d10 50%,#2a2c31 82%,#6a6d75 100%);box-shadow:0 0 0 1.5px #8a8d95 inset,0 0 0 3px #0a0a0c inset,0 60px 120px -20px rgba(15,20,40,.55),0 30px 60px -30px rgba(0,0,0,.6)}
.phone::before{content:'';position:absolute;right:-4px;top:190px;width:4px;height:96px;border-radius:0 3px 3px 0;background:linear-gradient(#55585f,#2a2c31)}
.phone::after{content:'';position:absolute;left:-4px;top:150px;width:4px;height:60px;border-radius:3px 0 0 3px;background:linear-gradient(#55585f,#2a2c31);box-shadow:0 84px 0 #3a3c42}
.screen{position:relative;width:390px;height:844px;border-radius:52px;overflow:hidden;background:#000;color:#F5F5F7}
.island{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:120px;height:34px;border-radius:20px;background:#000;z-index:9}
.glare{position:absolute;inset:0;border-radius:52px;background:linear-gradient(115deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,.04) 28%,transparent 42%);z-index:8}
.sb{height:54px;display:flex;justify-content:space-between;align-items:center;padding:6px 30px 0 34px;font-weight:600;font-size:16px}
.sb i{display:inline-block;width:26px;height:12px;border:1.5px solid currentColor;border-radius:4px;position:relative;margin-left:6px}
.sb i::after{content:'';position:absolute;inset:1.5px;width:60%;background:currentColor;border-radius:1.5px}
.chips{display:flex;gap:8px;margin-top:14px;font-size:14px;font-weight:600}
.chips span{background:#1C1C1E;padding:7px 14px;border-radius:99px}
.chips .on{background:#fff;color:#000}
.hole{width:9px;height:12px;border-radius:2px;background:#000;margin:5px auto}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:3px}
.tile{position:relative;height:126px;border-radius:4px}
.tile span{position:absolute;left:5px;bottom:3px;font-size:10px;color:rgba(255,255,255,.85);text-shadow:0 1px 2px #000}
.row{display:flex;align-items:center;gap:12px;padding:15px 0;border-bottom:1px solid #2C2C2E;font-size:16px}
.panel{background:#1C1C1E;border-radius:20px;padding:18px}
.dot{width:28px;height:28px;flex:none;border-radius:50%;background:#30D158;display:grid;place-items:center}
.pill-white{background:#fff;color:#000;font-weight:600;font-size:16px;padding:14px 26px;border-radius:99px;box-shadow:0 10px 30px rgba(0,0,0,.5);white-space:nowrap;z-index:5}
.pill-blue{background:#0071E3;color:#fff;text-align:center;font-weight:600;font-size:17px;padding:16px;border-radius:99px}
.glass{background:rgba(28,28,30,.64);border:1px solid rgba(255,255,255,.14);padding:9px 14px;border-radius:99px;color:#F5F5F7}
.glass-bar{position:absolute;bottom:30px;left:16px;right:16px;background:rgba(28,28,30,.66);border:1px solid rgba(255,255,255,.14);border-radius:34px;padding:12px 18px;display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#ddd}
.card{position:absolute;border-radius:28px;background:rgba(255,255,255,.88);box-shadow:0 30px 60px -18px rgba(20,25,45,.35),0 0 0 1px rgba(255,255,255,.6) inset;color:#111;display:flex;gap:18px;align-items:center}
.dark .card{background:rgba(28,28,30,.78);color:#F5F5F7;box-shadow:0 30px 60px -18px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.12) inset}
.check{width:44px;height:44px;flex:none;border-radius:50%;background:#30D158;display:grid;place-items:center}
.brand{position:absolute;display:flex;align-items:center;gap:14px;font-weight:700;letter-spacing:-.02em}
.brand img{border-radius:22%;box-shadow:0 6px 16px rgba(0,0,0,.18)}
.count{position:absolute;font:600 22px Plex,monospace;letter-spacing:.06em}
h1{font-weight:700;letter-spacing:-.045em;line-height:1;text-wrap:balance}
h1 em{font-style:normal}
.sub{line-height:1.38;text-wrap:pretty}
.grain{position:absolute;inset:0;opacity:.06;mix-blend-mode:overlay;pointer-events:none;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/></filter><rect width='200' height='200' filter='url(%23n)'/></svg>")}`;
}

/** What the proof cards say for each screen: plain promises, never numbers. */
export const PROOF: Record<Screen, [string, string][]> = {
  library: [
    ['All photos safe', 'Full quality, in the cloud'],
    ['Phone space back', 'After every photo is backed up'],
  ],
  'free-space': [
    ['Nothing lost', 'Removed only after the backup is checked'],
    ['Space back in one tap', ''],
  ],
  'storage-full': [
    ['Back up first', 'Then free the space safely'],
    ['Full quality', 'No compression'],
  ],
  backup: [
    ['Original quality', 'Photos and 4K video, untouched'],
    ['Backs up on its own', 'You choose Wi-Fi or mobile data'],
  ],
  viewer: [
    ['Safe before it leaves your phone', ''],
    ['Full quality, always', ''],
  ],
  'qr-album': [
    ['One QR code', 'Every guest’s photos in one album'],
    ['Guests need no app to add', ''],
  ],
  camera: [
    ['Shoot without worrying', 'Lens backs it all up'],
    ['Night mode built in', ''],
  ],
};

const card = (x: number, y: number, title: string, sub = '', width = 440) =>
  `<div class="card" style="left:${Math.round(x)}px;top:${Math.round(y)}px;padding:24px 28px;width:${width}px"><span class="check">${TICK(24, '#fff')}</span><div><div style="font-weight:700;font-size:26px;line-height:1.15">${esc(title)}</div>${sub ? `<div style="opacity:.62;font-size:20px;margin-top:3px">${esc(sub)}</div>` : ''}</div></div>`;

function headline(text: string, size: number, accent: string, dark = false) {
  const [a, b] = splitHeadline(text);
  return `<h1 style="font-size:${size}px;color:${dark ? '#fff' : '#0d0f14'}">${esc(a)}${b ? `<br><em style="color:${accent}">${esc(b)}</em>` : ''}</h1>`;
}

const ARROW = (color: string, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

/** One designed image as a self-contained HTML page (nothing loaded from the network). */
export function designHtml(d: Design): string {
  const portrait = d.h / d.w >= 1.1;
  // Design space: portrait 1080 wide, wide 627 tall; scaled to the real size.
  const W = portrait ? 1080 : Math.round((d.w * 627) / d.h);
  const H = portrait ? Math.round((d.h * 1080) / d.w) : 627;
  const k = d.w / W;
  const blue = d.brand.colors.primary;
  const yellow = d.brand.colors.accent;
  const seed = (d.index ?? 1) * 5;
  const backdrop = BACKDROPS[((d.index ?? 1) - 1) % BACKDROPS.length];
  const offer = d.body.trim() || '10 GB free forever. No card needed.';
  const count = (dark: boolean) => (d.total && d.total > 1 ? `<div class="count" style="right:80px;top:84px;color:${dark ? 'rgba(255,255,255,.7)' : '#8a8f99'}">${d.index}/${d.total}</div>` : '');
  const brandMark = (x: number, y: number, dark: boolean, size = 30) =>
    `<div class="brand" style="left:${x}px;top:${y}px;color:${dark ? '#fff' : '#111'};font-size:${size}px"><img src="${d.icon}" style="width:${Math.round(size * 1.6)}px;height:${Math.round(size * 1.6)}px">Lens</div>`;
  const screen = (s: Screen) => screenHtml(s, d, seed);
  const proof = PROOF[d.screen];
  const fanCard = (i: number, x: number, y: number, r: number, w: number, h: number, border: number) =>
    `<div style="position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${Math.round(w * 0.09)}px;${bg(pick(d.pool, seed + i))};transform:rotate(${r}deg);box-shadow:0 30px 60px -20px rgba(20,25,45,.45);border:${border}px solid #fff"></div>`;
  let body = '';

  if (portrait) {
    const extra = H - 1350; // pin and story are taller: grow the phone, keep the text where the eye lands
    const grow = 1 + Math.max(0, extra) / 2600;
    const textTop = 180 + Math.max(0, extra) * 0.22;
    const tall = extra > 400; // stories: the text gets the full width
    const phoneY = (scale: number) => H - 880 * scale + 40;
    if (d.layout === 'cta') {
      const fan = ([[40, 60, -14], [230, 20, -5], [415, 0, 2], [610, 20, 9], [790, 70, 16]] as const).map(([x, y, r], i) => fanCard(i, x, H - 560 + y, r, 250, 320, 8)).join('');
      body = `<div style="position:absolute;inset:0;background:radial-gradient(80% 60% at 50% 15%,#dbe8ff 0%,transparent 70%),linear-gradient(180deg,#f8f9fc,#eef0f6)"></div>${count(false)}
<div style="position:absolute;left:60px;right:60px;top:${Math.round(120 + extra * 0.2)}px;text-align:center;color:#0d0f14">
 <img src="${d.icon}" style="width:190px;height:190px;border-radius:44px;box-shadow:0 30px 60px -15px rgba(0,60,160,.4)">
 <h1 style="margin-top:40px;font-size:${fitSize(d.cta, 920, 92, 1)}px">${esc(d.cta)}</h1>
 <div class="sub" style="margin-top:16px;font-size:32px;color:#4a505c">${esc(offer)}</div>
 <div style="display:inline-flex;gap:14px;align-items:center;margin-top:36px;background:${blue};color:#fff;font-weight:600;font-size:30px;padding:22px 42px;border-radius:99px;box-shadow:0 20px 40px -12px ${blue}88">${esc(d.site)} ${ARROW('#fff', 28)}</div>
</div>${fan}`;
    } else if (d.layout === 'compare') {
      const s = 1.03 * grow;
      const y = phoneY(s) + 30;
      const pw = 418 * s;
      body = `<div style="position:absolute;inset:0;background:${BACKDROPS[1]}"></div>${brandMark(80, 72, false)}${count(false)}
<div style="position:absolute;left:80px;right:80px;top:${Math.round(150 + extra * 0.15)}px;text-align:center">${headline(d.headline, fitSize(d.headline, 920, 80, 2), blue)}${d.body ? `<div class="sub" style="margin-top:18px;font-size:30px;color:#4a505c">${esc(d.body)}</div>` : ''}</div>
${phone(screen('storage-full'), 540 - pw - 18, y, s)}${phone(screen('free-space'), 540 + 18, y, s)}
<div style="position:absolute;left:${Math.round(540 - 18 - pw / 2 - 72)}px;top:${Math.round(y - 82)}px;background:#FF453A;color:#fff;font:600 22px Plex,monospace;letter-spacing:.1em;padding:12px 26px;border-radius:99px;box-shadow:0 12px 30px rgba(255,69,58,.35)">BEFORE</div>
<div style="position:absolute;left:${Math.round(540 + 18 + pw / 2 - 64)}px;top:${Math.round(y - 82)}px;background:#30D158;color:#04210d;font:600 22px Plex,monospace;letter-spacing:.1em;padding:12px 26px;border-radius:99px;box-shadow:0 12px 30px rgba(48,209,88,.35)">AFTER</div>`;
    } else if (d.layout === 'moment') {
      const s = 0.95 * grow;
      body = `<div style="position:absolute;inset:0;${bg(d.photo ?? pick(d.pool, seed))};filter:saturate(1.08) contrast(1.05)"></div>
<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(5,8,20,.86) 0%,rgba(5,8,20,.3) 34%,rgba(5,8,20,.2) 55%,rgba(5,8,20,.92) 100%)"></div>${brandMark(80, 72, true)}${count(true)}
<div style="position:absolute;left:80px;top:${Math.round(textTop - 10)}px;width:900px">${headline(d.headline, fitSize(d.headline, 900, 84, 2), yellow, true)}${d.body ? `<div class="sub" style="margin-top:22px;font-size:30px;color:rgba(255,255,255,.82);width:760px">${esc(d.body)}</div>` : ''}</div>
${phone(screen(d.screen === 'library' ? 'viewer' : d.screen), 600, phoneY(s) + 70, s, 4)}
<div class="dark" style="position:absolute;inset:0">${card(80, H - 560, proof[0][0], proof[0][1])}${card(80, H - 330, proof[1][0], proof[1][1])}</div>`;
    } else if (d.layout === 'phone') {
      const s = 1.0 * grow;
      body = `<div style="position:absolute;inset:0;background:${backdrop}"></div>${brandMark(80, 72, false)}${count(false)}
<div style="position:absolute;left:80px;right:80px;top:${Math.round(textTop - 30)}px">${headline(d.headline, fitSize(d.headline, 920, 76, 2), blue)}${d.body ? `<div class="sub" style="margin-top:20px;font-size:29px;color:#4a505c;max-width:900px">${esc(d.body)}</div>` : ''}</div>
${phone(screen(d.screen), 540 - 209 * s + 90, phoneY(s) + 110, s)}
${card(60, H - 380, proof[0][0], proof[0][1], 380)}`;
    } else {
      const s = 1.08 * grow;
      body = `<div style="position:absolute;inset:0;background:${backdrop}"></div>${brandMark(80, 72, false)}${count(false)}
<div style="position:absolute;left:80px;top:${Math.round(textTop)}px;width:${tall ? 900 : 620}px">${headline(d.headline, tall ? fitSize(d.headline, 900, 112, 3) : fitSize(d.headline, 600, 96, 3), blue)}${d.body ? `<div class="sub" style="margin-top:30px;font-size:${tall ? 34 : 30}px;color:#4a505c;width:${tall ? 760 : 450}px">${esc(d.body)}</div>` : ''}</div>
${phone(screen(d.screen), 590, phoneY(s), s, -6)}
${card(80, H - 660, proof[0][0], proof[0][1])}${card(150, H - 490, proof[1][0], proof[1][1], 380)}`;
    }
  } else {
    // Wide (LinkedIn/X 1200×627, YouTube 1280×720): text left, phone right.
    const dark = d.layout === 'moment';
    const scr: Screen = d.layout === 'compare' ? 'free-space' : dark && d.screen === 'library' ? 'viewer' : d.screen;
    if (d.layout === 'cta') {
      const fan = [0, 1, 2].map((i) => fanCard(i, W - 470 + i * 140, 150 + [30, 0, 40][i], [-10, 2, 12][i], 200, 260, 7)).join('');
      body = `<div style="position:absolute;inset:0;background:${BACKDROPS[0]}"></div>
<div style="position:absolute;left:64px;top:110px;width:${W - 620}px"><img src="${d.icon}" style="width:110px;height:110px;border-radius:26px;box-shadow:0 20px 40px -12px rgba(0,60,160,.4)">
<h1 style="margin-top:28px;font-size:${fitSize(d.cta, W - 620, 66, 1)}px;color:#0d0f14">${esc(d.cta)}</h1><div class="sub" style="margin-top:14px;font-size:24px;color:#4a505c">${esc(offer)}</div>
<div class="mono" style="margin-top:22px;font-size:18px;font-weight:600;color:${blue};letter-spacing:.04em">${esc(d.site.toUpperCase())}</div></div>${fan}`;
    } else {
      body = `<div style="position:absolute;inset:0;${dark ? bg(d.photo ?? pick(d.pool, seed)) : `background:${backdrop}`}"></div>
${dark ? '<div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,8,20,.92) 0%,rgba(5,8,20,.7) 45%,rgba(5,8,20,.2) 100%)"></div>' : ''}
${brandMark(64, 52, dark, 26)}
<div style="position:absolute;left:64px;top:140px;width:${W - 640}px">${headline(d.headline, fitSize(d.headline, W - 640, 66, 3), dark ? yellow : blue, dark)}${d.body ? `<div class="sub" style="margin-top:20px;font-size:23px;color:${dark ? 'rgba(255,255,255,.8)' : '#4a505c'}">${esc(d.body)}</div>` : ''}
<div class="mono" style="margin-top:24px;font-size:17px;font-weight:600;color:${dark ? 'rgba(255,255,255,.7)' : '#5a606b'};letter-spacing:.04em">${esc(d.site.toUpperCase())}</div></div>
${phone(screen(scr), W - 380, 70, 0.78, -7)}
<div class="${dark ? 'dark' : ''}" style="position:absolute;inset:0"><div class="card" style="left:${W - 560}px;top:${H - 190}px;padding:16px 20px"><span class="check" style="width:38px;height:38px">${TICK(20, '#fff')}</span><div style="font-weight:700;font-size:20px">${esc(proof[0][0])}</div></div></div>`;
    }
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${css(d)}</style></head><body>
<div class="stage" style="width:${W}px;height:${H}px;transform:scale(${k.toFixed(4)})">${body}<div class="grain"></div></div>
</body></html>`;
}
