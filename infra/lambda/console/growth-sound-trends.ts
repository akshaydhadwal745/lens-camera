// Sound trends (owner 2026-11-11: "automatic only, with trending sounds"). Instagram's own music and trending audio
// can't be attached through any API, and the trending songs themselves are copyrighted, so the closest automatic,
// safe thing: every Monday Claude searches the web (WebSearch + WebFetch) for the audio STYLES trending on Reels
// this week (worldwide and India) and turns each into search words for free-licence music (Openverse: CC0 / public
// domain / CC BY) and the reel mood it fits. The reel's music search tries those first (growth-video.ts musicFor).
//   GROWTH / SOUNDTRENDS  { at, styles: [{ style, query, mood, why, source }] }
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam } from '../api/lib';
import { runClaude, type Mode } from './growth';
import { MOODS } from './growth-reel-ai';

const DAY = 86_400_000;

export const SOUND_SYSTEM = `You track what audio is trending on Instagram Reels for a camera and photo-backup app's marketing team. Use WebSearch and WebFetch (music trend reports, Instagram's own trend posts, creator newsletters, articles from the last 2 weeks) to find the audio STYLES trending on Reels right now, worldwide and in India: genres, sub-genres and treatments (e.g. sped-up acoustic covers, phonk, afro house, lo-fi piano, Bollywood lo-fi, cinematic swells), not individual copyrighted songs we would copy.

For each style give: style (its name), query (2–4 words that find instrumental, royalty-free music in that style on a free music library, e.g. "afro house instrumental", "lofi piano chill"), mood (which of our reel moods it fits: ${MOODS.join(', ')}), why (one line: where it's trending and for what kind of reels), source (the URL you read it in). 4 to 8 styles, the most widely used first. Skip anything with vocals at its core, anything tied to a news event or something sad.`;

const SOUND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['styles'],
  properties: {
    styles: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['style', 'query', 'mood', 'why', 'source'], properties: { style: { type: 'string' }, query: { type: 'string' }, mood: { type: 'string', enum: MOODS }, why: { type: 'string' }, source: { type: 'string' } } },
    },
  },
} as const;

const SOUND_MODE: Mode = { system: SOUND_SYSTEM, schema: SOUND_SCHEMA, toolNames: [], mode: 'report', builtins: ['WebSearch', 'WebFetch'] };

export type SoundStyle = { style: string; query: string; mood: string; why: string; source: string };

/** Claude's list → usable styles: a known mood, short plain search words, an https source. Pure. */
export function readStyles(r: { styles?: Partial<SoundStyle>[] } | undefined): SoundStyle[] {
  return (r?.styles ?? [])
    .map((s) => ({ style: String(s.style ?? '').slice(0, 60), query: String(s.query ?? '').replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 40), mood: String(s.mood ?? ''), why: String(s.why ?? '').slice(0, 200), source: String(s.source ?? '') }))
    .filter((s) => s.style && s.query.split(/\s+/).length >= 2 && (MOODS as readonly string[]).includes(s.mood) && /^https:\/\//.test(s.source))
    .slice(0, 8);
}

/** Weekly run (rule GrowthSoundTrends). Never throws. */
export async function runSoundTrends(now = Date.now()): Promise<Record<string, unknown>> {
  const token = await getParam('/lens/growth/claude-token').catch(() => undefined);
  if (!token) return { soundTrends: 'no token' };
  try {
    const { report } = await runClaude<{ styles?: Partial<SoundStyle>[] }>(`Today is ${new Date(now).toISOString().slice(0, 10)}. What audio styles are trending on Instagram Reels this week?`, token, { enabled: [] }, now + 8 * 60_000, SOUND_MODE);
    const styles = readStyles(report);
    if (styles.length) await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'SOUNDTRENDS', at: now, styles } }));
    console.log(JSON.stringify({ soundTrends: styles.map((s) => `${s.mood}: ${s.style} (${s.query})`) }));
    return { soundTrends: styles.length };
  } catch (e) {
    console.error(JSON.stringify({ soundTrendsFailed: (e as Error).message.slice(0, 300) }));
    return { soundTrends: 'failed', message: (e as Error).message.slice(0, 300) };
  }
}

/** This week's trending search words for a mood (none when the list is over 14 days old). */
export async function trendQueries(mood: string): Promise<{ queries: string[]; styles: string[] }> {
  const r = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'SOUNDTRENDS' } })).catch(() => undefined))?.Item;
  if (!r || Date.now() - Number(r.at) > 14 * DAY) return { queries: [], styles: [] };
  const fit = (r.styles as SoundStyle[]).filter((s) => s.mood === mood);
  return { queries: fit.map((s) => s.query), styles: fit.map((s) => s.style) };
}

/** GET part of /growth/results: the current styles. */
export async function soundTrendsRow(): Promise<{ at: number; styles: SoundStyle[] } | null> {
  const r = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'SOUNDTRENDS' } }))).Item;
  return r ? { at: Number(r.at), styles: r.styles as SoundStyle[] } : null;
}
