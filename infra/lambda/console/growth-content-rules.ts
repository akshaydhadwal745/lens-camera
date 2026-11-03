// Content packages (docs/growth/content-engine.md): which formats each platform takes, its text limits and
// the checks every caption passes before a person can approve it. Pure: used by the API, the agent's
// draft run and the tests (growth-content-rules.test.ts).
import { FORBIDDEN_CLAIMS } from './growth-report';

export const PLATFORMS = ['instagram', 'facebook', 'youtube', 'pinterest', 'linkedin', 'x', 'reddit'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const FORMATS = ['post', 'carousel', 'story', 'reel', 'short', 'pin', 'thread', 'article'] as const;
export type Format = (typeof FORMATS)[number];
export const PILLARS = ['phone-full', 'events', 'camera-tips', 'travel-memories', 'own-storage', 'build-in-public'] as const;

/** Text limits per platform (the platforms' own maximums; hashtags: what we allow, not their maximum). */
export const LIMITS: Record<Platform, { caption: number; title?: number; description?: number; hashtags: number; formats: Format[]; direct: boolean }> = {
  instagram: { caption: 2200, hashtags: 8, formats: ['post', 'carousel', 'story', 'reel', 'short'], direct: true },
  facebook: { caption: 5000, hashtags: 3, formats: ['post', 'carousel', 'story', 'reel', 'short'], direct: true },
  // A vertical video is a Reel on Instagram/Facebook and a Short on YouTube: the same file, either name.
  youtube: { caption: 5000, title: 100, hashtags: 3, formats: ['short', 'reel'], direct: true },
  pinterest: { caption: 500, title: 100, hashtags: 0, formats: ['pin'], direct: true },
  linkedin: { caption: 3000, hashtags: 3, formats: ['post', 'carousel', 'article'], direct: false },
  x: { caption: 280, hashtags: 2, formats: ['post', 'thread'], direct: false },
  reddit: { caption: 10000, title: 300, hashtags: 0, formats: ['post'], direct: false },
};

export type Variant = { caption: string; hashtags: string[]; cta: string; title: string; altText: string };
export type Slide = { headline: string; body: string; visual: string };
export type Scene = { seconds: number; onScreen: string; visual: string };
export type ContentPackage = { format: Format; hook: string; slides: Slide[]; script: Scene[]; variants: Partial<Record<Platform, Variant>>; realPhoto: boolean };

const SHOT_ON = /\b(shot|taken|captured|clicked) (on|with) lens\b|lens (camera )?(shot|photo)s?\b|\bno filter\b/i;

/** Hashtags as the platforms want them: "#word", no spaces, no duplicates. */
export function cleanHashtags(v: unknown, max: number): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [];
  const out: string[] = [];
  for (const raw of list) {
    const tag = `#${String(raw).replace(/^#+/, '').replace(/[^\p{L}\p{M}\p{N}_]/gu, '')}`;
    if (tag.length > 1 && tag.length <= 60 && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, Math.max(0, max));
}

/** What a variant would post as text (caption, call to action, link, hashtags). */
export function postText(v: Variant, link: string, platform: Platform): string {
  const tags = v.hashtags.join(' ');
  // Instagram captions can't hold a clickable link: point to the profile link instead.
  const linkLine = platform === 'instagram' ? '' : link;
  return [v.caption.trim(), v.cta.trim(), linkLine, tags].filter(Boolean).join('\n\n');
}

/** Length as the platform counts it: X shortens every link to 23 characters (t.co). */
export function textLength(text: string, platform: Platform): number {
  const t = platform === 'x' ? text.replace(/https?:\/\/\S+/g, 'x'.repeat(23)) : text;
  return [...t].length;
}

/** Problems that stop approval. Empty = this platform's version can be approved. */
export function variantProblems(platform: Platform, format: Format, v: Variant, link: string, realPhoto: boolean): string[] {
  const l = LIMITS[platform];
  const p: string[] = [];
  if (!l.formats.includes(format)) p.push(`${platform} doesn't take a ${format}`);
  if (!v.caption.trim()) p.push(`${platform}: write a caption`);
  const len = textLength(postText(v, link, platform), platform);
  if (len > l.caption) p.push(`${platform}: ${len} characters, the limit is ${l.caption}`);
  if (l.title && !v.title.trim()) p.push(`${platform}: add a title`);
  if (l.title && [...v.title].length > l.title) p.push(`${platform}: title is ${[...v.title].length} characters, the limit is ${l.title}`);
  if (v.hashtags.length > l.hashtags) p.push(`${platform}: ${v.hashtags.length} hashtags, use at most ${l.hashtags}`);
  if (['post', 'carousel', 'pin', 'story'].includes(format) && !v.altText.trim() && platform !== 'reddit' && platform !== 'x') p.push(`${platform}: add alt text (describes the image for people who can't see it)`);
  const all = `${v.title} ${v.caption} ${v.cta} ${v.altText}`;
  if (FORBIDDEN_CLAIMS.test(all)) p.push(`${platform}: makes a claim product-facts.md forbids (unlimited storage)`);
  if (SHOT_ON.test(all) && !realPhoto) p.push(`${platform}: says the picture was taken with Lens, but the post has no real Lens photo`);
  return p;
}

/** Problems with the whole package (format content plus every platform version). */
export function packageProblems(c: ContentPackage, link: (platform: Platform) => string): string[] {
  const p: string[] = [];
  const platforms = Object.keys(c.variants) as Platform[];
  if (!platforms.length) p.push('Add at least one platform');
  if (c.format === 'carousel' && (c.slides.length < 2 || c.slides.length > 10)) p.push('A carousel needs 2–10 slides');
  if (['reel', 'short'].includes(c.format)) {
    const secs = c.script.reduce((a, s) => a + s.seconds, 0);
    if (!c.script.length) p.push('A reel or short needs a script');
    if (secs > 60) p.push(`The script runs ${secs} seconds; keep it at 60 or less`);
  }
  for (const s of [...c.slides.map((x) => `${x.headline} ${x.body}`), ...c.script.map((x) => x.onScreen), c.hook]) {
    if (FORBIDDEN_CLAIMS.test(s)) p.push('The slides or script make a claim product-facts.md forbids (unlimited storage)');
    if (SHOT_ON.test(s) && !c.realPhoto) p.push('The slides or script say a picture was taken with Lens, but the post has no real Lens photo');
  }
  for (const k of platforms) p.push(...variantProblems(k, c.format, c.variants[k]!, link(k), c.realPhoto));
  return [...new Set(p)];
}

// ---------- reading input (API and agent) ----------

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

export function readVariant(platform: Platform, v: any): Variant {
  return {
    caption: str(v?.caption, 12_000),
    hashtags: cleanHashtags(v?.hashtags, 30),
    cta: str(v?.cta, 300),
    title: str(v?.title, 400),
    altText: str(v?.altText, 1000),
  };
}

export function readPackage(b: any, old?: any): ContentPackage {
  const src = (k: string) => (b?.[k] !== undefined ? b[k] : old?.[k]);
  const variantsIn = (src('variants') ?? {}) as Record<string, unknown>;
  const variants: Partial<Record<Platform, Variant>> = {};
  for (const k of PLATFORMS) if (variantsIn[k]) variants[k] = readVariant(k, variantsIn[k]);
  return {
    format: oneOf(src('format'), FORMATS, 'post'),
    hook: str(src('hook'), 300),
    slides: (Array.isArray(src('slides')) ? src('slides') : []).slice(0, 10).map((s: any) => ({ headline: str(s?.headline, 200), body: str(s?.body, 600), visual: str(s?.visual, 600) })),
    script: (Array.isArray(src('script')) ? src('script') : []).slice(0, 20).map((s: any) => ({ seconds: Math.max(1, Math.min(30, Math.round(Number(s?.seconds) || 3))), onScreen: str(s?.onScreen, 200), visual: str(s?.visual, 600) })),
    variants,
    realPhoto: (src('realPhoto') ?? false) === true,
  };
}
