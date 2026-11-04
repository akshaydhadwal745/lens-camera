// Render engine for content packages (docs/growth/content-engine.md, phase 3): a post becomes on-brand
// images at each platform's size — carousel slides, story and reel covers, pins, LinkedIn/X images and
// YouTube thumbnails — designed in growth-design.ts (the real app on a phone, before/after, photo moments,
// proof cards) and screenshotted in the GrowthAnalyst's headless Chromium (₹0, no AI image service).
// Photos come from the post's own assets, else are found live (growth-photos.ts, rights-checked).
// Each image is saved as a Library asset (kind "render", made by us, rights cleared) and listed on the post
// as `renders`. Rendering again overwrites the same files. Fonts: Geist, IBM Plex Mono, Noto Sans
// Devanagari (all OFL, bundled in ./brand).
// Each render also leaves one zip of all the post's images plus where-to-post.txt in x/ (kept 30 days).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, HttpError, json, Res, s3 } from '../api/lib';
import { viewUrl, type Asset, type AssetRef } from './growth-assets';
import { brand as loadBrand } from './growth-brand';
import { PLATFORMS, type Platform, type Slide, type Scene } from './growth-content-rules';
import { runClaude, type Mode } from './growth';
import { aiPageHtml, DESIGN_SCHEMA, DESIGN_SYSTEM, designPrompt, designsByLabel, PAGE_CHECK, wordProblems, type AiDesign, type KitPhoto } from './growth-ai-design';
import { designHtml, type Layout, type Screen } from './growth-design';
import { findPhotos, FITS, PHOTO_CHECK_SCHEMA, PHOTO_CHECK_SYSTEM, photoPassed, photoPool, postTotal, readScores, REDO_BELOW, saveLook, SCORE_SCHEMA, SCORE_SYSTEM, scorePrompt, SHEET_SIZE, sheetHtml, sheetPrompt, sheetVerdicts, type ImageScore, type Photo, type PostScore } from './growth-photos';
import { launchBrowser } from './growth-render';
import { licenseKey } from './growth-rights';

const BUCKET = process.env.GROWTH_CONTENT_BUCKET ?? '';
const BRAND_DIR = process.env.GROWTH_BRAND_DIR ?? join(__dirname, 'brand');
const SITE = 'lens.instagrowapp.com';

/** `for`: the platforms this image is posted to. */
/** `layout`/`screen`: how growth-design.ts draws it; `query`: words to find a scene photo for it. */
export type Frame = { label: string; w: number; h: number; style: 'cover' | 'slide' | 'cta'; headline: string; body: string; for: Platform[]; index?: number; total?: number; layout: Layout; screen: Screen; query?: string };
type PostLike = { id: string; format: string; hook: string; slides: Slide[]; script: Scene[]; variants: Partial<Record<Platform, unknown>>; assets?: AssetRef[] };

// ---------- frames (pure) ----------

const SIZES = {
  feed: [1080, 1350],
  story: [1080, 1920],
  pin: [1000, 1500],
  wide: [1200, 627],
  thumb: [1280, 720],
  x: [1600, 900], // X shows 16:9 images uncropped in the feed
} as const;

/** Which images a post needs: by format, plus the extra sizes its platforms take. */
export function frames(p: PostLike, cta: string): Frame[] {
  const has = (k: Platform) => !!p.variants[k];
  const all = PLATFORMS.filter(has);
  const only = (...ks: Platform[]) => all.filter((k) => ks.includes(k));
  const rest = (...ks: Platform[]) => all.filter((k) => !ks.includes(k));
  const hook = p.hook.trim() || p.slides[0]?.headline || p.script[0]?.onScreen || '';
  const lead = p.slides[0];
  const f = (label: string, size: readonly [number, number], style: Frame['style'], to: Platform[], headline: string, body = ''): Frame => ({ label, w: size[0], h: size[1], style, headline, body, for: to, layout: 'hero', screen: 'library' });
  const out: Frame[] = [];
  const visuals: string[] = [];
  if (p.format === 'carousel') {
    const slides = p.slides.length ? p.slides : [{ headline: hook, body: '', visual: '' }];
    slides.forEach((s, i) => {
      const style = i === 0 ? 'cover' : i === slides.length - 1 && slides.length > 2 ? 'cta' : 'slide';
      out.push({ ...f(`Slide ${i + 1}`, SIZES.feed, style, rest('linkedin', 'x'), s.headline || (i === 0 ? hook : '') || (style === 'cta' ? cta : ''), s.body), index: i + 1, total: slides.length });
      visuals.push(s.visual ?? '');
    });
    if (has('linkedin')) out.push(f('LinkedIn image', SIZES.wide, 'cover', only('linkedin'), hook, lead?.body ?? ''));
    if (has('x')) out.push(f('X image', SIZES.x, 'cover', only('x'), hook, lead?.body ?? ''));
  } else if (p.format === 'reel' || p.format === 'short' || p.format === 'story') {
    const thumb = has('youtube') && p.format !== 'story';
    out.push(f(p.format === 'story' ? 'Story' : 'Cover', SIZES.story, 'cover', thumb ? rest('youtube', 'x') : rest('x'), hook, p.format === 'story' ? (lead?.body ?? '') : ''));
    if (has('x')) out.push(f('X image', SIZES.x, 'cover', only('x'), hook));
    if (thumb) out.push(f('YouTube thumbnail', SIZES.thumb, 'cover', only('youtube'), hook));
  } else if (p.format === 'pin') {
    out.push(f('Pin', SIZES.pin, 'cover', all, hook, lead?.body ?? ''));
  } else if (p.format === 'thread' || p.format === 'article') {
    out.push(f('Header image', SIZES.wide, 'cover', all, hook, lead?.body ?? ''));
  } else {
    out.push(f('Post image', SIZES.feed, 'cover', rest('linkedin', 'x', 'pinterest'), hook, lead?.body ?? ''));
    if (has('x')) out.push(f('X image', SIZES.x, 'cover', only('x'), hook, lead?.body ?? ''));
    if (has('linkedin')) out.push(f('Wide image', SIZES.wide, 'cover', only('linkedin'), hook, lead?.body ?? ''));
    if (has('pinterest')) out.push(f('Pin', SIZES.pin, 'cover', only('pinterest'), hook, lead?.body ?? ''));
  }
  return design(out.filter((x) => x.headline.trim() || x.body.trim()), visuals, [p.hook, ...p.slides.map((s) => `${s.headline} ${s.body} ${s.visual}`), ...p.script.map((s) => `${s.onScreen} ${s.visual}`)].join(' '), p.slides[0]?.visual || p.script[0]?.visual || '');
}

// ---------- which design each image gets (pure) ----------

const SCREEN_WORDS: [RegExp, Screen][] = [
  [/storage[ -]?full|out of (space|storage)|phone (is )?full/i, 'storage-full'],
  [/free[ -]?(up )?space|free up|delete|clean ?up|space back/i, 'free-space'],
  [/wedding|guest|qr|event|album|party|shaadi|reception/i, 'qr-album'],
  [/night|camera|shoot|shutter|portrait mode|pro mode|low light/i, 'camera'],
  [/back(ed|ing)? ?up|safe|cloud|quality|original|upload/i, 'backup'],
  [/viewer|full[- ]screen|open (a|the) photo/i, 'viewer'],
  [/library|roll|gallery|all (your )?photos/i, 'library'],
];

/** The Lens screen a piece of text is about (first match wins; the library if nothing fits). */
export function screenFor(text: string, fallback: Screen = 'library'): Screen {
  return SCREEN_WORDS.find(([re]) => re.test(text))?.[1] ?? fallback;
}

/** Scene photos to look for, by topic. Scenery, not people: those clear the rights check on their own. */
const TOPICS: [RegExp, string][] = [
  [/wedding|marriage|shaadi|reception|bride|groom/i, 'wedding table decoration'],
  [/concert|festival|gig|music|stage/i, 'concert stage lights'],
  [/diwali|firework|new year|celebration/i, 'fireworks night sky'],
  [/night|city|street/i, 'city night lights'],
  [/beach|sea|island|summer/i, 'beach sunset'],
  [/mountain|trek|hike|snow/i, 'mountain landscape'],
  [/travel|trip|holiday|vacation|road/i, 'mountain road travel'],
  [/food|cafe|restaurant|market/i, 'street food market'],
];
export const topicQuery = (text: string) => TOPICS.find(([re]) => re.test(text))?.[1] ?? 'sunset sea';

/** A slide's "visual" note from the agent: "photo: <scene>", "app: <screen>" or "before/after". */
export function parseVisual(v: string): { layout?: Layout; screen?: Screen; query?: string } {
  const photo = /photo\s*:\s*([^.;\n]{3,80})/i.exec(v);
  if (photo) return { layout: 'moment', query: photo[1].trim(), screen: screenFor(v, 'viewer') };
  if (/before.{0,8}after|side by side|compare/i.test(v)) return { layout: 'compare', screen: 'free-space' };
  const app = /app(?: screen)?\s*:\s*([^.;\n]+)/i.exec(v);
  if (app) return { layout: 'phone', screen: screenFor(app[1]) };
  return {};
}

function design(list: Frame[], visuals: string[], all: string, firstVisual: string): Frame[] {
  const topic = topicQuery(all);
  const cover = parseVisual(firstVisual);
  const coverScreen = cover.screen && cover.layout !== 'moment' ? cover.screen : screenFor(all);
  // Middle slides without a note take turns, so a carousel never repeats one look.
  const turns: Layout[] = [/storage|space|full/i.test(all) ? 'compare' : 'phone', 'moment', 'phone'];
  let turn = 0;
  let lastScreen: Screen = coverScreen;
  let compared = false;
  return list.map((fr, i) => {
    if (fr.style === 'cta') return { ...fr, layout: 'cta', screen: 'library' };
    if (fr.style === 'cover') {
      const thumb = fr.w / fr.h > 1.5 && fr.label.startsWith('YouTube');
      return { ...fr, layout: thumb ? 'moment' : 'hero', screen: thumb && coverScreen === 'library' ? 'viewer' : coverScreen, query: cover.query ?? topic };
    }
    const v = parseVisual(visuals[i] ?? '');
    let layout = v.layout ?? turns[turn++ % turns.length];
    let screen = v.screen ?? screenFor(`${fr.headline} ${fr.body}`, lastScreen === 'backup' ? 'library' : 'backup');
    if (layout === 'compare' && !v.layout && compared) layout = 'phone';
    if (layout === 'compare') compared = true;
    if (layout === 'moment' && screen === 'library') screen = 'viewer';
    lastScreen = screen;
    return { ...fr, layout, screen, query: v.query ?? topic };
  });
}

/** Only what the bundled fonts can draw (Geist Latin + Noto Sans Devanagari): Lambda's Chromium has no
 *  fallback fonts, so anything else would show as a box. Captions keep emoji; the images drop them. */
export function drawable(text: string): string {
  return text
    .replace(/→/g, '->')
    .replace(/[^\u0000-\u00FF\u0131\u0152\u0153\u02BB\u02BC\u02C6\u02DA\u02DC\u0900-\u097F\u1CD0-\u1CF9\u2000-\u206F\u20A8\u20AC\u20B9\u2122\u2191\u2193\u2212\u2215\uA8E0-\uA8FF]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Devanagari needs room for its vowel signs and no letter-spacing (spacing breaks its joined letters). */
export const hasDevanagari = (s: string) => /[\u0900-\u097F\uA8E0-\uA8FF]/.test(s);

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PLATFORM_NAMES: Record<Platform, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', pinterest: 'Pinterest', linkedin: 'LinkedIn', x: 'X', reddit: 'Reddit' };

/** File names inside the zip: numbered in post order, safe on every OS. */
export const zipName = (i: number, fr: Pick<Frame, 'label' | 'w' | 'h'>) =>
  `${String(i + 1).padStart(2, '0')} ${fr.label.replace(/[^\w .-]+/g, '')} ${fr.w}x${fr.h}.png`;

/** The note in the zip: which image goes where. */
export function whereToPost(title: string, list: Frame[]): string {
  const lines = list.map((fr, i) => `${zipName(i, fr)}\r\n    ${fr.for.length ? fr.for.map((k) => PLATFORM_NAMES[k]).join(', ') : 'Spare (no platform in this post uses this size)'}`);
  return [`${title || 'Post'}: images made by Lens from the brand template.`, '', 'Which image goes where:', '', ...lines, '', 'Captions, hashtags and links: Console → Content → this post → Export.', ''].join('\r\n');
}

/** A zip with no compression (PNGs are compressed already), UTF-8 names. Enough for a few images. */
export function zipStore(files: { name: string; data: Buffer }[], at = new Date()): Buffer {
  const time = (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1);
  const date = ((at.getUTCFullYear() - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate();
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(f.data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(0, 8); // stored
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(f.data.length, 18);
    head.writeUInt32LE(f.data.length, 22);
    head.writeUInt16LE(name.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, name, f.data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(0, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(f.data.length, 20);
    dir.writeUInt32LE(f.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

export const zipKey = (postId: string) => `x/images-${postId}.zip`;
/** The name the zip downloads as (stored on the file, since CloudFront links can't set it per request). */
export const zipFile = (title: string) => `${String(title || 'post').replace(/[^\w -]+/g, '').trim().slice(0, 60) || 'post'} images.zip`;

/** Stable per post and frame, so rendering again replaces the same Library file. */
export const renderAssetId = (postId: string, label: string) => createHash('sha256').update(`render|${postId}|${label}`).digest('hex').slice(0, 12);

// ---------- the render job (GrowthAnalyst) ----------

const IMG = 'https://img.lens/'; // served from memory while drawing (request interception), never fetched
const GENERIC = ['sunset sea', 'city night lights', 'mountain lake', 'autumn forest', 'street food market', 'snowy mountains', 'desert dunes', 'flower field'];
const noCredit = (a: Asset) => ['own', 'public-domain', 'pexels', 'pixabay'].includes(licenseKey(a.rights.license));
const shuffle = <T extends { id: string }>(list: T[], seed: string) =>
  [...list].sort((a, b) => createHash('md5').update(seed + a.id).digest('hex').localeCompare(createHash('md5').update(seed + b.id).digest('hex')));

async function bytesOf(a: Asset): Promise<Buffer | undefined> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: a.key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  } catch {
    return undefined;
  }
}

const LOOK_MODE: Mode = { system: PHOTO_CHECK_SYSTEM, schema: PHOTO_CHECK_SCHEMA, toolNames: [], mode: 'report', readsFiles: true };
const SCORE_MODE: Mode = { system: SCORE_SYSTEM, schema: SCORE_SCHEMA, toolNames: [], mode: 'report', readsFiles: true };
const LOOK_MS = 3 * 60_000; // the AI designer needs the rest of the Lambda's 15 minutes
const SHEETS_DIR = '/tmp/claude-home';
type Browser = Awaited<ReturnType<typeof launchBrowser>>;
type Page = Awaited<ReturnType<Browser['newPage']>>;

const claudeToken = async () => (process.env.GROWTH_AI_DESIGN === 'off' ? undefined : await getParam('/lens/growth/claude-token').catch(() => undefined));

/** What Claude is told the post is about, when it judges photos and finished images. */
export function postBrief(post: PostLike & { title: string }): string {
  const slides = (post.slides ?? []).map((x) => `${x.headline} ${x.body}`.trim()).filter(Boolean).slice(0, 10);
  return [`Title: ${post.title}`, `Format: ${post.format}`, `Hook: ${post.hook}`, ...(slides.length ? [`Slides: ${slides.join(' / ')}`] : [])].join('\n').slice(0, 2000);
}

/** One contact sheet as a JPEG file Claude can open. */
async function writeSheet(page: Page, images: string[], name: string) {
  await page.setViewport({ width: 1600, height: 400 * Math.ceil(images.length / 4), deviceScaleFactor: 1 });
  await page.setContent(sheetHtml(images), { waitUntil: 'load' });
  mkdirSync(SHEETS_DIR, { recursive: true });
  const file = join(SHEETS_DIR, `${name}.jpg`);
  writeFileSync(file, Buffer.from(await page.screenshot({ type: 'jpeg', quality: 80 })));
  return file;
}

/** Claude looks at photos with this post in mind. "Good enough for any ad" is saved on the asset (so a rejected
 *  photo never comes back); fit is about this post and returned by photo id. If it can't look (limit reached, no
 *  token) nothing fits and unseen photos aren't used: no photo beats a wrong photo. */
async function lookAtPhotos(photos: { photo: Photo; topic: string }[], brief: string, browser: Browser): Promise<Map<string, number>> {
  const fits = new Map<string, number>();
  const todo = [...new Map(photos.filter((x) => x.photo.origin === 'discovered' && x.photo.looked?.ok !== false).map((x) => [x.photo.id, x])).values()];
  const token = await claudeToken();
  if (!todo.length || !token) return fits;
  const started = Date.now();
  const page = await browser.newPage();
  try {
    for (let i = 0; i < todo.length && Date.now() - started < LOOK_MS; i += SHEET_SIZE) {
      const part = todo.slice(i, i + SHEET_SIZE);
      const urls = await Promise.all(part.map(async (x) => `data:${x.photo.mime};base64,${((await bytesOf(x.photo)) ?? Buffer.alloc(0)).toString('base64')}`));
      const file = await writeSheet(page, urls, `photos-${i}`);
      const { report } = await runClaude<{ photos: { n: number; ok: boolean; fit: number; why: string }[] }>(sheetPrompt(file, brief, part.map((x) => x.topic)), token, { enabled: [] }, Date.now() + LOOK_MS, LOOK_MODE);
      const verdicts = sheetVerdicts(report, part.length);
      await Promise.all(
        part.map(async (x, k) => {
          const v = verdicts.get(k);
          if (!v) return;
          fits.set(x.photo.id, v.ok ? v.fit : 0);
          if (x.photo.looked?.ok !== v.ok) await saveLook(x.photo, v);
        }),
      );
      console.log(JSON.stringify({ photoLook: part.map((x, k) => ({ name: x.photo.name.slice(0, 40), ...verdicts.get(k) })) }));
    }
  } catch (e) {
    console.error(JSON.stringify({ photoLookFailed: (e as Error).message.slice(0, 300) }));
  } finally {
    await page.close();
  }
  return fits;
}

/** Claude judges the finished images together, as someone seeing the post would. Undefined if it can't. */
async function scoreImages(page: Page, images: { label: string; png: Buffer }[], brief: string): Promise<{ images: ImageScore[]; hook: number; hookWhy: string } | undefined> {
  const token = await claudeToken();
  if (!token || !images.length) return undefined;
  try {
    const files: string[] = [];
    for (let i = 0; i < images.length; i += SHEET_SIZE) files.push(await writeSheet(page, images.slice(i, i + SHEET_SIZE).map((x) => `data:image/png;base64,${x.png.toString('base64')}`), `score-${i}`));
    const labels = images.map((x, i) => `${i + 1}: ${x.label}`);
    const { report } = await runClaude<{ images: { n: number; score: number; relates: number; clear: number; design: number; why: string; fix: string }[]; hook: number; hookWhy: string }>(scorePrompt(files, brief, labels), token, { enabled: [] }, Date.now() + 2 * 60_000, SCORE_MODE);
    return { images: readScores(report, images.map((x) => x.label)), hook: Number(report.hook) || 0, hookWhy: String(report.hookWhy ?? '').slice(0, 200) };
  } catch (e) {
    console.error(JSON.stringify({ scoreFailed: (e as Error).message.slice(0, 300) }));
    return undefined;
  }
}

/** The photos a post's images use: a photo a person chose for the post first, else Pixabay scenes for each frame's
 *  topic that Claude says fit this post, and a pool for phone screens (this post's fitting photos first, general
 *  ones only to fill up; licences that need no credit, so tiny tiles never owe one). `dropped`: found photos an
 *  earlier render attached for their credit lines (nobody's choice, and they'd become every scene of this render). */
async function gatherPhotos(post: PostLike & { title: string }, list: Frame[], browser: Browser) {
  const served = new Map<string, { mime: string; body: Buffer }>();
  const kit: KitPhoto[] = [];
  const url = async (a: Asset) => {
    if (!served.has(a.id)) {
      const body = await bytesOf(a);
      if (!body) return undefined;
      served.set(a.id, { mime: a.mime, body });
      const p = a as Photo;
      kit.push({ ref: `p${kit.length + 1}`, url: IMG + a.id, about: `${p.query ? `${p.query}: ` : ''}${a.name}`, w: p.w ?? 1600, h: p.h ?? 1067 });
    }
    return IMG + a.id;
  };
  let own: Asset | undefined;
  const dropped: string[] = [];
  for (const r of post.assets ?? []) {
    const a = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${r.id}` } }))).Item as Asset | undefined;
    if (a?.origin === 'discovered') dropped.push(r.id);
    else if (!own && a && a.kind !== 'render' && a.mime.startsWith('image/') && a.status === 'ready' && a.rights.status === 'cleared' && (r.role === 'background' || (r.role === 'media' && a.rights.license === 'own'))) own = a;
  }
  const queries = [...new Set(list.map((f) => f.query).filter((x): x is string => !!x))];
  const options = new Map<string, Photo[]>();
  if (!own) for (const q of queries) options.set(q, await findPhotos(q, 10, list.some((f) => f.query === q && f.w > f.h) ? 'landscape' : 'portrait'));
  let pool = (await photoPool()).filter(noCredit);
  if (pool.filter(photoPassed).length < 15) {
    for (const q of GENERIC) await findPhotos(q, 3, 'portrait');
    pool = (await photoPool()).filter(noCredit);
  }
  const unseen = shuffle(pool.filter((p) => !p.looked), post.id);
  const fits = await lookAtPhotos(
    [...[...options].flatMap(([q, ps]) => ps.map((photo) => ({ photo, topic: q }))), ...(pool.filter(photoPassed).length < 15 ? unseen.slice(0, 2 * SHEET_SIZE) : []).map((photo) => ({ photo, topic: photo.query ?? 'a beautiful scene' }))],
    postBrief(post),
    browser,
  );
  const fitting = [...new Map([...options.values()].flat().filter((p) => photoPassed(p) && (fits.get(p.id) ?? 0) >= FITS).map((p) => [p.id, p])).values()].sort((a, b) => (fits.get(b.id) ?? 0) - (fits.get(a.id) ?? 0));
  const scenes = new Map<string, string>();
  const credited: AssetRef[] = [];
  for (const q of queries) {
    const found = (own as Photo | undefined) ?? options.get(q)?.filter((p) => fitting.includes(p)).sort((a, b) => (fits.get(b.id) ?? 0) - (fits.get(a.id) ?? 0))[0] ?? fitting[0];
    const u = found && (await url(found));
    if (u) scenes.set(q, u);
    if (found && !noCredit(found) && !credited.some((c) => c.id === found.id)) credited.push({ id: found.id, role: 'background' });
  }
  // Phone screens: an album about a wedding shows wedding photos; general photos only if too few fit.
  const general = shuffle(pool.filter((p) => photoPassed(p) && !fitting.includes(p)), post.id);
  const poolPhotos = fitting.filter(noCredit).length >= 6 ? fitting.filter(noCredit) : [...fitting.filter(noCredit), ...general];
  const poolUrls = (await Promise.all(poolPhotos.slice(0, 15).map(url))).filter((u): u is string => !!u);
  return { served, scenes, pool: poolUrls, credited, dropped, kit };
}

const DESIGN_MODE: Mode = { system: DESIGN_SYSTEM, schema: DESIGN_SCHEMA, toolNames: [], mode: 'report' };

/** Claude as the designer (same token as the analyst); undefined when it isn't set up or is switched off. */
async function aiDesigner(post: PostLike & { title: string }, list: Frame[], kit: KitPhoto[], brand: Awaited<ReturnType<typeof loadBrand>>, cta: string, offer: string) {
  if (process.env.GROWTH_AI_DESIGN === 'off') return undefined;
  const token = await getParam('/lens/growth/claude-token').catch(() => undefined);
  if (!token) return undefined;
  const started = Date.now();
  return async (problems: Map<string, string[]> | undefined) => {
    const todo = problems ? list.filter((f) => problems.has(f.label)) : list;
    const budget = problems ? 4 * 60_000 : 7 * 60_000;
    if (Date.now() - started > 9 * 60_000) return new Map<string, AiDesign>();
    const { report } = await runClaude<{ designs: AiDesign[] }>(designPrompt(post, todo, kit, brand, cta, offer, SITE, problems), token, { enabled: [] }, Date.now() + budget, DESIGN_MODE);
    return designsByLabel(report, todo.map((f) => f.label));
  };
}

const scored = (score: PostScore | null, label: string) => {
  const s = score?.images.find((x) => x.label === label);
  return s ? { score: s.score, scoreWhy: s.why } : {};
};

export async function renderPost(postId: string, by: string): Promise<{ rendered: number }> {
  const jobStart = Date.now();
  if (!BUCKET) throw new Error('Content storage isn’t set up');
  const post = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` } }))).Item as (PostLike & { title: string }) | undefined;
  if (!post) throw new Error(`Post ${postId} is gone`);
  const brand = await loadBrand();
  const cta = brand.ctas[0] ?? 'Try Lens free';
  const list = frames({ ...post, slides: post.slides ?? [], script: post.script ?? [], variants: post.variants ?? {} }, cta);
  if (!list.length) throw new Error('Nothing to draw: give the post a hook or slides first');
  const font = (name: string) => readFileSync(join(BRAND_DIR, name)).toString('base64');
  const fonts = {
    geist: font('geist-latin.woff2'),
    deva: list.some((fr) => hasDevanagari(fr.headline + fr.body)) ? font('noto-devanagari.woff2') : undefined,
    plex500: font('plex-mono-500.ttf'),
    plex600: font('plex-mono-600.ttf'),
  };
  const icon = `data:image/png;base64,${font('lens-icon.png')}`;
  const offer = '10 GB free forever. No card needed.';
  const allowed = [post.hook, ...list.map((f) => `${f.headline} ${f.body}`), cta, offer, SITE, 'Lens'].join(' ');
  const browser = await launchBrowser();
  const renders: { assetId: string; label: string; w: number; h: number; designedBy: 'ai' | 'template' }[] = [];
  const files: { name: string; data: Buffer }[] = [];
  let credited: AssetRef[] = [];
  let dropped: string[] = [];
  let score: PostScore | null = null;
  try {
    const gathered = await gatherPhotos({ ...post, id: postId, title: post.title }, list, browser);
    const { served, scenes, pool, kit } = gathered;
    credited = gathered.credited;
    dropped = gathered.dropped;
    const page = await browser.newPage();
    // Nothing leaves the page: fonts are inline and photos are answered from memory.
    await page.setRequestInterception(true);
    page.on('request', (r: { url(): string; continue(): Promise<void>; abort(): Promise<void>; respond(x: { status: number; contentType: string; body: Buffer }): Promise<void> }) => {
      const u = r.url();
      if (/^(data|about):/.test(u)) return void r.continue();
      const hit = u.startsWith(IMG) ? served.get(u.slice(IMG.length)) : undefined;
      void (hit ? r.respond({ status: 200, contentType: hit.mime, body: hit.body }) : r.abort());
    });
    const shoot = async (fr: Frame, html: string, check: boolean) => {
      await page.setViewport({ width: fr.w, height: fr.h, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready');
      const seen = check ? ((await page.evaluate(PAGE_CHECK)) as { problems: string[]; text: string }) : { problems: [], text: '' };
      const problems = check ? [...seen.problems, ...wordProblems(seen.text, allowed)] : [];
      return { png: Buffer.from(await page.screenshot({ type: 'png' })), problems };
    };
    // 1) Claude designs every image; one fix round for the ones that fail the checks.
    const done = new Map<string, { png: Buffer; by: 'ai' | 'template'; idea?: string; problems?: string[] }>();
    const failed = new Map<string, string[]>();
    const ai = await aiDesigner(post, list, kit, brand, cta, offer);
    const ctx = { photos: kit, pool, icon, brand, fonts };
    const tryDesigns = async (designs: Map<string, AiDesign>) => {
      for (const fr of list) {
        const d = designs.get(fr.label);
        if (!d || done.has(fr.label)) continue;
        const r = await shoot(fr, aiPageHtml(fr, d.html, ctx), true).catch((e) => ({ png: undefined, problems: [`could not draw: ${(e as Error).message.slice(0, 80)}`] }));
        if (r.png && !r.problems.length) {
          done.set(fr.label, { png: r.png, by: 'ai', idea: d.idea.slice(0, 200) });
          failed.delete(fr.label);
        } else failed.set(fr.label, r.problems);
      }
    };
    if (ai) {
      await tryDesigns(await ai(undefined).catch(() => new Map()));
      if (failed.size) await tryDesigns(await ai(new Map(failed)).catch(() => new Map()));
    }
    // 2) The template for anything the AI didn't get right (or when Claude isn't available).
    for (const fr of list) {
      if (done.has(fr.label)) continue;
      const html = designHtml({ w: fr.w, h: fr.h, layout: fr.layout, screen: fr.screen, headline: drawable(fr.headline), body: drawable(fr.body), index: fr.index, total: fr.total, cta: drawable(cta), site: SITE, photo: fr.query ? scenes.get(fr.query) : undefined, pool, icon, fonts, brand });
      done.set(fr.label, { png: (await shoot(fr, html, false)).png, by: 'template', problems: failed.get(fr.label) });
    }
    // 3) Claude scores the finished post; AI images under the bar get one redesign from the critique, which
    //    only replaces the first design if it passes the checks and scores higher.
    const framed = () => list.map((fr) => ({ label: fr.label, png: done.get(fr.label)!.png }));
    const brief = postBrief(post);
    const first = await scoreImages(page, framed(), brief);
    if (first) {
      score = { total: postTotal(first.images, first.hook), hook: first.hook, hookWhy: first.hookWhy, images: first.images, redone: 0, at: Date.now() };
      const weak = first.images.filter((x) => x.score < REDO_BELOW && done.get(x.label)?.by === 'ai');
      if (ai && weak.length && Date.now() - jobStart < 7 * 60_000) {
        const redo = await ai(new Map(weak.map((x) => [x.label, [`creative director scored it ${x.score}/100: ${x.why}${x.fix ? `. ${x.fix}` : ''}`]]))).catch(() => new Map<string, AiDesign>());
        const tried: { label: string; png: Buffer; idea: string }[] = [];
        for (const fr of list) {
          const d = redo.get(fr.label);
          if (!d) continue;
          const r = await shoot(fr, aiPageHtml(fr, d.html, ctx), true).catch(() => undefined);
          if (r && !r.problems.length) tried.push({ label: fr.label, png: r.png, idea: d.idea.slice(0, 200) });
        }
        const again = tried.length && Date.now() - jobStart < 12 * 60_000 ? await scoreImages(page, tried, brief) : undefined;
        const images = new Map(first.images.map((x) => [x.label, x]));
        let redone = 0;
        for (const t of tried) {
          const after = again?.images.find((x) => x.label === t.label);
          if (after && after.score > (images.get(t.label)?.score ?? 0)) {
            done.set(t.label, { png: t.png, by: 'ai', idea: t.idea });
            images.set(t.label, after);
            redone++;
          }
        }
        const final = list.map((fr) => images.get(fr.label)).filter((x): x is ImageScore => !!x);
        score = { ...score, images: final, total: postTotal(final, first.hook), redone };
      }
    }
    for (const fr of list) {
      const { png, by: designedBy, idea, problems } = done.get(fr.label)!;
      const id = renderAssetId(postId, fr.label);
      const key = `a/${id}.png`;
      await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: png, ContentType: 'image/png' }));
      const asset: Asset & { postId: string; label: string; w: number; h: number; designedBy: 'ai' | 'template'; idea?: string; problems?: string[]; score?: number; scoreWhy?: string } = {
        id,
        name: `${post.title || 'Post'} · ${fr.label}`.slice(0, 160),
        kind: 'render',
        origin: 'template',
        key,
        mime: 'image/png',
        bytes: png.length,
        lensPhoto: false,
        checkedPersonal: true,
        rights: { status: 'cleared', license: 'own', licenseUrl: '', source: '', author: '', credit: '', commercialOk: true, editsOk: true, peopleOrBrands: false, reason: credited.length ? 'Made by Lens; uses found photos, credited in the post' : 'Made by Lens from the brand template', checkedAt: Date.now(), checkedBy: 'template' },
        status: 'ready',
        createdAt: Date.now(),
        createdBy: by,
        postId,
        label: fr.label,
        w: fr.w,
        h: fr.h,
        designedBy,
        ...(idea ? { idea } : {}),
        ...(problems?.length ? { problems } : {}),
        ...scored(score, fr.label),
      };
      await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `ASSET#${id}`, ...asset } }));
      renders.push({ assetId: id, label: fr.label, w: fr.w, h: fr.h, designedBy });
      files.push({ name: zipName(files.length, fr), data: png });
    }
  } finally {
    await browser.close();
  }
  files.push({ name: 'where-to-post.txt', data: Buffer.from(whereToPost(post.title, list), 'utf8') });
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: zipKey(postId), Body: zipStore(files), ContentType: 'application/zip', ContentDisposition: `attachment; filename="${zipFile(post.title)}"` }));
  // Found photos that need a credit join the post as backgrounds, so Export adds their credit lines.
  const kept = (post.assets ?? []).filter((a) => !dropped.includes(a.id));
  const assets = [...kept, ...credited.filter((c) => !kept.some((a) => a.id === c.id))].slice(0, 20);
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` }, UpdateExpression: 'SET renders = :r, renderedAt = :t, rendersZip = :z, assets = :a, score = :s', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':r': renders, ':t': Date.now(), ':z': zipKey(postId), ':a': assets, ':s': score } }));
  console.log(JSON.stringify({ postScore: score }));
  return { rendered: renders.length };
}

// ---------- the Console side ----------

const RENDER_MINUTES = 14; // the AI designer takes a few minutes; the Lambda stops at 15

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

/** GET /growth/posts/<id>/images: a 5-minute link to the zip of the post's images (made with each render). */
export async function renderZip(postId: string): Promise<Res> {
  if (!/^[a-f0-9]{10}$/.test(postId)) throw new HttpError(400, 'Bad post id');
  const post = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${postId}` } }))).Item;
  if (!post) throw new HttpError(404, 'No such post');
  const key = zipKey(postId);
  const gone = () => new HttpError(404, 'No zip yet (or it’s over 30 days old): press Make images first.');
  if (post.rendersZip !== key) throw gone();
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    throw gone();
  }
  return json(200, { url: await viewUrl(key), file: zipFile(String(post.title ?? '')) });
}
