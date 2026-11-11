// AI-designed content images (docs/growth/content-engine.md, phase 3, owner request 2026-11-04): Claude
// designs every image of a post fresh, as HTML/CSS, from a kit of real parts — the phone with real Lens
// screens, rights-checked photos, the app icon, brand colours and fonts. Code decides what ships:
//   1. the HTML is cleaned (no scripts, handlers, external URLs, <img>) and the page forbids scripts (CSP);
//   2. after drawing, checks run in the page: text inside the frame, not under the phone, not on other text,
//      readable size, the app icon present; then in code: only the post's own words (+ a few labels), no
//      numbers the post didn't say, no forbidden claims, no emoji;
//   3. images that fail get one fix round with their problems listed; still failing → the template
//      (growth-design.ts) for that image. Make images never comes back empty.
import type { Brand } from './growth-brand';
import { bg, css, esc, phone, screenHtml, SCREENS, TICK, type Screen } from './growth-design';
import type { Frame } from './growth-media';
import { FORBIDDEN_CLAIMS } from './growth-report';

export type KitPhoto = { ref: string; url: string; about: string; w: number; h: number };
export type AiDesign = { label: string; idea: string; html: string };

/** Design space: portrait images are 1080 wide, wide ones 627 tall (then scaled to the real size). */
export function designSpace(w: number, h: number): { W: number; H: number; k: number } {
  const portrait = h / w >= 1.1;
  const W = portrait ? 1080 : Math.round((w * 627) / h);
  const H = portrait ? Math.round((h * 1080) / w) : 627;
  return { W, H, k: w / W };
}

export const DESIGN_SYSTEM = `You are a senior visual designer at a top consumer-app studio, designing social media images for Lens, a camera and photo-backup app (lens.instagrowapp.com). The bar is an Apple or Google Photos launch campaign: confident, clean, premium, one clear focal point per image. Never generic stock-ad looks, never "text on a background".

You design each image as HTML + CSS on a fixed canvas. You get a kit of REAL parts; use them instead of drawing your own versions:
- <lens-phone screen="SCREEN" x="" y="" scale="" rotate="" photo=""></lens-phone>
  The real Lens app on a phone. Phone size at scale 1 is 418×872 px; x,y = its top-left corner on the canvas; rotate in degrees (−12…12 looks natural). SCREEN is one of: ${SCREENS.join(', ')}. library = the photo roll; backup = backup progress; free-space = space freed after backup; storage-full = a full phone (use it for "before"); viewer = one photo open in Lens with a green Safe pill; qr-album = an event album with a QR code for guests; camera = the Lens camera with Night mode. photo="pN" chooses the photo for viewer/camera. title="" names the event album on qr-album: always set it from the post (2–4 words, e.g. title="Class 3B Children's Day", "Riya & Kabir's wedding"). The photo grids inside the app show this post's own photos. Choose the screen that shows THIS slide's point (storage-full only for the problem of a full phone, qr-album for sharing one album, library for everyone's photos together, viewer for one photo at full quality).
- <lens-photo src="pN" x="" y="" w="" h="" radius="" rotate="" border=""></lens-photo>
  A photo from the list, cropped to fill w×h. border = white frame width in px (0 = none). For a full-bleed background use x="0" y="0" and the canvas size.
  In your own CSS you may also use url(photo:pN) as a background-image.
- <lens-icon x="" y="" size=""></lens-icon> The Lens app icon (rounded square). REQUIRED once on every image, size ≥ 44.
- <lens-check size=""></lens-check> A green circle with a white tick, for proof points.

Canvas: an absolutely positioned box of the given W×H px (overflow hidden). Position everything with position:absolute and px. Phones and photos may bleed off an edge on purpose; text never does.
Fonts: font-family:Geist (weights 300–800) for all text; font-family:Plex (monospace, 500/600) only for small uppercase labels. Colours (CSS variables): --blue (brand primary), --yellow (brand accent), --green #30D158, --red #FF453A, --ink #0d0f14, --muted #4a505c, --paper #f4f4f6. Bright, airy backgrounds (soft gradients, gentle colour blobs) or a full photo with a dark scrim for night/emotional moments.
You may use any CSS (gradients, shadows, blur, transforms, clip-path, mix-blend-mode) and inline <svg> you draw yourself (arrows, underlines, circles, shapes). Not allowed: <script>, event handlers, <img>/<video>/<iframe>/<link>, external URLs, @import, other fonts, emoji.
Never draw illustrations: no people, faces, hands, fingers, bodies, children, animals, or drawn objects (lamps, bags, stages, curtains, furniture, food). Clip-art and cartoon figures look cheap. Drawn shapes are only abstract: lines, arrows, underlines, rings, bursts, light, glows, grids. When a scene has no footage or photo, make it type-led: big bold words, colour and light, and the real product parts from the kit.

Words — strict:
- Use the image's headline words exactly (you may break lines and colour some words, e.g. the second sentence in --blue). Use the body only if it helps; you may leave it out. The call-to-action image uses the CTA, the offer line and the site.
- You may add at most 6 short label words of your own (like BEFORE, AFTER, STEP 1, NEW). Nothing else.
- No numbers except those in the given words. Never "unlimited", "best", "#1", "shot on Lens". English only.

Craft:
- Headline is the biggest thing: at least 72px on portrait canvases and 46px on wide ones, weight 700, letter-spacing about −0.04em, line-height ~1. Margins ≥ 64px from the canvas edge for all text.
- Text never sits under, over or behind a phone or another text block. Keep at least 32px between them.
- Dark text on light backgrounds; white text on photos only over a dark scrim (linear-gradient) so it reads.
- One idea per image. Vary composition across the post: no two images of a post with the same arrangement. The first image must stop the scroll.
- Use the phone screen that proves the point (backup for safety, free-space for space, storage-full → free-space for before/after, qr-album for events, camera for shooting, viewer for one moment).

For each image return: label (exactly as given), idea (one line: your composition), html (only the markup that goes inside the canvas; it may start with one <style> block; no <html>/<head>/<body>).`;

export const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['designs'],
  properties: {
    designs: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['label', 'idea', 'html'], properties: { label: { type: 'string' }, idea: { type: 'string' }, html: { type: 'string' } } },
    },
  },
} as const;

/** The task for one post: every image with its canvas, words and suggested screen, plus the photo list. */
export function designPrompt(post: { title: string; format: string }, list: Frame[], photos: KitPhoto[], brand: Brand, cta: string, offer: string, site: string, problems?: Map<string, string[]>): string {
  const imgs = list.map((f) => {
    const { W, H } = designSpace(f.w, f.h);
    const role = f.style === 'cta' ? 'call to action (last slide)' : f.total ? `slide ${f.index} of ${f.total}${f.style === 'cover' ? ' (cover)' : ''}` : 'single image';
    const words = f.style === 'cta' ? `CTA: "${cta}" | offer: "${offer}" | site: "${site}"` : `headline: "${f.headline}"${f.body ? ` | body: "${f.body}"` : ''}`;
    const fix = problems?.get(f.label);
    return `- label "${f.label}" · canvas ${W}×${H} · ${role} · for ${f.for.join(', ') || 'any platform'} · suggested screen: ${f.screen}${f.query ? ` · scene: ${f.query}` : ''}\n  ${words}${fix ? `\n  YOUR LAST DESIGN HAD THESE PROBLEMS, fix them: ${fix.join('; ')}` : ''}`;
  });
  const ph = photos.map((p) => `- ${p.ref}: ${p.about.slice(0, 90)} (${p.w}×${p.h}${p.w > p.h ? ', landscape' : ', portrait'})`);
  return `Design ${problems ? 'again only the images below of' : 'every image of'} this post.
Post: "${post.title}" (${post.format}). Brand colours: primary ${brand.colors.primary}, accent ${brand.colors.accent}.

Images:
${imgs.join('\n')}

Photos you may use (licences already checked; scenery and things, not Lens photos). Use a photo only where it clearly belongs with that image's message; otherwise use the phone, colour and type. Never use one just to fill space:
${ph.join('\n') || '- none: design with the phone, colour and type only'}`;
}

// ---------- cleaning and expanding (pure) ----------

const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([a-zA-Z][\w-]*)\s*=\s*"([^"]*)"/g)].map((m) => [m[1].toLowerCase(), m[2]]));
const num = (v: string | undefined, d: number, min = -5000, max = 5000) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

/** Remove anything that could run code or reach the network. */
export function sanitizeDesign(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(script|iframe|object|embed|link|meta|base|form|input|button|img|video|audio|source|picture|frame|frameset|html|head|body|foreignobject|use|image)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/javascript:|vbscript:|expression\s*\(/gi, '')
    .replace(/url\(\s*(['"]?)(?!photo:|#|data:image\/svg\+xml)[^)]*\)/gi, 'none');
}

/** Kit tags → real markup; url(photo:pN) → the in-memory photo. Unknown refs fall back to the first photo. */
export function expandKit(html: string, photos: KitPhoto[], icon: string, pool: string[]): string {
  const photo = (ref: string | undefined) => photos.find((p) => p.ref === ref)?.url ?? photos[0]?.url;
  return html
    .replace(/<lens-phone\b([^>]*)>(?:\s*<\/lens-phone>)?/gi, (_, a: string) => {
      const x = attrs(a);
      const screen = (SCREENS as readonly string[]).includes(x.screen) ? (x.screen as Screen) : 'library';
      return phone(screenHtml(screen, { pool, photo: x.photo ? photo(x.photo) : undefined, title: x.title ? x.title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").slice(0, 40) : undefined }, 3), num(x.x, 0), num(x.y, 0), num(x.scale, 1, 0.3, 2.5), num(x.rotate, 0, -30, 30));
    })
    .replace(/<lens-photo\b([^>]*)>(?:\s*<\/lens-photo>)?/gi, (_, a: string) => {
      const x = attrs(a);
      const border = num(x.border, 0, 0, 40);
      return `<div class="kit-photo" style="position:absolute;left:${num(x.x, 0)}px;top:${num(x.y, 0)}px;width:${num(x.w, 300, 10, 5000)}px;height:${num(x.h, 300, 10, 5000)}px;border-radius:${num(x.radius, 0, 0, 2000)}px;transform:rotate(${num(x.rotate, 0, -45, 45)}deg);${bg(photo(x.src))};${border ? `border:${border}px solid #fff;box-shadow:0 30px 60px -20px rgba(20,25,45,.45);` : ''}"></div>`;
    })
    .replace(/<lens-icon\b([^>]*)>(?:\s*<\/lens-icon>)?/gi, (_, a: string) => {
      const x = attrs(a);
      const s = num(x.size, 64, 24, 400);
      return `<img class="lens-icon" src="${icon}" style="position:absolute;left:${num(x.x, 64)}px;top:${num(x.y, 64)}px;width:${s}px;height:${s}px;border-radius:22%;box-shadow:0 ${Math.round(s / 6)}px ${Math.round(s / 2)}px -${Math.round(s / 8)}px rgba(0,40,120,.35)">`;
    })
    .replace(/<lens-check\b([^>]*)>(?:\s*<\/lens-check>)?/gi, (_, a: string) => {
      const s = num(attrs(a).size, 44, 16, 200);
      return `<span class="check" style="width:${s}px;height:${s}px;display:inline-grid">${TICK(Math.round(s * 0.55), '#fff')}</span>`;
    })
    .replace(/url\(\s*['"]?photo:(p\d+)['"]?\s*\)/gi, (_, ref: string) => `url(${photo(ref) ?? 'none'})`);
}

/** The full page for one AI design (scripts forbidden by policy as well as removed). */
export function aiPageHtml(fr: Pick<Frame, 'w' | 'h'>, html: string, ctx: { photos: KitPhoto[]; pool: string[]; icon: string; brand: Brand; fonts: { geist?: string; plex500?: string; plex600?: string } }): string {
  const { W, H, k } = designSpace(fr.w, fr.h);
  const c = ctx.brand.colors;
  const body = expandKit(sanitizeDesign(html), ctx.photos, ctx.icon, ctx.pool);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https://img.lens; style-src 'unsafe-inline'; font-src data:"><style>${css({ w: fr.w, h: fr.h, fonts: ctx.fonts })}
:root{--blue:${c.primary};--yellow:${c.accent};--green:#30D158;--red:#FF453A;--ink:#0d0f14;--muted:#4a505c;--paper:#f4f4f6}
.canvas{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:hidden;transform:scale(${k.toFixed(4)});transform-origin:0 0;background:var(--paper);font-family:Geist,sans-serif;color:var(--ink)}
.check{border-radius:50%;background:#30D158;place-items:center;flex:none}</style></head><body><div class="canvas" data-w="${W}" data-h="${H}">${body}<div class="grain"></div></div></body></html>`;
}

// ---------- checks ----------

/** Runs in the page after drawing: layout problems and the words people will see (outside phone screens). */
export const PAGE_CHECK = `(() => {
  const canvas = document.querySelector('.canvas');
  const cr = canvas.getBoundingClientRect();
  const k = cr.width / Number(canvas.dataset.w);
  const problems = [];
  const phones = [...canvas.querySelectorAll('.phone')].map((e) => e.getBoundingClientRect());
  const lines = [];
  const words = [];
  const walker = document.createTreeWalker(canvas, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim();
    const el = n.parentElement;
    if (!t || !el || el.closest('.phone') || el.closest('style')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
    words.push(t);
    const size = parseFloat(cs.fontSize) * k;
    if (size < 18 * k) problems.push('text "' + t.slice(0, 30) + '" is too small (' + Math.round(size / k) + 'px, use at least 18px)');
    const r = document.createRange();
    r.selectNodeContents(n);
    for (const b of r.getClientRects()) {
      if (b.width < 2 || b.height < 2) continue;
      lines.push({ b, el, t });
      const m = 24 * k;
      if (b.left < cr.left + m || b.top < cr.top + m || b.right > cr.right - m || b.bottom > cr.bottom - m) problems.push('text "' + t.slice(0, 30) + '" runs off the canvas or closer than 24px to the edge');
      for (const p of phones) {
        const ix = Math.min(b.right, p.right) - Math.max(b.left, p.left);
        const iy = Math.min(b.bottom, p.bottom) - Math.max(b.top, p.top);
        if (ix > 6 * k && iy > 6 * k) problems.push('text "' + t.slice(0, 30) + '" overlaps the phone');
      }
    }
  }
  for (let i = 0; i < lines.length; i++)
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i], c = lines[j];
      if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
      const ix = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left);
      const iy = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
      if (ix > 4 * k && iy > 4 * k) problems.push('text "' + a.t.slice(0, 20) + '" overlaps text "' + c.t.slice(0, 20) + '"');
    }
  const icon = canvas.querySelector('.lens-icon');
  const ir = icon && icon.getBoundingClientRect();
  if (!ir || ir.width < 36 * k || ir.right < cr.left || ir.left > cr.right || ir.bottom < cr.top || ir.top > cr.bottom) problems.push('the Lens icon is missing, too small or off the canvas');
  return { problems: [...new Set(problems)].slice(0, 8), text: words.join(' ') };
})()`;

const wordsOf = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}’']+/gu) ?? []).map((w) => w.replace(/[’']s$/, '').replace(/[’']/g, ''));

/** Words checks: only the post's own words plus a few labels, no new numbers, no forbidden claims, no emoji. */
export function wordProblems(seen: string, allowed: string): string[] {
  const out: string[] = [];
  const ok = new Set(wordsOf(allowed));
  const extra = [...new Set(wordsOf(seen).filter((w) => !ok.has(w)))];
  const newNumbers = extra.filter((w) => /\d/.test(w));
  if (newNumbers.length) out.push(`numbers not in the post: ${newNumbers.slice(0, 4).join(', ')}`);
  const newWords = extra.filter((w) => !/\d/.test(w));
  if (newWords.length > 6) out.push(`too many words of your own (${newWords.length}): ${newWords.slice(0, 8).join(', ')}; use the post's words`);
  // A claim only counts when the design adds it (the post's own words were checked when it was written).
  const claims = (t: string) => (t.match(new RegExp(`${FORBIDDEN_CLAIMS.source}|\\b(best|number one|shot on lens)\\b|#1\\b`, 'gi')) ?? []).length;
  if (claims(seen) > claims(allowed)) out.push('a claim we never make (unlimited, best, #1, shot on Lens)');
  if (/\p{Extended_Pictographic}/u.test(seen)) out.push('emoji (the font can’t draw them)');
  return out;
}

/** Claude's designs by label (unknown labels and oversized HTML dropped). */
export function designsByLabel(r: { designs?: AiDesign[] } | undefined, labels: string[]): Map<string, AiDesign> {
  const out = new Map<string, AiDesign>();
  for (const d of r?.designs ?? []) if (labels.includes(d.label) && typeof d.html === 'string' && d.html.length < 60_000) out.set(d.label, d);
  return out;
}
