// Brand kit and content settings (docs/growth/content-engine.md): what every post looks and sounds like,
// how many posts the agent plans a week, in which languages, and which platforms may publish directly.
//   GROWTH / BRAND   colours, font, voice, do/don't, CTAs, hashtag sets, pillars, cadence, languages, publishing
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, json, Req, Res } from '../api/lib';
import { LIMITS, PILLARS, PLATFORMS, type Platform } from './growth-content-rules';
import { log } from './log';

export type Brand = {
  colors: { background: string; surface: string; primary: string; accent: string; text: string; muted: string };
  font: string;
  voice: string;
  dos: string[];
  donts: string[];
  ctas: string[];
  hashtags: string[];
  pillars: string[];
  cadencePerWeek: number;
  languages: string[];
  /** Platforms content is made for now, in order (owner 2026-11-04: Instagram, Facebook, X first; YouTube later). */
  focus: Platform[];
  publishing: Record<Platform, boolean>;
  updatedAt?: number;
  updatedBy?: string;
};

/** From the website's look (og images, Geist) and docs/growth/product-facts.md positioning. */
export const DEFAULT_BRAND: Brand = {
  colors: { background: '#0B1020', surface: '#1E1B4B', primary: '#2563EB', accent: '#FACC15', text: '#FFFFFF', muted: '#C7D2FE' },
  font: 'Geist',
  voice: 'Calm, confident and specific. Lead with the problem people feel ("Phone full? Shoot everything."), then how Lens solves it. Plain words, short sentences, no hype. Honest about alternatives: Google Photos is a good product.',
  dos: ['One idea per post', 'Show the real app or a real Lens photo when possible', 'Name the problem in the first line', 'Point to one website page that answers it'],
  donts: ['Never say "unlimited"', 'No made-up numbers, users, reviews or testimonials', 'Never present an illustration or template as a photo taken with Lens', 'No "best" or "#1"', 'No trending audio baked into videos (add it on the platform)'],
  ctas: ['Try Lens free', 'Back up your first 100 photos', 'Make an event album for your next party', 'See how it works'],
  hashtags: ['#photobackup', '#phonestorage', '#weddingphotos', '#photography', '#travelphotos'],
  pillars: [...PILLARS],
  cadencePerWeek: 3,
  languages: ['en'],
  focus: ['instagram', 'facebook', 'x'],
  publishing: Object.fromEntries(PLATFORMS.map((p) => [p, false])) as Record<Platform, boolean>,
};

const color = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : d);
const list = (v: unknown, d: string[], max: number, len: number) => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, len)).filter(Boolean).slice(0, max) : d);

export async function brand(): Promise<Brand> {
  const b = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'BRAND' } }))).Item as Partial<Brand> | undefined;
  return { ...DEFAULT_BRAND, ...(b ?? {}), colors: { ...DEFAULT_BRAND.colors, ...(b?.colors ?? {}) }, publishing: { ...DEFAULT_BRAND.publishing, ...(b?.publishing ?? {}) } };
}

/** Checked brand fields from a request (anything missing keeps the current value). */
export function readBrand(b: any, cur: Brand): Brand {
  const c = b?.colors ?? {};
  return {
    colors: Object.fromEntries(Object.entries(cur.colors).map(([k, v]) => [k, color(c[k], v)])) as Brand['colors'],
    font: typeof b?.font === 'string' && /^[\w ]{2,40}$/.test(b.font) ? b.font : cur.font,
    voice: typeof b?.voice === 'string' ? b.voice.trim().slice(0, 1500) : cur.voice,
    dos: list(b?.dos, cur.dos, 15, 200),
    donts: list(b?.donts, cur.donts, 15, 200),
    ctas: list(b?.ctas, cur.ctas, 15, 120),
    hashtags: list(b?.hashtags, cur.hashtags, 30, 60).map((t) => `#${t.replace(/^#+/, '').replace(/[^\p{L}\p{M}\p{N}_]/gu, '')}`).filter((t) => t.length > 1),
    pillars: list(b?.pillars, cur.pillars, 12, 40),
    cadencePerWeek: Number.isInteger(b?.cadencePerWeek) && b.cadencePerWeek >= 0 && b.cadencePerWeek <= 14 ? b.cadencePerWeek : cur.cadencePerWeek,
    focus: Array.isArray(b?.focus) ? (() => { const f = PLATFORMS.filter((p) => b.focus.includes(p)); return f.length ? f : cur.focus; })() : cur.focus,
    languages: Array.isArray(b?.languages) ? b.languages.filter((l: unknown) => l === 'en' || l === 'hi').slice(0, 2) : cur.languages,
    publishing: Object.fromEntries(PLATFORMS.map((p) => [p, LIMITS[p].direct && typeof b?.publishing?.[p] === 'boolean' ? b.publishing[p] : cur.publishing[p] && LIMITS[p].direct])) as Record<Platform, boolean>,
  };
}

/** GET /growth/brand: the kit plus each platform's limits (the editor shows live counters). */
export async function brandPage(): Promise<Res> {
  return json(200, { brand: await brand(), limits: LIMITS, platforms: PLATFORMS });
}

/** PUT /growth/brand (growth.write) */
export async function brandUpdate(req: Req, by: string): Promise<Res> {
  const next = { ...readBrand(req.body ?? {}, await brand()), updatedAt: Date.now(), updatedBy: by };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'BRAND', ...next } }));
  await log({ entity: 'growth:brand', action: 'growth.brand-update', actor: `console:${by}`, data: { fields: Object.keys(req.body ?? {}) } });
  return json(200, { brand: next });
}
