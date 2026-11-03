// Render engine for content packages (docs/growth/content-engine.md, phase 3): a post becomes on-brand
// images at each platform's size — carousel slides, story and reel covers, pins, LinkedIn/X images and
// YouTube thumbnails — drawn as HTML from the brand kit and screenshotted in the GrowthAnalyst's headless
// Chromium (₹0, no AI image service). Each image is saved as a Library asset (kind "render", made by us,
// rights cleared) and listed on the post as `renders`. Rendering again overwrites the same files.
// English text uses Geist (bundled in ./brand); Devanagari needs a font added there first.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, Res, s3 } from '../api/lib';
import type { Asset, AssetRef } from './growth-assets';
import { brand as loadBrand, type Brand } from './growth-brand';
import type { Platform, Slide, Scene } from './growth-content-rules';
import { launchBrowser } from './growth-render';

const BUCKET = process.env.GROWTH_CONTENT_BUCKET ?? '';
const BRAND_DIR = process.env.GROWTH_BRAND_DIR ?? join(__dirname, 'brand');
const SITE = 'lens.instagrowapp.com';

export type Frame = { label: string; w: number; h: number; style: 'cover' | 'slide' | 'cta'; headline: string; body: string; index?: number; total?: number };
type PostLike = { id: string; format: string; hook: string; slides: Slide[]; script: Scene[]; variants: Partial<Record<Platform, unknown>>; assets?: AssetRef[] };

// ---------- frames (pure) ----------

const SIZES = {
  feed: [1080, 1350],
  story: [1080, 1920],
  pin: [1000, 1500],
  wide: [1200, 627],
  thumb: [1280, 720],
} as const;

/** Which images a post needs: by format, plus the extra sizes its platforms take. */
export function frames(p: PostLike, cta: string): Frame[] {
  const has = (k: Platform) => !!p.variants[k];
  const hook = p.hook.trim() || p.slides[0]?.headline || p.script[0]?.onScreen || '';
  const lead = p.slides[0];
  const f = (label: string, size: readonly [number, number], style: Frame['style'], headline: string, body = ''): Frame => ({ label, w: size[0], h: size[1], style, headline, body });
  const out: Frame[] = [];
  if (p.format === 'carousel') {
    const slides = p.slides.length ? p.slides : [{ headline: hook, body: '', visual: '' }];
    slides.forEach((s, i) => {
      const style = i === 0 ? 'cover' : i === slides.length - 1 && slides.length > 2 ? 'cta' : 'slide';
      out.push({ ...f(`Slide ${i + 1}`, SIZES.feed, style, s.headline || (i === 0 ? hook : '') || (style === 'cta' ? cta : ''), s.body), index: i + 1, total: slides.length });
    });
    if (has('linkedin')) out.push(f('LinkedIn image', SIZES.wide, 'cover', hook, lead?.body ?? ''));
  } else if (p.format === 'reel' || p.format === 'short' || p.format === 'story') {
    out.push(f(p.format === 'story' ? 'Story' : 'Cover', SIZES.story, 'cover', hook, p.format === 'story' ? (lead?.body ?? '') : ''));
    if (has('youtube')) out.push(f('YouTube thumbnail', SIZES.thumb, 'cover', hook));
  } else if (p.format === 'pin') {
    out.push(f('Pin', SIZES.pin, 'cover', hook, lead?.body ?? ''));
  } else if (p.format === 'thread' || p.format === 'article') {
    out.push(f('Header image', SIZES.wide, 'cover', hook, lead?.body ?? ''));
  } else {
    out.push(f('Post image', SIZES.feed, 'cover', hook, lead?.body ?? ''));
    if (has('linkedin') || has('x')) out.push(f('Wide image', SIZES.wide, 'cover', hook, lead?.body ?? ''));
    if (has('pinterest')) out.push(f('Pin', SIZES.pin, 'cover', hook, lead?.body ?? ''));
  }
  return out.filter((x) => x.headline.trim() || x.body.trim());
}

/** Only what the bundled Geist (Latin) can draw: Lambda's Chromium has no fallback fonts, so anything else
 *  would show as a box. Captions keep emoji and ₹; the images say "Rs" and drop emoji. */
export function drawable(text: string): string {
  return text
    .replace(/₹\s?/g, 'Rs ')
    .replace(/→/g, '->')
    .replace(/[^\u0000-\u00FF\u0131\u0152\u0153\u02BB\u02BC\u02C6\u02DA\u02DC\u2000-\u206F\u20AC\u2122\u2191\u2193\u2212\u2215]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Headline size: big for short lines, smaller for long ones, scaled to the frame. */
export function headlineSize(text: string, w: number, h: number): number {
  const n = [...text].length;
  const base = Math.min(Math.sqrt(w * h) * 0.9, w * 1.2);
  const k = n <= 24 ? 0.11 : n <= 48 ? 0.088 : n <= 90 ? 0.07 : 0.056;
  return Math.round(base * k);
}

/** One frame as a self-contained HTML page (fonts and images inline, nothing loaded from the network). */
export function frameHtml(fr: Frame, brand: Brand, opts: { font?: string; mark?: string; photo?: string; background?: string } = {}): string {
  const c = brand.colors;
  const wide = fr.w / fr.h > 1.3;
  const pad = Math.round(Math.min(fr.w, fr.h) * 0.075);
  const hs = headlineSize(fr.headline, fr.w, fr.h);
  const bs = Math.round(hs * 0.42);
  const small = Math.round(Math.min(fr.w, fr.h) * 0.026);
  const photo = opts.photo && fr.style === 'cover';
  const counter = fr.total && fr.total > 1 ? `<div class="count">${fr.index}/${fr.total}</div>` : '';
  const arrow = `<svg viewBox="0 0 24 24" width="${small}" height="${small}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;
  const next = fr.style !== 'cta' && fr.total && fr.index! < fr.total ? `<div class="next">Swipe ${arrow}</div>` : '';
  const action = fr.style === 'cta' ? `<div class="action">${esc(drawable(brand.ctas[0] ?? 'Try Lens free'))}</div><div class="url">${SITE}</div>` : '';
  const showUrl = fr.style !== 'cta';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${opts.font ? `@font-face{font-family:Geist;src:url(data:font/woff2;base64,${opts.font}) format('woff2');font-weight:300 800}` : ''}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${fr.w}px;height:${fr.h}px;overflow:hidden}
body{font-family:Geist,system-ui,sans-serif;color:${c.text};background:radial-gradient(120% 90% at 15% 0%,${c.surface} 0%,${c.background} 62%);position:relative;padding:${pad}px;display:flex;flex-direction:column;gap:${Math.round(pad * 0.5)}px}
${opts.background ? `.bg{position:absolute;inset:0;background:url(${opts.background}) center/cover;opacity:.28}` : ''}
.glow{position:absolute;border-radius:50%;filter:blur(${Math.round(pad * 1.2)}px);pointer-events:none}
.g1{width:${Math.round(fr.w * 0.7)}px;height:${Math.round(fr.w * 0.7)}px;right:-${Math.round(fr.w * 0.25)}px;bottom:-${Math.round(fr.w * 0.2)}px;background:${c.primary};opacity:.32}
.g2{width:${Math.round(fr.w * 0.45)}px;height:${Math.round(fr.w * 0.45)}px;left:-${Math.round(fr.w * 0.15)}px;top:${Math.round(fr.h * 0.12)}px;background:${c.accent};opacity:.10}
.wm{position:absolute;right:-${Math.round(Math.min(fr.w, fr.h) * 0.12)}px;bottom:-${Math.round(Math.min(fr.w, fr.h) * 0.1)}px;width:${Math.round(Math.min(fr.w, fr.h) * 0.62)}px;opacity:.07;transform:rotate(-12deg)}
.wm svg{width:100%;height:auto}
.top{display:flex;align-items:center;justify-content:space-between;position:relative}
.brand{display:flex;align-items:center;gap:${Math.round(small * 0.6)}px;font-weight:700;font-size:${small * 1.25}px;letter-spacing:-.01em}
.brand svg{width:${small * 2}px;height:${small * 2}px}
.count,.next{font-size:${small}px;color:${c.muted};font-weight:500;display:flex;align-items:center;gap:${Math.round(small * 0.3)}px}
.main{flex:1;display:flex;flex-direction:${photo && wide ? 'row' : 'column'};justify-content:${fr.style === 'slide' ? 'flex-start' : 'center'};gap:${pad}px;position:relative;${fr.style === 'slide' ? `padding-top:${pad}px` : ''}}
.text{display:flex;flex-direction:column;gap:${Math.round(pad * 0.45)}px;${photo && wide ? 'flex:1;justify-content:center' : ''}}
.bar{width:${Math.round(hs * 1.2)}px;height:${Math.max(6, Math.round(hs * 0.1))}px;border-radius:99px;background:${c.accent}}
h1{font-size:${hs}px;line-height:1.04;font-weight:750;letter-spacing:-.03em;text-wrap:balance}
p{font-size:${bs}px;line-height:1.32;color:${c.muted};font-weight:450;text-wrap:pretty}
.photo{${wide ? `width:42%;` : `flex:1;min-height:0;`}border-radius:${pad * 0.5}px;background:url(${opts.photo ?? ''}) center/cover;box-shadow:0 ${pad * 0.3}px ${pad}px rgba(0,0,0,.45)}
.action{align-self:flex-start;white-space:nowrap;background:${c.primary};color:#fff;font-weight:650;font-size:${Math.round(bs * 0.95)}px;padding:${Math.round(bs * 0.55)}px ${Math.round(bs * 1.2)}px;border-radius:99px;box-shadow:0 ${Math.round(pad * 0.2)}px ${pad}px ${c.primary}66}
.url{font-size:${Math.round(bs * 0.8)}px;color:${c.muted};font-weight:500}
.foot{display:flex;justify-content:space-between;align-items:center;font-size:${small}px;color:${c.muted};position:relative}
</style></head><body>
${opts.background ? '<div class="bg"></div>' : ''}<div class="glow g1"></div><div class="glow g2"></div>${fr.style === 'cover' && !photo && opts.mark ? `<div class="wm">${opts.mark}</div>` : ''}
<div class="top"><div class="brand">${opts.mark ?? ''}<span>Lens</span></div>${counter}</div>
<div class="main"><div class="text"><div class="bar"></div><h1>${esc(drawable(fr.headline))}</h1>${fr.body ? `<p>${esc(drawable(fr.body))}</p>` : ''}${action}</div>${photo ? '<div class="photo"></div>' : ''}</div>
<div class="foot"><span>${showUrl ? SITE : ''}</span>${next}</div>
</body></html>`;
}

/** Stable per post and frame, so rendering again replaces the same Library file. */
export const renderAssetId = (postId: string, label: string) => createHash('sha256').update(`render|${postId}|${label}`).digest('hex').slice(0, 12);

// ---------- the render job (GrowthAnalyst) ----------

async function dataUrl(a: Asset): Promise<string | undefined> {
  if (!a.mime.startsWith('image/') || a.status !== 'ready') return undefined;
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: a.key }));
  const bytes = await r.Body!.transformToByteArray();
  if (bytes.length > 12 * 1024 * 1024) return undefined;
  return `data:${a.mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** Cleared images the post uses: our own "media" photo goes in the frame, a "background" behind it. */
async function postImages(refs: AssetRef[]): Promise<{ photo?: string; background?: string }> {
  const out: { photo?: string; background?: string } = {};
  for (const r of refs) {
    const a = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${r.id}` } }))).Item as Asset | undefined;
    if (!a || a.kind === 'render' || a.rights.status !== 'cleared') continue;
    if (r.role === 'media' && !out.photo && a.rights.license === 'own') out.photo = await dataUrl(a);
    if (r.role === 'background' && !out.background) out.background = await dataUrl(a);
  }
  return out;
}

export async function renderPost(postId: string, by: string): Promise<{ rendered: number }> {
  if (!BUCKET) throw new Error('Content storage isn’t set up');
  const post = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` } }))).Item as (PostLike & { title: string }) | undefined;
  if (!post) throw new Error(`Post ${postId} is gone`);
  const brand = await loadBrand();
  const list = frames({ ...post, slides: post.slides ?? [], script: post.script ?? [], variants: post.variants ?? {} }, brand.ctas[0] ?? 'Try Lens free');
  if (!list.length) throw new Error('Nothing to draw: give the post a hook or slides first');
  const font = readFileSync(join(BRAND_DIR, 'geist-latin.woff2')).toString('base64');
  const mark = readFileSync(join(BRAND_DIR, 'lens-mark.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');
  const images = await postImages(post.assets ?? []);
  const browser = await launchBrowser();
  const renders: { assetId: string; label: string; w: number; h: number }[] = [];
  try {
    const page = await browser.newPage();
    // Nothing leaves the page: fonts and images are inline.
    await page.setRequestInterception(true);
    page.on('request', (r: { url(): string; continue(): Promise<void>; abort(): Promise<void> }) => void (/^(data|about):/.test(r.url()) ? r.continue() : r.abort()));
    for (const fr of list) {
      await page.setViewport({ width: fr.w, height: fr.h, deviceScaleFactor: 1 });
      await page.setContent(frameHtml(fr, brand, { font, mark, ...images }), { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready');
      const png = Buffer.from(await page.screenshot({ type: 'png' }));
      const id = renderAssetId(postId, fr.label);
      const key = `a/${id}.png`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: png, ContentType: 'image/png' }));
      const asset: Asset & { postId: string; label: string; w: number; h: number } = {
        id,
        name: `${post.title || 'Post'} · ${fr.label}`.slice(0, 160),
        kind: 'render',
        origin: 'template',
        key,
        mime: 'image/png',
        bytes: png.length,
        lensPhoto: false,
        checkedPersonal: true,
        rights: { status: 'cleared', license: 'own', licenseUrl: '', source: '', author: '', credit: '', commercialOk: true, editsOk: true, peopleOrBrands: false, reason: 'Made by Lens from the brand template', checkedAt: Date.now(), checkedBy: 'template' },
        status: 'ready',
        createdAt: Date.now(),
        createdBy: by,
        postId,
        label: fr.label,
        w: fr.w,
        h: fr.h,
      };
      await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `ASSET#${id}`, ...asset } }));
      renders.push({ assetId: id, label: fr.label, w: fr.w, h: fr.h });
    }
  } finally {
    await browser.close();
  }
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` }, UpdateExpression: 'SET renders = :r, renderedAt = :t', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':r': renders, ':t': Date.now() } }));
  return { rendered: renders.length };
}

// ---------- the Console side ----------

const RENDER_MINUTES = 5;

/** POST /growth/posts/<id>/render: one render at a time; the Console polls GET /growth/jobs. */
export async function renderStart(postId: string, by: string): Promise<Res> {
  if (!/^[a-f0-9]{10}$/.test(postId)) throw new HttpError(400, 'Bad post id');
  const post = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` } }))).Item;
  if (!post) throw new HttpError(404, 'No such post');
  const job = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'JOB#render' } }))).Item;
  if (job && !job.finishedAt && Date.now() - job.startedAt < RENDER_MINUTES * 60_000) throw new HttpError(409, 'Images are already being made for another post. Try again in a minute.');
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'JOB#render', startedAt: Date.now(), by, postId } }));
  const { InvokeCommand, LambdaClient } = await import('@aws-sdk/client-lambda');
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.GROWTH_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ render: { postId }, by })) }));
  return json(202, { started: true });
}
