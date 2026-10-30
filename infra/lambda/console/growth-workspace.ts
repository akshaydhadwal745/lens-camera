// The growth agent's output as workspace tasks (docs/growth/growth-workspace.md W1.5): weekly
// recommendations, content opportunities and code proposals become Suggested tasks (one per dedupe
// key, refreshed while still Suggested), and the old ledger/proposal/opportunity rows migrate once.
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, json, type Res } from '../api/lib';
import type { Recommendation } from './growth-report';
import type { Fact } from './growth-facts';
import { productFacts } from './growth-facts';
import { goals as loadGoals, goalStatus, krProgress, milestoneProgress, milestones as loadMilestones, period, seedFromStrategy, settings as loadSettings, type Goal } from './growth-goals';
import { partners as loadPartners, posts as loadPosts } from './growth-records';
import { compute } from './analytics';
import { can, permissionsOf, teamMembers, type Role } from './roles';
import { getTask, listTasks, systemUpdate, upsertAiTask, type Status, type Task, type Workstream } from './growth-tasks';

const DAY = 86_400_000;
const plusDays = (n: number, from = Date.now()) => new Date(from + n * DAY).toISOString().slice(0, 10);
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

type OppFields = {
  topic: string;
  targetKeyword: string;
  action: string;
  demand: string;
  winnability: string;
  relevanceReason: string;
  demandEvidence: string;
  competition: string;
  existingPage: string;
  businessValue: string;
  measurement: string;
  facts: string[];
  brief: { url: string; title: string };
};

const OPP_WS: Record<string, Workstream> = { 'social-post': 'social', 'conversion-fix': 'store', experiment: 'store' };
const OPP_TYPE: Record<string, Task['type']> = { 'new-guide': 'page', 'landing-page': 'page', 'improve-page': 'content', 'faq-and-links': 'content', 'social-post': 'social', 'conversion-fix': 'fix', experiment: 'experiment' };
const OPP_HOURS: Record<string, number> = { 'improve-page': 4, 'faq-and-links': 2, 'new-guide': 8, 'landing-page': 12, 'social-post': 1, 'conversion-fix': 4, experiment: 6 };
const LEVEL: Record<string, 1 | 2 | 3> = { high: 3, medium: 2, low: 1, unmeasured: 1 };

/** A content opportunity as a task (its brief stays on the task for the drafting agent). */
export function oppTask(o: OppFields, score: number): Partial<Task> {
  const page = o.existingPage || o.brief.url;
  const title = o.action === 'improve-page' ? `Improve ${page} for “${o.targetKeyword}”` : o.action === 'social-post' ? `Social push: ${o.brief.title || o.topic}` : `${o.action === 'landing-page' ? 'New landing page' : o.action === 'faq-and-links' ? 'FAQ and links' : 'New guide'}: ${o.brief.title || o.topic}`;
  return {
    title: title.slice(0, 160),
    description: `${o.topic}. ${o.businessValue}`.slice(0, 4000),
    workstream: OPP_WS[o.action] ?? 'search',
    type: OPP_TYPE[o.action] ?? 'content',
    impact: LEVEL[o.demand] ?? 1,
    confidence: LEVEL[o.winnability] ?? 1,
    effortHours: OPP_HOURS[o.action] ?? 4,
    expectedImpact: `Opportunity score ${score} (relevance × demand × trend × winnability)`,
    evidence: [
      { text: o.demandEvidence, facts: o.facts, link: '' },
      { text: o.relevanceReason, facts: [], link: '' },
      { text: `Competition: ${o.competition}`, facts: [], link: '' },
    ].filter((e) => e.text),
    links: { page, keyword: o.targetKeyword, campaign: '', partner: '', post: '' },
    metric: { label: o.measurement, fact: '', baseline: '', baselineAt: plusDays(0), target: '', checkOn: plusDays(42) },
  };
}

/** A weekly recommendation as a task (an experiment with its metric and stop rule). */
export function recTask(r: Recommendation): Partial<Task> {
  return {
    title: r.title,
    description: `${r.hypothesis}\n\nCost: ${r.cost}. Time to result: ${r.timeToResult}. Risk: ${r.risk}. Stop if: ${r.stopRule}`,
    workstream: r.workstream ?? 'search',
    type: 'experiment',
    impact: 2,
    confidence: 2,
    effortHours: r.effort === 'low' ? 2 : r.effort === 'medium' ? 8 : 24,
    expectedImpact: r.expectedImpact,
    evidence: [{ text: r.hypothesis, facts: r.facts ?? [], link: '' }],
    metric: { label: r.metric, fact: '', baseline: '', baselineAt: plusDays(0), target: '', checkOn: plusDays(28) },
  };
}

/** A level-3 code proposal as a task (the change stays on the task for the drafting agent). */
export function propTask(p: { title: string; evidence: string; files: string[]; change: string; measurement: string }): Partial<Task> {
  return {
    title: p.title,
    description: p.change,
    workstream: 'search',
    type: 'fix',
    impact: 2,
    confidence: 3,
    effortHours: 1,
    evidence: [{ text: p.evidence, facts: [], link: '' }],
    links: { page: p.files[0] ?? '', keyword: '', campaign: '', partner: '', post: '' },
    metric: { label: p.measurement, fact: '', baseline: '', baselineAt: plusDays(0), target: '', checkOn: plusDays(28) },
  };
}

/** What the analyst sees as "previous recommendations": open tasks and those finished in the last 45 days. */
export async function tasksForAnalyst() {
  const cutoff = Date.now() - 45 * DAY;
  return (await listTasks())
    .filter((t) => !['measured', 'wontdo'].includes(t.status) || (t.measuredAt ?? t.updatedAt) > cutoff)
    .slice(0, 60)
    .map((t) => ({ id: t.id, title: t.title, status: t.status, createdAt: new Date(t.createdAt).toISOString().slice(0, 10), metric: t.metric.label, note: t.result ? `${t.result.verdict}: ${t.result.value}` : t.wontDoReason || undefined }));
}

// ---------- one-time migration of the old ledger, proposals and opportunities ----------

const REC_STATUS: Record<string, Status> = { proposed: 'suggested', approved: 'ready', shipped: 'done', measured: 'measured', kept: 'measured', dropped: 'wontdo' };
const PROP_STATUS: Record<string, Status> = { proposed: 'suggested', approved: 'ready', drafting: 'ready', 'pr-open': 'in_review', merged: 'done', closed: 'ready', rejected: 'wontdo' };
const OPP_STATUS: Record<string, Status> = { idea: 'suggested', planned: 'ready', drafting: 'ready', 'pr-open': 'in_review', published: 'done', measured: 'measured', rejected: 'wontdo' };

async function rows(prefix: string) {
  const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': prefix } }));
  return r.Items ?? [];
}

/** Idempotent: runs once (GROWTH / MIGRATED#TASKS), safe to call on every page load. */
export async function migrateLegacy(): Promise<number> {
  const marker = { pk: 'GROWTH', sk: 'MIGRATED#TASKS' };
  if ((await ddb.send(new GetCommand({ TableName: env.table, Key: marker }))).Item) return 0;
  let n = 0;
  const apply = async (id: string, status: Status, extra: Partial<Task>, note: string) => {
    const t = await getTask(id);
    if (t && t.status === 'suggested' && status !== 'suggested') await systemUpdate(id, { status, ...extra }, note);
    n++;
  };
  for (const r of await rows('REC#')) {
    const id = await upsertAiTask(`rec:${slug(String(r.title ?? r.id))}`, recTask(r as unknown as Recommendation), String(r.report ?? ''));
    const verdict = r.status === 'kept' ? 'worked' : r.status === 'measured' ? 'too_early' : undefined;
    await apply(id, REC_STATUS[r.status] ?? 'suggested', { ...(verdict ? { result: { value: String(r.note ?? ''), verdict, learning: '', at: Date.now(), by: 'migration' } } : {}), ...(r.status === 'dropped' ? { wontDoReason: String(r.note ?? 'Dropped in the old ledger') } : {}) }, `Migrated from recommendation ${r.id} (${r.status})`);
  }
  for (const p of await rows('PROP#')) {
    const fields = { title: String(p.title ?? ''), evidence: String(p.evidence ?? ''), files: (p.files ?? []) as string[], change: String(p.change ?? ''), measurement: String(p.measurement ?? '') };
    const id = await upsertAiTask(`prop:${p.id}`, propTask(fields), String(p.report ?? ''), { kind: 'prop', id: p.id, ...fields, validation: p.validation });
    await apply(id, PROP_STATUS[p.status] ?? 'suggested', { ...(p.pr ? { links: { page: fields.files[0] ?? '', keyword: '', campaign: '', partner: '', post: '', pr: { url: p.pr.url, number: p.pr.number } } } : {}), ...(p.status === 'rejected' ? { wontDoReason: String(p.note ?? 'Rejected') } : {}), ...(p.decidedBy ? { reviewer: String(p.decidedBy) } : {}) }, `Migrated from proposal ${p.id} (${p.status})`);
  }
  for (const o of await rows('OPP#')) {
    const { pk: _pk, sk: _sk, history: _h, ...spec } = o;
    const id = await upsertAiTask(`opp:${o.id}`, oppTask(o as unknown as OppFields, Number(o.score ?? 0)), String(o.lastSeen ?? ''), { kind: 'opp', ...spec });
    await apply(id, OPP_STATUS[o.status] ?? 'suggested', { ...(o.pr ? { links: { page: o.existingPage || o.brief?.url || '', keyword: o.targetKeyword ?? '', campaign: '', partner: '', post: '', pr: { url: o.pr.url, number: o.pr.number } } } : {}), ...(o.status === 'rejected' ? { wontDoReason: String(o.note ?? 'Not for us') } : {}), ...(o.decidedBy ? { reviewer: String(o.decidedBy) } : {}) }, `Migrated from content opportunity (${o.status})`);
  }
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...marker, at: Date.now(), count: n } }));
  return n;
}

// ---------- the workspace (GET /growth/workspace): everything the screens need, progress computed here ----------


const LIVE_MS = 6 * 3_600_000;

/** Product and website analytics, at most 6 hours old (shared with the Analytics page's cache). */
export async function liveAnalytics() {
  const k = { pk: 'STATS', sk: 'ANALYTICS#30' };
  const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: k }))).Item;
  if (cached && Date.now() - cached.data.at < LIVE_MS) return cached.data;
  const data = await compute(30);
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...k, data } }));
  return data;
}

async function latestReport() {
  const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'REPORT#' }, ScanIndexForward: false, Limit: 1 }));
  return r.Items?.[0];
}

export async function workspace(email: string, role: Role): Promise<Res> {
  await migrateLegacy();
  const team = (await teamMembers()).filter((m) => can(m.role, 'growth'));
  const ownerEmail = team.find((m) => m.role === 'owner')?.email ?? email;
  await seedFromStrategy(ownerEmail);
  await cleanupV2(ownerEmail);
  const [settings, goalRows, msRows, tasks, partnerRows, postRows, report, analytics] = await Promise.all([loadSettings(), loadGoals(), loadMilestones(), listTasks(), loadPartners(), loadPosts(), latestReport(), liveAnalytics()]);
  // Current metrics: this week's report (search, demand, GA4) overlaid with live product/website facts.
  const facts = new Map<string, Fact>();
  for (const f of (report?.facts ?? []) as Fact[]) facts.set(f.id, f);
  for (const f of productFacts(analytics)) facts.set(f.id, f);
  const liveCount = partnerRows.filter((p) => p.stage === 'live' || p.stage === 'won').length;
  const now = Date.now();
  const goalsOut = goalRows
    .sort((a: Goal, b: Goal) => ['now', 'd30', 'd90', 'health'].indexOf(a.horizon) - ['now', 'd30', 'd90', 'health'].indexOf(b.horizon))
    .map((g: Goal) => {
      const krs = g.krs.map((k) => {
        const current = k.source === 'manual' ? (k.value ?? null) : k.source === 'partners' ? liveCount : (facts.get(k.fact ?? '')?.value ?? null);
        return { ...k, current, progress: krProgress(k, current) };
      });
      const p = period(g, settings.launchDate);
      return { ...g, krs, period: p, ...goalStatus(krs.map((k) => k.progress), p, now, g.horizon), tasks: tasks.filter((t) => t.goalId === g.id).length };
    });
  const msOut = msRows.map((m) => ({ ...m, ...milestoneProgress(tasks.filter((t) => t.milestoneId === m.id)), blocked: tasks.filter((t) => t.milestoneId === m.id && t.status === 'blocked').map((t) => ({ id: t.id, title: t.title, blockedBy: t.blockedBy })) }));
  const campaignVisits = new Map<string, number>(((analytics.website?.campaigns ?? []) as { label: string; count: number }[]).map((c) => [c.label, c.count]));
  const ns = facts.get(settings.northStar);
  return json(200, {
    me: { email, role, permissions: permissionsOf(role) },
    settings,
    northStar: { fact: settings.northStar, label: ns?.label ?? settings.northStar, value: ns?.value ?? null, previous: ns?.previous ?? null, series: analytics.weeklyBackupSeries ?? [] },
    goals: goalsOut,
    milestones: msOut,
    tasks: tasks.sort((a, b) => a.priority - b.priority || b.updatedAt - a.updatedAt),
    team: team.map((m) => ({ email: m.email, role: m.role })),
    partners: partnerRows.map((p) => ({ ...p, visits: campaignVisits.get(String(p.code)) ?? 0 })),
    posts: postRows.map((p) => ({ ...p, visits: campaignVisits.get(String(p.code)) ?? 0 })),
    facts: [...facts.values()],
    analytics: { at: analytics.at, funnel: analytics.funnel, channels: analytics.channels, website: analytics.website, active: analytics.active?.today, features: analytics.features },
    report: report ? { date: report.date, at: report.at, summary: report.ai?.summary ?? null, findings: report.ai?.findings ?? report.rules ?? [], investigations: report.ai?.seoInvestigations ?? [], reviewOfPrevious: report.ai?.reviewOfPrevious ?? [], notes: report.notes ?? [], aiError: report.aiError ?? null, aiProblems: report.aiProblems ?? null, model: report.model } : null,
  });
}

// ---------- results loop and Monday digest (W4.1, W4.3): run from the Console's hourly job ----------

/** The verdict for a measured task: did the metric move from its baseline toward its target? */
export function verdictFor(baseline: number, current: number, target?: number): 'worked' | 'no_change' | 'worse' {
  const dir = target !== undefined && Number.isFinite(target) && target !== baseline ? Math.sign(target - baseline) : 1;
  const delta = current - baseline;
  const noise = Math.max(Math.abs(baseline) * 0.05, baseline === 0 ? 0.5 : 0);
  if (Math.abs(delta) <= noise) return 'no_change';
  return delta * dir > 0 ? 'worked' : 'worse';
}
const num = (s: string) => {
  const n = Number(String(s).replace(/[,%$₹\s]/g, ''));
  return Number.isFinite(n) && String(s).trim() !== '' ? (String(s).includes('%') ? n / 100 : n) : undefined;
};

/** Current metrics without recomputing: the latest report overlaid with the cached product analytics. */
async function cachedFacts(): Promise<Map<string, Fact>> {
  const facts = new Map<string, Fact>();
  for (const f of ((await latestReport())?.facts ?? []) as Fact[]) facts.set(f.id, f);
  const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'STATS', sk: 'ANALYTICS#30' } }))).Item;
  if (cached?.data) for (const f of productFacts(cached.data)) facts.set(f.id, f);
  return facts;
}

/** Once a day: capture baselines when work finishes, measure tasks whose check date came, nudge owners. */
export async function measureDue(now = Date.now()): Promise<{ baselines: number; measured: number; nudged: number }> {
  const today = new Date(now).toISOString().slice(0, 10);
  const facts = await cachedFacts();
  let baselines = 0;
  let measured = 0;
  let nudged = 0;
  for (const t of await listTasks()) {
    const f = t.metric.fact ? facts.get(t.metric.fact) : undefined;
    // Baseline: the metric's value when the work started being reviewed or shipped, if nobody set one.
    if (f && f.value !== null && !t.metric.baseline && ['in_progress', 'in_review', 'done'].includes(t.status)) {
      await systemUpdate(t.id, { metric: { ...t.metric, baseline: String(f.value), baselineAt: today } }, `Baseline recorded: ${f.label} = ${f.value}`);
      baselines++;
      continue;
    }
    if (t.status !== 'done' || !t.metric.checkOn || t.metric.checkOn > today || t.result) continue;
    const base = num(t.metric.baseline);
    if (f && f.value !== null && base !== undefined) {
      const verdict = verdictFor(base, f.value, num(t.metric.target));
      await systemUpdate(t.id, { status: 'measured', measuredAt: now, result: { value: `${f.label}: ${t.metric.baseline} → ${f.value} (${f.window})`, verdict, learning: '', at: now, by: 'agent' } }, `Measured on the check date: ${verdict.replace('_', ' ')}`);
      measured++;
    } else if (!(t as Task & { measurePrompted?: string }).measurePrompted) {
      // No machine-readable metric: ask the owner to record the result.
      await systemUpdate(t.id, { measurePrompted: today } as Partial<Task>, 'Check date reached: record the result (no metric the agent can read)');
      if (t.owner && t.owner !== 'agent') await notify([t.owner], `Record the result: ${t.title}`, `The check date for this task has come (${t.metric.checkOn}).\nWhat happened to "${t.metric.label || 'its metric'}"? Record the result so we learn what works:\n${CONSOLE}/growth/tasks?task=${t.id}`);
      nudged++;
    }
  }
  return { baselines, measured, nudged };
}

const CONSOLE = process.env.CONSOLE_ORIGIN ?? 'https://console.lens.instagrowapp.com';
async function notify(to: string[], subject: string, body: string) {
  const sender = process.env.CODE_SENDER ?? '';
  if (!sender.startsWith('no-reply@') || !to.length) return;
  await new SESv2Client({}).send(new SendEmailCommand({ FromEmailAddress: `Lens Console <${sender}>`, Destination: { ToAddresses: to }, Content: { Simple: { Subject: { Data: subject.slice(0, 180) }, Body: { Text: { Data: body } } } } })).catch((e) => console.error('growth notify', e));
}

/** The Monday digest for one person (pure: tested). Empty when there's nothing for them. */
export function digestFor(email: string, tasks: Task[], today: string): string {
  const open = (t: Task) => ['ready', 'in_progress', 'in_review', 'blocked'].includes(t.status);
  const week = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const mine = tasks.filter((t) => t.owner === email && open(t));
  const overdue = mine.filter((t) => t.due && t.due < today);
  const thisWeek = mine.filter((t) => t.due && t.due >= today && t.due <= week);
  const review = tasks.filter((t) => t.reviewer === email && t.status === 'in_review');
  const results = tasks.filter((t) => t.owner === email && t.status === 'measured' && t.result && (t.measuredAt ?? 0) > Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000);
  if (!mine.length && !review.length && !results.length) return '';
  const line = (t: Task) => `- [P${t.priority}] ${t.title}${t.due ? ` (due ${t.due})` : ''}\n  ${CONSOLE}/growth/tasks?task=${t.id}`;
  return [
    `Your growth week (${today})`,
    overdue.length ? `\nOverdue (${overdue.length}):\n${overdue.map(line).join('\n')}` : '',
    thisWeek.length ? `\nDue this week (${thisWeek.length}):\n${thisWeek.map(line).join('\n')}` : '',
    review.length ? `\nWaiting for your review (${review.length}):\n${review.map(line).join('\n')}` : '',
    results.length ? `\nResults measured last week:\n${results.map((t) => `- ${t.title}: ${t.result!.verdict.replace('_', ' ')} (${t.result!.value})`).join('\n')}` : '',
    `\nAll your open tasks (${mine.length}): ${CONSOLE}/growth/tasks?view=mine`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Hourly from the Console Lambda: the results loop once a day, the digest on Mondays 03:00 UTC (08:30 IST). */
export async function growthHousekeeping(now = Date.now()) {
  const d = new Date(now);
  const today = d.toISOString().slice(0, 10);
  const once = async (key: string) => {
    try {
      await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: key, at: now, ttl: Math.floor(now / 1000) + 40 * 86400 }, ConditionExpression: 'attribute_not_exists(pk)' }));
      return true;
    } catch {
      return false;
    }
  };
  const out: Record<string, unknown> = {};
  if (d.getUTCHours() >= 1 && (await once(`DAILY#${today}`))) out.measure = await measureDue(now);
  if (d.getUTCDay() === 1 && d.getUTCHours() >= 3 && (await once(`DIGEST#${today}`))) {
    const tasks = await listTasks();
    const team = (await teamMembers()).filter((m) => can(m.role, 'growth'));
    let sent = 0;
    for (const m of team) {
      const body = digestFor(m.email, tasks, today);
      if (body) {
        await notify([m.email], `Your growth week: ${tasks.filter((t) => t.owner === m.email && ['ready', 'in_progress', 'in_review', 'blocked'].includes(t.status)).length} open tasks`, body);
        sent++;
      }
    }
    out.digests = sent;
  }
  return out;
}

// ---------- one-time cleanup of the first migration (2026-10-30, owner review) ----------

type Fix = Partial<Task> & { note: string };
const plus = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

/** Explicit decisions for what the first migration brought in: done work, duplicates, held advice, real actions. */
export function cleanupPlan(owner: string): { ref?: RegExp; title?: RegExp; fix: Fix }[] {
  const ready = (ws: Workstream, priority: 0 | 1 | 2 | 3, due: number, extra: Partial<Task> = {}): Fix => ({ status: 'ready', workstream: ws, priority, owner, due: plus(due), note: 'Cleaned up: kept as a real action with an owner and a due date', ...extra });
  return [
    { ref: /^rec:get-the-website-s-pages-into-google/, fix: { status: 'done', workstream: 'search', proof: 'Google indexed 62 of 64 pages by 30 Oct 2026 (from 1)', note: 'Cleaned up: already done' } },
    { ref: /^rec:check-how-d1-and-d7-retention-are-counted/, fix: { status: 'done', workstream: 'retain', proof: 'Fixed 30 Oct 2026 (commit 9b56d49): D1/D7/D30 over a 90-day cohort, clearer labels', note: 'Cleaned up: already done' } },
    { ref: /^rec:make-the-first-backup-happen/, fix: { status: 'wontdo', workstream: 'retain', wontDoReason: 'On hold: too few installs to measure onboarding changes (the agent’s own advice, 30 Oct). Revisit after launch.', note: 'Cleaned up: held' } },
    { ref: /^rec:ask-people-to-sign-in-right-after/, fix: { status: 'wontdo', workstream: 'retain', wontDoReason: 'On hold: too few installs to measure onboarding changes. Revisit after launch.', note: 'Cleaned up: held' } },
    { ref: /^rec:keep-holding-onboarding-changes/, fix: { status: 'wontdo', workstream: 'retain', wontDoReason: 'Advice, not work: hold onboarding changes and paid ads until there are enough installs to measure.', note: 'Cleaned up: advice recorded' } },
    { ref: /^rec:approve-the-copy-fix-that-removes-unlimited/, fix: { status: 'wontdo', wontDoReason: 'Duplicate: the "unlimited" fix is in review (PR #9 and PR #10).', note: 'Cleaned up: duplicate' } },
    { ref: /^prop:P-2026-10-30-0541-17/, fix: { status: 'wontdo', wontDoReason: 'Duplicate of the other "unlimited" proposal; the fix is in review (PR #9).', note: 'Cleaned up: duplicate' } },
    { ref: /^prop:P-2026-10-30-0541-35/, fix: { status: 'in_review', reviewer: owner, links: { page: '/features/free-cloud-backup/', keyword: '', campaign: '', partner: '', post: '', pr: { url: 'https://github.com/akshaydhadwal745/lens-camera/pull/9', number: 9 } }, proof: 'https://github.com/akshaydhadwal745/lens-camera/pull/9', note: 'Cleaned up: linked to PR #9 (merge PR #10 first, then #9)' } },
    { ref: /^rec:try-qr-event-albums-yourself/, fix: { status: 'wontdo', wontDoReason: 'Duplicate of "Run one real QR event album at a wedding or party".', note: 'Cleaned up: duplicate' } },
    { ref: /^rec:run-one-real-qr-event-album/, fix: ready('loops', 1, 9, { type: 'experiment', metric: { label: 'Guests who joined the album; guests who installed', fact: 'loops.event_join', baseline: '0', baselineAt: plus(0), target: '25', checkOn: plus(16) } }) },
    { ref: /^rec:request-indexing-for-compare-google-photos/, fix: ready('search', 1, 2, { effortHours: 1, description: 'Search Console → URL Inspection → paste https://lens.instagrowapp.com/compare/google-photos/ → Request indexing. Google can’t do this through its API: it has to be a click.' }) },
    { ref: /^rec:add-tracking-tags-to-every-link/, fix: ready('social', 2, 7) },
    { ref: /^rec:ask-google-to-index-compare-google-photos/, fix: { status: 'wontdo', wontDoReason: 'Duplicate of "Request indexing for /compare/google-photos/".', note: 'Cleaned up: duplicate' } },
    // Strategy tasks: real priorities and dates (the first seed made small tasks P0).
    { title: /^Get 12\+ testers opted in/, fix: { priority: 0, due: plus(3), note: 'Cleaned up: priority and due date' } },
    { title: /^Decide: keep the name/, fix: { priority: 0, due: plus(4), note: 'Cleaned up: priority and due date' } },
    { title: /^Decide: launch wedge/, fix: { priority: 1, due: plus(7), note: 'Cleaned up: priority and due date' } },
    { title: /^Decide: one company identity/, fix: { priority: 1, due: plus(7), note: 'Cleaned up: priority and due date' } },
    { title: /^Decide: owner hours/, fix: { priority: 1, due: plus(7), note: 'Cleaned up: priority and due date' } },
    { title: /^Decide: cost levers/, fix: { priority: 2, due: plus(14), note: 'Cleaned up: priority and due date' } },
    { title: /^Testers → first community/, fix: { priority: 1, due: plus(5), note: 'Cleaned up: priority and due date' } },
    { title: /^Monthly review/, fix: { priority: 3, due: plus(30), note: 'Cleaned up: priority and due date' } },
    { title: /^Website download button and every/, fix: { priority: 1, note: 'Cleaned up: priority (launch day)' } },
  ];
}

export async function cleanupV2(owner: string): Promise<number> {
  const marker = { pk: 'GROWTH', sk: 'MIGRATED#TASKS2' };
  if ((await ddb.send(new GetCommand({ TableName: env.table, Key: marker }))).Item) return 0;
  const tasks = await listTasks();
  let n = 0;
  for (const { ref, title, fix } of cleanupPlan(owner)) {
    const { note, ...set } = fix;
    // Items already closed as Won't do stay closed (they were older duplicates).
    for (const t of tasks.filter((x) => x.status !== 'wontdo' && ((ref && ref.test(x.source?.ref ?? '')) || (title && title.test(x.title))))) {
      await systemUpdate(t.id, { ...set, ...(set.status === 'done' ? { doneAt: Date.now() } : {}) }, note);
      n++;
    }
  }
  // Anything else the first migration brought in as a suggestion: classify by words, not "search" for all.
  for (const t of tasks.filter((x) => x.source?.ref?.startsWith('rec:') && x.workstream === 'search' && x.status === 'suggested')) {
    const ws: Workstream = /sign.?in|backup|onboard|retention|first screen/i.test(t.title) ? 'retain' : /event|qr|invite|referr/i.test(t.title) ? 'loops' : /post|reddit|social|tag/i.test(t.title) ? 'social' : 'search';
    if (ws !== 'search') await systemUpdate(t.id, { workstream: ws }, 'Cleaned up: workstream');
  }
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...marker, at: Date.now(), count: n } }));
  return n;
}
