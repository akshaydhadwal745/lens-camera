// The growth agent's output as workspace tasks (docs/growth/growth-workspace.md W1.5): weekly
// recommendations, content opportunities and code proposals become Suggested tasks (one per dedupe
// key, refreshed while still Suggested), and the old ledger/proposal/opportunity rows migrate once.
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
async function liveAnalytics() {
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
  await seedFromStrategy(team.find((m) => m.role === 'owner')?.email ?? email);
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
