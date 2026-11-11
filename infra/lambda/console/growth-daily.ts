// Daily posting (docs/growth/content-engine.md; owner 2026-11-11: "make it automatic", after the first reel reached 3
// people on a 0-follower account: a new account grows by posting every day). Every morning one reel is made from the
// day's idea: a strong moment in the next 2–5 days (concerts, festivals, matches, trends) or, when none fits, the next
// evergreen idea (never one of the last 10). The content chain drafts it, makes the photos, the reel, the voice and the
// music as for any post. Then a quality gate decides: a reel that scores at least AUTO_MIN with nothing to fix is
// approved by the gate and scheduled for the evening (published as a trial reel while the account is small); anything
// else stays In review and the owners get an email. The Console switch (Content → Results) turns it off.
//   GROWTH / AUTOPOST        { on, by, at }  (no row = on)
//   GROWTH / DAILY#<date>    { taskId, idea, source: moment|evergreen, at }
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, type Res } from '../api/lib';
import { MOMENT_RULES } from './growth-moments';
import { createTask } from './growth-tasks';

const DAY = 86_400_000;
/** The lowest reel score the gate lets out on its own. */
export const AUTO_MIN = 60;
/** When approved daily reels go out: 18:30 IST (13:00 UTC), the evening peak for our biggest audience. */
export const POST_HOUR_UTC = 13;

/** Evergreen ideas: real moments where Lens helps (the writer checks every claim against the product facts). */
export const EVERGREEN: { idea: string; pillar: string; page: string }[] = [
  { idea: 'POV: "Storage full" pops up at the best moment (a concert, a first step, a sunset). Free up space safely before it happens.', pillar: 'backup', page: '/' },
  { idea: 'What sending photos over a chat app does to them: full quality on your phone, a soft compressed copy for everyone else. Share full-quality links instead.', pillar: 'quality', page: '/' },
  { idea: "A wedding's photos end up on forty guests' phones. One event album with a QR code gathers every guest's photos at full quality.", pillar: 'events', page: '/use-cases/wedding-and-event-photos/' },
  { idea: 'The only copy of your baby\'s first steps is on one phone. Back it up in full quality before the phone breaks or gets lost.', pillar: 'backup', page: '/' },
  { idea: 'Trip photos: phone full on day 3 of a holiday. Back up as you go and free space on the road.', pillar: 'backup', page: '/' },
  { idea: 'Birthday party: every parent took photos, nobody shares them. One album, one QR code, everyone adds theirs.', pillar: 'events', page: '/use-cases/wedding-and-event-photos/' },
  { idea: 'Switching phones: years of photos, nothing lost when your photos are backed up in full quality.', pillar: 'backup', page: '/' },
  { idea: 'Free up space without deleting a single memory: back up first, then clear the phone safely.', pillar: 'backup', page: '/' },
  { idea: 'Side by side: the original photo vs the copy that came back from the group chat. Spot the difference.', pillar: 'quality', page: '/' },
  { idea: 'Night photos at a festival or a party that come out muddy. Shoot with Night mode and keep the original.', pillar: 'camera', page: '/' },
  { idea: 'College fest / office party: "send me the pics" in the group chat for a week. One event album fixes it.', pillar: 'events', page: '/use-cases/wedding-and-event-photos/' },
  { idea: '10 GB free, forever: what fits in it (years of everyday photos) and why the free plan is enough for most people.', pillar: 'backup', page: '/' },
];

/** Today's idea: a strong upcoming moment not used yet, else the next evergreen idea not in the last 10. Pure. */
export function pickIdea(
  today: string,
  moments: { id: string; title: string; day: string; score: number; kind: string; taskId?: string; angle?: string }[],
  recent: string[],
): { source: 'moment'; moment: (typeof moments)[number] } | { source: 'evergreen'; idea: (typeof EVERGREEN)[number] } {
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const soon = moments
    .filter((m) => !m.taskId && m.score >= 65 && ['concert', 'festival', 'match', 'trend', 'season'].includes(m.kind) && !recent.includes(`moment:${m.id}`))
    .filter((m) => {
      const d = (Date.parse(`${m.day}T00:00:00Z`) - t0) / DAY;
      return d >= 2 && d <= 5;
    })
    .sort((a, b) => b.score - a.score);
  if (soon[0]) return { source: 'moment', moment: soon[0] };
  const used = new Set(recent.slice(0, 10));
  const day = Math.floor(t0 / DAY);
  for (let k = 0; k < EVERGREEN.length; k++) {
    const idea = EVERGREEN[(day + k) % EVERGREEN.length];
    if (!used.has(`evergreen:${idea.idea.slice(0, 40)}`)) return { source: 'evergreen', idea };
  }
  return { source: 'evergreen', idea: EVERGREEN[day % EVERGREEN.length] };
}

export async function autoPostOn(): Promise<boolean> {
  const r = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'AUTOPOST' } }))).Item;
  return r?.on !== false;
}

async function rowsOf(prefix: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': prefix }, ExclusiveStartKey: start }));
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/** The morning run (rule GrowthDaily): one reel task for today, unless switched off or already made. */
export async function dailyContent(now = Date.now()): Promise<Record<string, unknown>> {
  if (!(await autoPostOn())) return { daily: 'off' };
  const today = new Date(now).toISOString().slice(0, 10);
  if ((await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `DAILY#${today}` } }))).Item) return { daily: 'already made today' };
  const recent = (await rowsOf('DAILY#')).sort((a, b) => String(b.sk).localeCompare(String(a.sk))).map((r) => String(r.ref ?? ''));
  const moments = (await rowsOf('MOMENT#')) as { id: string; title: string; day: string; score: number; kind: string; taskId?: string; angle?: string }[];
  const pick = pickIdea(today, moments, recent);
  const rule = 'Make exactly ONE package, format reel, for instagram (other platforms only if they are focus platforms). It is posted automatically if it passes the quality checks, so every claim must match the product facts.';
  const fields =
    pick.source === 'moment'
      ? { title: `Daily reel: ${pick.moment.title}`.slice(0, 120), description: `Today's daily reel is about an upcoming moment: ${pick.moment.title} on ${pick.moment.day}. Angle: ${pick.moment.angle ?? ''}\n\n${rule}\n\nRules for someone else's event:\n${MOMENT_RULES.map((r) => `- ${r}`).join('\n')}` }
      : { title: `Daily reel: ${pick.idea.idea.slice(0, 80)}`, description: `Today's daily reel (evergreen, pillar ${pick.idea.pillar}): ${pick.idea.idea}\nWebsite page: ${pick.idea.page}\n\n${rule}` };
  const task = await createTask(
    { ...fields, workstream: 'social', type: 'social', status: 'ready', due: today, impact: 2, confidence: 2, effortHours: 1, owner: 'agent', reviewer: '', expectedImpact: 'A new reel every day: reach from non-followers (trial reels) and the brain learns what works.' },
    'daily',
    { kind: 'ai', by: 'daily' },
    { makeAll: true, auto: true, onlyFormat: 'reel', ...(pick.source === 'moment' ? { moment: { id: pick.moment.id, title: pick.moment.title, day: pick.moment.day } } : {}) },
  );
  if (pick.source === 'moment') await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `MOMENT#${pick.moment.id}` }, UpdateExpression: 'SET taskId = :t', ExpressionAttributeValues: { ':t': task.id } }));
  const ref = pick.source === 'moment' ? `moment:${pick.moment.id}` : `evergreen:${pick.idea.idea.slice(0, 40)}`;
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `DAILY#${today}`, taskId: task.id, ref, source: pick.source, idea: fields.title, at: now, ttl: Math.floor((now + 120 * DAY) / 1000) } }));
  console.log(JSON.stringify({ daily: today, task: task.id, ref }));
  return { daily: today, task: task.id, ref };
}

/** The evening slot after `now`: today's if at least 30 minutes away, else tomorrow's. Pure. */
export function nextSlot(now: number): number {
  const d = new Date(now);
  const slot = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), POST_HOUR_UTC, 0);
  return slot - now >= 30 * 60_000 ? slot : slot + DAY;
}

/** The gate (content chain): daily reels that are ready get approved and scheduled, or held with an email. */
export async function autoGate(now = Date.now()): Promise<string[]> {
  if (!(await autoPostOn())) return [];
  const done: string[] = [];
  for (const p of await rowsOf('POST#')) {
    if (!p.auto || p.status !== 'in_review' || (p.published && Object.keys(p.published).length) || p.autoGate) continue;
    const reelReady = p.reel?.assetId && Number(p.reel.at) > Number(p.createdAt ?? 0);
    if (!reelReady) {
      if (p.make?.reel === 'failed' || p.make?.images === 'failed') await hold(p, 'its reel or images could not be made', now);
      continue;
    }
    const score = Number(p.reelScore?.total) || 0;
    if ((p.problems ?? []).length) await hold(p, `it has things to fix: ${(p.problems as string[]).join('; ')}`, now);
    else if (score < AUTO_MIN) await hold(p, `the reel scored ${score}, under the ${AUTO_MIN} the gate lets out on its own`, now);
    else {
      const at = nextSlot(now);
      await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${p.id}` }, UpdateExpression: 'SET #s = :s, schedule = :sc, scheduledBy = :by, approvedBy = :by, approvedAt = :now, autoGate = :g', ConditionExpression: '#s = :rev', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':s': 'scheduled', ':sc': { ...(p.schedule ?? {}), instagram: at }, ':by': `auto (quality gate, score ${score})`, ':now': now, ':g': { result: 'scheduled', score, at: now }, ':rev': 'in_review' } }));
      console.log(JSON.stringify({ autoGate: p.id, scheduled: new Date(at).toISOString(), score }));
    }
    done.push(p.id);
  }
  return done;
}

async function hold(p: Record<string, any>, why: string, now: number) {
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${p.id}` }, UpdateExpression: 'SET autoGate = :g', ExpressionAttributeValues: { ':g': { result: 'held', why, at: now } } }));
  const to = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const sender = process.env.CODE_SENDER ?? '';
  if (sender.startsWith('no-reply@') && to.length)
    await new SESv2Client({}).send(new SendEmailCommand({ FromEmailAddress: `Lens Console <${sender}>`, Destination: { ToAddresses: to }, Content: { Simple: { Subject: { Data: `Today's reel needs you: ${String(p.title ?? '').slice(0, 80)}` }, Body: { Text: { Data: `Today's daily reel was not posted automatically because ${why}.\n\nIt is In review in the Console (Content). Approve and post it, redraft it, or leave it.\n${process.env.CONSOLE_ORIGIN ?? ''}/growth/ws/social` } } } } })).catch(() => undefined);
  console.log(JSON.stringify({ autoGate: p.id, held: why }));
}

/** PUT /growth/autopost {on}: the Console switch. */
export async function autoPostSet(body: Record<string, unknown> | undefined, by: string): Promise<Res> {
  if (typeof body?.on !== 'boolean') throw new HttpError(400, 'on must be true or false');
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'AUTOPOST', on: body.on, by, at: Date.now() } }));
  return json(200, { on: body.on });
}

/** What the Results tab shows about daily posting. */
export async function dailyStatus(): Promise<{ on: boolean; recent: { day: string; idea: string; source: string }[] }> {
  const days = (await rowsOf('DAILY#')).sort((a, b) => String(b.sk).localeCompare(String(a.sk))).slice(0, 7);
  return { on: await autoPostOn(), recent: days.map((d) => ({ day: String(d.sk).slice(6), idea: String(d.idea ?? ''), source: String(d.source ?? '') })) };
}
