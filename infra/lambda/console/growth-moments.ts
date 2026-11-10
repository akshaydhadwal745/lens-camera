// Moments in the Content tab (docs/growth/content-engine.md, "Moments"): the next 30 days of dated events
// from the daily pull (api/growth-moments.ts), and "Make content", which turns one into a social task the
// agent drafts packages from — timed before, on and after the day, with the legal rules in the brief.
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, Res } from '../api/lib';
import { SENSITIVE, type Moment } from '../api/growth-moments';
import { startDraft } from './growth'; // a cycle (growth.ts uses packageDay), fine: both only call at run time
import { createTask, getTask } from './growth-tasks';

const DAY = 86_400_000;

/** What the agent must never do with someone else's event (trademarks, ambush marketing, footage). */
export const MOMENT_RULES = [
  'Event, league, team and artist names only as plain words or hashtags: no logos, crests, kits, mascots or official artwork.',
  'Never say or suggest Lens is official, a partner, a sponsor or "in association with" the event.',
  'No match, concert or broadcast footage or photos from the event; visuals are our own (templates, real Lens photos, app screens).',
  'Be kind and inclusive: no jokes about religions, teams or countries; never use a festival to pressure people into buying.',
];

type Row = Moment & { taskId?: string; at: number };

async function rows(): Promise<{ moments: Row[]; meta?: Record<string, any> }> {
  const out: Record<string, any>[] = [];
  let start: Record<string, any> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'MOMENT' }, ExclusiveStartKey: start }));
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  const meta = out.find((i) => i.sk === 'MOMENTS');
  return { moments: out.filter((i) => String(i.sk).startsWith('MOMENT#')) as Row[], meta };
}

/** Moments still ahead (or a season still on), soonest first; best score first on the same day. */
export function upcoming(all: Row[], today: string): Row[] {
  // Rows from an older pull are hidden by today's rules too (they expire 14 days after their day).
  const CORE = ['IN', 'US', 'GB', 'AU', 'CA', 'WW'];
  return all
    .filter((m) => (m.ends ?? m.day) >= today && !SENSITIVE.test(m.title) && (m.kind !== 'holiday' || m.countries.some((c) => CORE.includes(c)) || m.score >= 50))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : b.score - a.score));
}

export async function momentsPage(): Promise<Res> {
  const { moments, meta } = await rows();
  const today = new Date().toISOString().slice(0, 10);
  return json(200, { moments: upcoming(moments, today), sources: meta?.sources ?? {}, checkedAt: meta?.at ?? null });
}

/** The brief a person approves by pressing "Make content" (the agent reads it as the task). */
export function momentBrief(m: Moment, today: string): { title: string; description: string; due: string } {
  const when = m.ends ? `${m.day} to ${m.ends}` : m.time ? `${m.day} (${m.time})` : m.day;
  const description = [
    `Moment: ${m.title} — ${when}, ${m.countries.includes('WW') ? 'worldwide' : m.countries.join(', ')} (source: ${m.source}).`,
    `Angle: ${m.angle}`,
    `Formats that suit it: ${m.formats.join(', ')}. Hashtags to start from: ${m.hashtags.join(' ')} (add the brand kit's own).`,
    m.ends
      ? 'Timing: one package early in the season and one for its busiest weeks.'
      : "Timing: one package a few days before (get ready: free up space, set up the album), one for the day itself and, if it fits, one the day after (back up and share the photos). Set each package's day relative to the moment.",
    'Packages (the full set; images and the reel are made automatically after you): exactly three, for the focus platforms. 1) A reel (format reel): a 20–25 second script, 5–7 scenes, for Instagram and Facebook, dayOffset −3. 2) A carousel (format carousel), 5–7 slides, for Instagram and Facebook, dayOffset 0. 3) One sharp X post (format post, x version only) with a short punchy text, dayOffset 0 (or −1 for an evening event).',
    `Rules for event content:\n- ${MOMENT_RULES.join('\n- ')}`,
  ].join('\n\n');
  const lead = Date.parse(`${m.day}T00:00:00Z`) - 3 * DAY;
  const due = new Date(Math.max(lead, Date.parse(`${today}T00:00:00Z`))).toISOString().slice(0, 10);
  return { title: `Moment: ${m.title} (${m.day})`.slice(0, 160), description, due };
}

/** A drafted package's day: from today (0–14), or for a moment from its day (−14 to +7), never in the past. */
export function packageDay(started: number, dayOffset: number, momentDay?: string): string {
  const off = Math.round(Number(dayOffset) || 0);
  const today = Date.parse(`${new Date(started).toISOString().slice(0, 10)}T00:00:00Z`);
  const t = momentDay ? Date.parse(`${momentDay}T00:00:00Z`) + Math.max(-14, Math.min(7, off)) * DAY : today + Math.max(0, Math.min(14, off)) * DAY;
  return new Date(Math.max(t, today)).toISOString().slice(0, 10);
}

/** "Make content": one social task per moment (pressing it again opens the same task). */
export async function momentContent(id: string, by: string): Promise<Res> {
  if (!/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad moment id');
  const { moments } = await rows();
  const m = moments.find((x) => x.id === id);
  if (!m) throw new HttpError(404, 'This moment is no longer in the feed');
  if (m.taskId && (await getTask(m.taskId))) return json(200, { taskId: m.taskId, existing: true });
  const today = new Date().toISOString().slice(0, 10);
  const b = momentBrief(m, today);
  const moment: Moment = { id: m.id, title: m.title, kind: m.kind, day: m.day, ...(m.ends ? { ends: m.ends } : {}), ...(m.time ? { time: m.time } : {}), countries: m.countries, source: m.source, url: m.url, score: m.score, angle: m.angle, formats: m.formats, hashtags: m.hashtags };
  const task = await createTask(
    { title: b.title, description: b.description, workstream: 'social', type: 'social', status: 'ready', due: b.due, impact: 2, confidence: 2, effortHours: 1, owner: 'agent', reviewer: by, expectedImpact: 'Timely posts people share around the moment' },
    by,
    { kind: 'person', by },
    { moment, makeAll: true },
  );
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `MOMENT#${id}` }, UpdateExpression: 'SET taskId = :t', ExpressionAttributeValues: { ':t': task.id } }));
  // Draft right away when the agent is free; otherwise the content chain starts it (growth-chain.ts, every 10 min).
  const started = await startDraft(task.id, by).catch(() => 'busy' as const);
  return json(200, { taskId: task.id, existing: false, drafting: started === 'started' });
}
