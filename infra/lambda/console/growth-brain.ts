// The brain (docs/growth/content-engine.md; owner 2026-11-11: "a Claude brain: why users aren't watching the reel,
// how it will get users engaged"). Weekly, Claude reads every published post's results (growth-ig-stats.ts) next to
// what the post was (format, hook, angle, scenes, voice lines, music mood, length, when it went out, our own score)
// and the account's daily numbers, explains in plain words why people watch, skip, save or share, and writes a
// playbook: lessons for the writer, the designer, the scorer and the schedule, and experiments to run next. The reel
// writer and the scorer read the lessons meant for them, so every new post starts from what worked. Code keeps it
// honest: a lesson must cite posts that exist; with fewer than 3 posts that have a day of results, no lessons yet.
//   GROWTH / PLAYBOOK          the current playbook { at, summary, lessons, experiments, dropOff, posts, status }
//   GROWTH / PLAYBOOK#<date>   past weeks
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, json, type Res } from '../api/lib';
import { runClaude, type Mode } from './growth';
import { soundTrendsRow } from './growth-sound-trends';

const DAY = 86_400_000;
export const MIN_POSTS = 3;

export type Lesson = { lesson: string; evidence: string; posts: string[]; confidence: 'low' | 'medium' | 'high'; applyTo: 'writer' | 'designer' | 'scorer' | 'schedule' };
export type Playbook = { at: number; status: 'ok' | 'not-enough-data' | 'failed'; summary: string; dropOff: string; lessons: Lesson[]; experiments: { idea: string; how: string; measure: string }[]; posts: number; message?: string };

export const BRAIN_SYSTEM = `You are the head of social for Lens, a camera and photo-backup app, and you study what actually happened to our Instagram posts. You get every published post with what it was (format, hook, angle, scenes, voice lines, music mood, length, the time it went out, our own pre-post score) and its real results at different ages (views, reach, average watch time and the share of the reel watched, likes, comments, shares, saves), plus the account's daily numbers.

Explain like a sharp, honest editor, in plain words, with numbers from the data:
- dropOff: where people leave and why. For reels, average watch time against the reel's length is the key: watched under 3 s means the first second didn't hook; under 40% means the middle loses them.
- What made people save (useful), share (relatable, "send this to the group") and comment, and what didn't.
- Whether our own score predicted results, and what it misses.
Then lessons, each with: the lesson as an instruction ("Open on the real moment, not the phone"), evidence (the numbers), posts (the ids it rests on), confidence (low with 1–2 posts, medium 3–5, high 6+), applyTo (writer, designer, scorer or schedule). 3 to 8 lessons; no generic social media advice that the data doesn't show.
Then 2 to 4 experiments for the next posts (one change each, how to run it, what number to compare).
Small numbers: our account is new, so say what the data can and can't tell yet; never pretend certainty.`;

export const BRAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'dropOff', 'lessons', 'experiments'],
  properties: {
    summary: { type: 'string', description: '3–5 plain sentences for the owner' },
    dropOff: { type: 'string' },
    lessons: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['lesson', 'evidence', 'posts', 'confidence', 'applyTo'], properties: { lesson: { type: 'string' }, evidence: { type: 'string' }, posts: { type: 'array', items: { type: 'string' } }, confidence: { type: 'string', enum: ['low', 'medium', 'high'] }, applyTo: { type: 'string', enum: ['writer', 'designer', 'scorer', 'schedule'] } } },
    },
    experiments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['idea', 'how', 'measure'], properties: { idea: { type: 'string' }, how: { type: 'string' }, measure: { type: 'string' } } } },
  },
} as const;

const BRAIN_MODE: Mode = { system: BRAIN_SYSTEM, schema: BRAIN_SCHEMA, toolNames: [], mode: 'report' };

async function all(prefix: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': prefix }, ExclusiveStartKey: start }));
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/** A published post as the brain sees it: what it was, and its results. Pure. */
export function postFacts(p: Record<string, any>) {
  const ig = p.published?.instagram ?? {};
  const rs = p.reelScript ?? {};
  const at = Number(ig.at) || 0;
  return {
    id: String(p.id),
    title: String(p.title ?? ''),
    format: String(p.format ?? ''),
    kind: String(ig.kind ?? ''),
    postedAt: at ? new Date(at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '',
    weekday: at ? new Date(at).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Kolkata' }) : '',
    hook: String(rs.hook ?? p.hook ?? ''),
    angle: String(rs.angle ?? ''),
    mood: rs.mood ?? null,
    seconds: Number(p.reel?.seconds) || null,
    scenes: ((rs.scenes ?? []) as { words?: string; vo?: string; shows?: string; seconds?: number }[]).map((s) => ({ screen: s.words, voice: s.vo, shows: s.shows, seconds: s.seconds })),
    slides: ((p.slides ?? []) as { title?: string }[]).map((s) => s.title).filter(Boolean).slice(0, 10),
    ourScore: p.reelScore?.total ?? p.score?.total ?? null,
    results: p.statsHistory?.instagram ?? [],
  };
}

/** Lessons whose posts aren't real are dropped (the model may not invent evidence). Pure. */
export const realLessons = (lessons: Lesson[], ids: Set<string>): Lesson[] => lessons.filter((l) => l.posts.length && l.posts.every((x) => ids.has(x))).slice(0, 8);

/** The weekly run. */
export async function runBrain(now = Date.now()): Promise<Playbook> {
  const posts = (await all('POST#')).filter((p) => p.published?.instagram?.mediaId);
  const withDay = posts.filter((p) => (p.stats?.instagram?.ageHours ?? 0) >= 24);
  const days = (await all('IGDAY#')).filter((d) => d.day >= new Date(now - 60 * DAY).toISOString().slice(0, 10)).map(({ pk: _p, sk: _s, ttl: _t, at: _a, ...d }) => d);
  const save = async (pb: Playbook) => {
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'PLAYBOOK', ...pb } }));
    if (pb.status === 'ok') await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `PLAYBOOK#${new Date(now).toISOString().slice(0, 10)}`, ...pb, ttl: Math.floor((now + 400 * DAY) / 1000) } }));
    console.log(JSON.stringify({ brain: pb.status, lessons: pb.lessons.length, posts: pb.posts }));
    return pb;
  };
  const empty = { summary: '', dropOff: '', lessons: [], experiments: [] };
  if (withDay.length < MIN_POSTS) return save({ at: now, status: 'not-enough-data', ...empty, posts: withDay.length, message: `${withDay.length} of ${MIN_POSTS} posts have a day of results. The brain starts once ${MIN_POSTS} do.` });
  const token = await getParam('/lens/growth/claude-token').catch(() => undefined);
  if (!token) return save({ at: now, status: 'failed', ...empty, posts: withDay.length, message: 'No Claude token' });
  const facts = withDay.map(postFacts);
  const prev = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'PLAYBOOK' } }))).Item as Playbook | undefined;
  const prompt = `Our published posts and their results (JSON):\n${JSON.stringify(facts, null, 1)}\n\nThe account by day (followers, reach, profile views, website clicks):\n${JSON.stringify(days)}\n\n${prev?.status === 'ok' ? `Last week's lessons (keep, change or drop them by what this week shows):\n${prev.lessons.map((l) => `- [${l.applyTo}] ${l.lesson}`).join('\n')}\nLast week's experiments:\n${prev.experiments.map((e) => `- ${e.idea}`).join('\n')}` : 'This is the first playbook.'}`;
  try {
    const { report } = await runClaude<Omit<Playbook, 'at' | 'status' | 'posts'>>(prompt, token, { enabled: [] }, now + 10 * 60_000, BRAIN_MODE);
    const ids = new Set(facts.map((f) => f.id));
    return save({ at: now, status: 'ok', summary: String(report.summary ?? '').slice(0, 1500), dropOff: String(report.dropOff ?? '').slice(0, 800), lessons: realLessons((report.lessons ?? []) as Lesson[], ids), experiments: ((report.experiments ?? []) as Playbook['experiments']).slice(0, 4), posts: withDay.length });
  } catch (e) {
    return save({ at: now, status: 'failed', ...empty, posts: withDay.length, message: (e as Error).message.slice(0, 300) });
  }
}

/** What the writer / designer / scorer is told from the playbook (empty until there is one). */
export async function playbookFor(target: Lesson['applyTo']): Promise<string> {
  const pb = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'PLAYBOOK' } })).catch(() => undefined))?.Item as Playbook | undefined;
  const ls = pb?.status === 'ok' ? pb.lessons.filter((l) => l.applyTo === target) : [];
  return ls.length ? `\n\nWhat our real Instagram results have shown so far (the brain's playbook, ${new Date(pb!.at).toISOString().slice(0, 10)}; follow these):\n${ls.map((l) => `- ${l.lesson} (${l.evidence}; confidence ${l.confidence})`).join('\n')}` : '';
}

/** GET /growth/results: the playbook, each published post's latest numbers, and the account by day. */
export async function resultsPage(): Promise<Res> {
  const [pb, posts, days, sounds] = await Promise.all([ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'PLAYBOOK' } })), all('POST#'), all('IGDAY#'), soundTrendsRow().catch(() => null)]);
  const { pk: _p, sk: _s, ...playbook } = pb.Item ?? {};
  return json(200, {
    playbook: pb.Item ? playbook : null,
    sounds,
    posts: posts
      .filter((p) => p.published?.instagram)
      .sort((a, b) => Number(b.published.instagram.at) - Number(a.published.instagram.at))
      .map((p) => ({ id: p.id, title: p.title, format: p.format, kind: p.published.instagram.kind, at: p.published.instagram.at, url: p.published.instagram.url, seconds: p.reel?.seconds ?? null, ourScore: p.reelScore?.total ?? p.score?.total ?? null, stats: p.stats?.instagram ?? null })),
    days: days.map(({ pk: _a, sk: _b, ttl: _c, ...d }) => d).sort((a, b) => String(a.day).localeCompare(String(b.day))).slice(-60),
  });
}
