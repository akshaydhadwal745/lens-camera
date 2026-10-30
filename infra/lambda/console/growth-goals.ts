// Growth workspace direction (docs/growth/growth-workspace.md W2): settings, goals with key results
// bound to real metrics, milestones made of tasks, and progress computed from both (never typed in).
//   GROWTH / SETTINGS    north star, launch date, month focus, workstream owners
//   GROWTH / GOAL#<id>   { title, horizon, start/end or days after launch, owner, krs[] }
//   GROWTH / MS#<id>     { goalId, title, due }
// Seeded once from docs/growth/growth-strategy.md (§3 phases, §4 targets, §5 decisions).
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, Req, Res } from '../api/lib';
import { createTask, type Task, type Workstream } from './growth-tasks';
import { log } from './log';

const DAY = 86_400_000;
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export type KeyResult = {
  id: string;
  label: string;
  source: 'fact' | 'manual' | 'partners';
  fact?: string; // when source = fact
  value?: number; // when source = manual
  history?: { at: number; value: number; by: string }[];
  baseline: number;
  target: number;
  unit: 'count' | 'pct' | 'usd';
};
export type Goal = { id: string; title: string; why: string; horizon: 'now' | 'd30' | 'd90' | 'health'; start?: string; end?: string; afterLaunchDays?: number; owner: string; krs: KeyResult[] };
export type Milestone = { id: string; goalId: string; title: string; due?: string; afterLaunchDays?: number };
export type Settings = { northStar: string; launchDate: string; focus: { text: string; by: string; at: number; reviewOn: string }; wsOwners: Partial<Record<Workstream, string>> };

// ---------- progress (pure: tested in growth-goals.test.ts) ----------

/** 0..1: how far the current value has moved from the baseline toward the target (either direction). */
export function krProgress(kr: { baseline: number; target: number }, current: number | null | undefined): number | null {
  if (current === null || current === undefined || !Number.isFinite(current)) return null;
  if (kr.target === kr.baseline) return current >= kr.target ? 1 : 0;
  return Math.max(0, Math.min(1, (current - kr.baseline) / (kr.target - kr.baseline)));
}

/** The goal's period: fixed dates, or days after the Play launch (unknown until the launch date is set). */
export function period(g: Pick<Goal, 'start' | 'end' | 'afterLaunchDays'>, launchDate: string): { start: string; end: string } | null {
  if (g.start && g.end) return { start: g.start, end: g.end };
  if (g.afterLaunchDays && launchDate) return { start: launchDate, end: plus(launchDate, g.afterLaunchDays) };
  return null;
}

export type GoalStatus = 'not_started' | 'on_track' | 'at_risk' | 'behind' | 'done' | 'ongoing';

/** On track when average KR progress keeps pace with the share of the period elapsed (10/25-point bands). */
export function goalStatus(progress: (number | null)[], p: { start: string; end: string } | null, now = Date.now(), horizon?: Goal['horizon']): { status: GoalStatus; elapsed: number | null; average: number | null } {
  const known = progress.filter((x): x is number => x !== null);
  const average = known.length ? known.reduce((s, x) => s + x, 0) / known.length : null;
  if (horizon === 'health') return { status: average !== null && average >= 1 ? 'on_track' : average === null ? 'ongoing' : 'at_risk', elapsed: null, average };
  if (known.length && known.every((x) => x >= 1)) return { status: 'done', elapsed: null, average };
  if (!p) return { status: 'not_started', elapsed: null, average };
  const start = Date.parse(`${p.start}T00:00:00Z`);
  const end = Date.parse(`${p.end}T23:59:59Z`);
  if (now < start) return { status: 'not_started', elapsed: 0, average };
  const elapsed = Math.min(1, (now - start) / (end - start));
  const gap = elapsed - (average ?? 0);
  return { status: gap <= 0.1 ? 'on_track' : gap <= 0.25 ? 'at_risk' : 'behind', elapsed, average };
}

/** Verified-done tasks ÷ all (won't-do excluded), weighted by effort. */
export function milestoneProgress(tasks: Pick<Task, 'status' | 'effortHours'>[]): { done: number; total: number; share: number | null } {
  const counted = tasks.filter((t) => t.status !== 'wontdo');
  const w = (t: Pick<Task, 'effortHours'>) => Math.max(1, t.effortHours || 1);
  const total = counted.reduce((s, t) => s + w(t), 0);
  const done = counted.filter((t) => t.status === 'done' || t.status === 'measured').reduce((s, t) => s + w(t), 0);
  return { done: counted.filter((t) => t.status === 'done' || t.status === 'measured').length, total: counted.length, share: total ? done / total : null };
}

// ---------- storage ----------

async function rows<T>(prefix: string): Promise<T[]> {
  const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': prefix } }));
  return (r.Items ?? []) as T[];
}
export const goals = () => rows<Goal>('GOAL#');
export const milestones = () => rows<Milestone>('MS#');

const DEFAULT_SETTINGS: Settings = { northStar: 'app.weekly_backup_users', launchDate: '', focus: { text: '', by: '', at: 0, reviewOn: '' }, wsOwners: {} };
export async function settings(): Promise<Settings> {
  const s = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'SETTINGS' } }))).Item as Settings | undefined;
  return { ...DEFAULT_SETTINGS, ...(s ?? {}), focus: { ...DEFAULT_SETTINGS.focus, ...(s?.focus ?? {}) }, wsOwners: s?.wsOwners ?? {} };
}

// ---------- seed (once) from growth-strategy.md ----------

export async function seedFromStrategy(owner: string): Promise<boolean> {
  const marker = { pk: 'GROWTH', sk: 'SEEDED#STRATEGY' };
  if ((await ddb.send(new GetCommand({ TableName: env.table, Key: marker }))).Item) return false;
  const t0 = today();
  const kr = (id: string, label: string, source: KeyResult['source'], baseline: number, target: number, extra: Partial<KeyResult> = {}): KeyResult => ({ id, label, source, baseline, target, unit: 'count', ...extra });
  const G: Goal[] = [
    { id: 'O1', title: 'Launch on Google Play', why: 'Production access needs 12 testers opted in for 14 continuous days; launch unlocks every other channel.', horizon: 'now', start: t0, end: plus(t0, 30), owner, krs: [kr('O1.1', 'Testers opted in', 'manual', 0, 12, { value: 0 }), kr('O1.2', 'Days of closed test with 12+ testers', 'manual', 0, 14, { value: 0 }), kr('O1.3', 'Pages indexed by Google', 'fact', 1, 60, { fact: 'search.indexed_pages' })] },
    { id: 'O2', title: 'First real users (30 days after launch)', why: 'Prove people outside our circle find Lens, back up and come back. Recalibrate after 4 weeks of data.', horizon: 'd30', afterLaunchDays: 30, owner, krs: [kr('O2.1', 'Installs in 30 days', 'fact', 0, 300, { fact: 'app.installs' }), kr('O2.2', 'Weekly backup users', 'fact', 0, 100, { fact: 'app.weekly_backup_users' }), kr('O2.3', 'Play ratings ≥ 4.5★', 'manual', 0, 20, { value: 0 }), kr('O2.4', 'People who made event albums (30 days)', 'fact', 0, 10, { fact: 'loops.server_event_album' })] },
    { id: 'O3', title: 'Loops that compound (90 days after launch)', why: 'Growth that feeds itself: retention, paying users and partners who bring events every week.', horizon: 'd90', afterLaunchDays: 90, owner, krs: [kr('O3.1', 'Weekly backup users', 'fact', 0, 1000, { fact: 'app.weekly_backup_users' }), kr('O3.2', 'Came back 7+ days after installing', 'fact', 0, 0.2, { fact: 'app.came_back_7d_rate', unit: 'pct' }), kr('O3.3', 'Paying Plus users', 'fact', 0, 30, { fact: 'money.paying' }), kr('O3.4', 'Partners live', 'partners', 0, 5)] },
    { id: 'H', title: 'Health guardrails', why: 'Growth must not break trust or the budget.', horizon: 'health', owner, krs: [kr('H.1', 'Crash-free sessions (%)', 'manual', 0, 99.5, { value: 99.5 }), kr('H.2', 'Storage cost of new accounts, $ a month', 'fact', 10, 0, { fact: 'money.storage_cost', unit: 'usd' })] },
  ];
  const M: Milestone[] = [
    { id: 'A', goalId: 'O1', title: 'Launch prep (closed test → production)', due: plus(t0, 21) },
    { id: 'B', goalId: 'O2', title: 'Launch week', afterLaunchDays: 7 },
    { id: 'C', goalId: 'O3', title: 'First 90 days: loops and channels', afterLaunchDays: 90 },
  ];
  for (const g of G) await ddb.send(new PutCommand({ TableName: env.table, Item: { ...g, pk: 'GROWTH', sk: `GOAL#${g.id}` } }));
  for (const m of M) await ddb.send(new PutCommand({ TableName: env.table, Item: { ...m, pk: 'GROWTH', sk: `MS#${m.id}` } }));
  type Seed = [string, Workstream, Task['type'], string, string, Partial<Task>?];
  const me = owner;
  const tasks: Seed[] = [
    ['Get 12+ testers opted in to the closed test', 'launch', 'ops', 'A', 'The 14 days start only when 12 testers have opted in. Share https://play.google.com/apps/testing/com.instagrowapp.lens', { owner: me, status: 'in_progress', impact: 3, confidence: 3, effortHours: 2, metric: { label: 'Testers opted in (O1.1)', fact: '', baseline: '0', baselineAt: t0, target: '12', checkOn: plus(t0, 7) } }],
    ['Decide: keep the name "Lens" or choose a distinctive one', 'launch', 'decision', 'A', '"Lens" collides with Google Lens, so word of mouth fails. Cheap to change before production, expensive after (strategy §2.1).', { owner: me, impact: 3, confidence: 2, effortHours: 2 }],
    ['Decide: launch wedge (events first, recommended)', 'launch', 'decision', 'A', 'Lead the launch with one sharp story; events seed dozens of guests each (strategy §2.3).', { owner: me, impact: 3, confidence: 2, effortHours: 1 }],
    ['Decide: cost levers before any scaling', 'launch', 'decision', 'A', 'Free storage costs money per sign-up; decide the levers from the 2026-10-26 evaluation (strategy §2.5).', { owner: me, impact: 2, confidence: 2, effortHours: 2 }],
    ['Decide: one company identity everywhere', 'launch', 'decision', 'A', 'Play, Razorpay, the site and email show different names (Clashhub, AKSHAY DHADWAL, Lens by InstaGrow). Pick one (strategy §2.4).', { owner: me, impact: 2, confidence: 3, effortHours: 1 }],
    ['Decide: owner hours per week for growth', 'launch', 'decision', 'A', 'Posts, partner calls and replies need a steady 3–5 hours a week (strategy §5).', { owner: me, impact: 2, confidence: 3, effortHours: 1 }],
    ['New positioning in the Play listing and in-app onboarding', 'store', 'listing', 'A', 'Homepage done (28 Oct): lead with "Phone full? Shoot everything." and full quality, not gigabytes. Listing and onboarding still old (strategy A3).', { owner: 'agent', status: 'in_progress', impact: 3, confidence: 2, effortHours: 6 }],
    ['Play listing: short description, 6 screenshots, 30 s video, localised listings', 'store', 'listing', 'A', 'The store page is the real homepage (strategy A4, §2.6).', { owner: 'agent', impact: 3, confidence: 2, effortHours: 12 }],
    ['One brand identity, About page and "Lens promise" page', 'store', 'content', 'A', 'Trust: strangers hand us their most private files (strategy A5, §2.4).', { owner: 'agent', status: 'blocked', blockedBy: 'Identity decision', impact: 2, confidence: 2, effortHours: 6 }],
    ['Play Billing live and cost-lever decisions made', 'retain', 'ops', 'A', 'Paid plans can’t launch in the Play app without Play Billing (strategy A6).', { owner: me, status: 'blocked', blockedBy: 'Parked by owner on 30 Oct; BillDesk KYC', impact: 2, confidence: 2, effortHours: 16 }],
    ['Search Console, Bing and source-tagged links', 'search', 'ops', 'A', 'Measurement first (strategy A7).', { owner: 'agent', status: 'done', proof: 'Search Console verified 29 Oct, Bing imported 30 Oct, GA4 live 30 Oct, utm convention in growth-engine.md', impact: 2, confidence: 3, effortHours: 4 }],
    ['Social accounts under one handle; first 9 posts drafted', 'social', 'social', 'A', 'Build in public: "launching in 2 weeks" (strategy A8).', { owner: me, status: 'blocked', blockedBy: 'Name decision', impact: 2, confidence: 2, effortHours: 4 }],
    ['Testers → first community: WhatsApp group, ask for feedback and honest reviews', 'launch', 'ops', 'A', 'Strategy A9.', { owner: me, impact: 2, confidence: 3, effortHours: 2 }],
    ['Press kit page, Product Hunt page, Reddit and launch posts drafted', 'social', 'content', 'A', 'Strategy A10.', { owner: 'agent', impact: 2, confidence: 2, effortHours: 8 }],
    ['Website download button and every /r, /go, /s link point to the Play listing', 'store', 'fix', 'B', 'Launch day (strategy Phase B). Add utm_source=site&utm_campaign=<page> to the Play link.', { owner: 'agent', impact: 3, confidence: 3, effortHours: 3 }],
    ['Launch posts: Product Hunt, Reddit, LinkedIn/X, WhatsApp on separate days', 'social', 'social', 'B', 'Each channel gets its own day (strategy Phase B).', { owner: me, impact: 3, confidence: 2, effortHours: 6 }],
    ['Personally invite 20–30 people with an event next month to create an event album', 'loops', 'ops', 'B', 'Each event seeds dozens of guests (strategy Phase B).', { owner: me, impact: 3, confidence: 2, effortHours: 6 }],
    ['Reply to every Play review within 24 hours; fix crashes the same day', 'store', 'ops', 'B', 'Strategy Phase B.', { owner: me, impact: 2, confidence: 3, effortHours: 4 }],
    ['Partnerships pilot: 5–10 photographers, planners and fests', 'partners', 'partner', 'C', 'Pros bring events every week (strategy Phase C, E4).', { owner: me, impact: 3, confidence: 2, effortHours: 20 }],
    ['3 short videos a week and a weekly build-in-public post', 'social', 'social', 'C', 'Strategy Phase C, E5.', { owner: me, impact: 2, confidence: 2, effortHours: 12 }],
    ['SEO: two problem pages a week', 'search', 'page', 'C', 'e.g. "TeraBox alternative without ads", "collect wedding photos from guests free" (strategy Phase C, E6).', { owner: 'agent', impact: 2, confidence: 2, effortHours: 8 }],
    ['Monthly review: drop channels that don’t move the weekly number, double the ones that do', 'launch', 'research', 'C', 'Strategy Phase C.', { owner: me, impact: 2, confidence: 3, effortHours: 2 }],
    ['Paid test (Google App Campaign, ₹10–20k) only after week-4 retention ≥ 20%', 'retain', 'experiment', 'C', 'Know the cost per activated user against the value per user first (strategy Phase C, E7).', { owner: me, status: 'blocked', blockedBy: 'Week-4 retention below 20% or unmeasured', impact: 2, confidence: 1, effortHours: 4 }],
  ];
  for (const [title, workstream, type, ms, description, extra] of tasks) {
    const goalId = M.find((m) => m.id === ms)!.goalId;
    await createTask({ title, workstream, type, description, milestoneId: ms, goalId, ...(extra ?? {}) }, 'seed', { kind: 'person', by: 'strategy', ref: 'growth-strategy.md' });
  }
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'SETTINGS', ...DEFAULT_SETTINGS, focus: { text: 'Get Lens into the Play Store: 12 committed testers, the 14-day clock started, and the first real event album.', by: owner, at: Date.now(), reviewOn: plus(t0, 30) } } }));
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...marker, at: Date.now() } }));
  return true;
}

// ---------- routes (manage = growth.write) ----------

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');

/** PUT /growth/settings {launchDate?, focus?, wsOwners?, northStar?} */
export async function settingsUpdate(req: Req, by: string): Promise<Res> {
  const s = await settings();
  const b = req.body ?? {};
  const next: Settings = {
    northStar: typeof b.northStar === 'string' && /^[\w.]{3,80}$/.test(b.northStar) ? b.northStar : s.northStar,
    launchDate: 'launchDate' in b ? day(b.launchDate) : s.launchDate,
    focus: b.focus && typeof b.focus === 'object' ? { text: text(b.focus.text, 300), by, at: Date.now(), reviewOn: day(b.focus.reviewOn) } : s.focus,
    wsOwners: b.wsOwners && typeof b.wsOwners === 'object' ? Object.fromEntries(Object.entries(b.wsOwners).filter(([k, v]) => /^[a-z]{3,10}$/.test(k) && typeof v === 'string').map(([k, v]) => [k, (v as string).slice(0, 200)])) : s.wsOwners,
  };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'SETTINGS', ...next } }));
  await log({ entity: 'growth:settings', action: 'growth.settings', actor: `console:${by}`, data: { fields: Object.keys(b) } });
  return json(200, { settings: next });
}

/** PUT /growth/goals/<id> {title?, why?, owner?, krs?: [{id, target?, baseline?, value?}]}: targets and manual values (with history). */
export async function goalUpdate(id: string, req: Req, by: string): Promise<Res> {
  const g = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `GOAL#${id}` } }))).Item as Goal | undefined;
  if (!g) throw new HttpError(404, 'No such goal');
  const b = req.body ?? {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const krs = g.krs.map((k) => {
    const u = Array.isArray(b.krs) ? b.krs.find((x: any) => x?.id === k.id) : undefined;
    if (!u) return k;
    const value = k.source === 'manual' ? num(u.value) : undefined;
    return {
      ...k,
      ...(num(u.target) !== undefined ? { target: num(u.target)! } : {}),
      ...(num(u.baseline) !== undefined ? { baseline: num(u.baseline)! } : {}),
      ...(value !== undefined ? { value, history: [...(k.history ?? []), { at: Date.now(), value, by }].slice(-60) } : {}),
    };
  });
  const next: Goal = { ...g, ...(typeof b.title === 'string' ? { title: text(b.title, 160) } : {}), ...(typeof b.why === 'string' ? { why: text(b.why, 500) } : {}), ...(typeof b.owner === 'string' ? { owner: text(b.owner, 200) } : {}), krs };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...next, pk: 'GROWTH', sk: `GOAL#${id}` } }));
  await log({ entity: `growth:goal:${id}`, action: 'growth.goal-update', actor: `console:${by}`, data: { krs: Array.isArray(b.krs) ? b.krs.length : 0 } });
  return json(200, { goal: next });
}
