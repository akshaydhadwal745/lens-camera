// Growth workspace tasks (docs/growth/growth-workspace.md W1): every piece of growth work, from an
// AI suggestion to a partner call, is one task with one lifecycle.
//   GROWTH / TASK#<id>             the task (fields below; every one named, typed and capped)
//   GROWTH / TASKLOG#<id>#<ts>#<n> comments and history (who, when, what changed)
//   GROWTH / TASKKEY#<key>         dedupe key → task id (AI items: "opp:<slug>", "rec:<title>", "prop:<id>")
//   GROWTH / COUNTER#TASK          next task number
// Permissions: growth (see), growth.contribute (create, work on own tasks, comment),
// growth.write (manage: assign anyone, triage, priorities, goals). Enforced here, not in the UI.
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, Req, Res } from '../api/lib';
import { log } from './log';
import { can, teamMembers, type Role } from './roles';

export const STATUSES = ['suggested', 'ready', 'in_progress', 'in_review', 'done', 'measured', 'blocked', 'wontdo'] as const;
export type Status = (typeof STATUSES)[number];
export const WORKSTREAMS = ['launch', 'search', 'social', 'store', 'retain', 'loops', 'partners'] as const;
export type Workstream = (typeof WORKSTREAMS)[number];
export const TYPES = ['page', 'content', 'social', 'listing', 'experiment', 'partner', 'fix', 'research', 'decision', 'ops'] as const;
export const VERDICTS = ['worked', 'no_change', 'worse', 'too_early'] as const;
const CONSOLE = process.env.CONSOLE_ORIGIN ?? 'https://console.lens.instagrowapp.com';

export type Task = {
  id: string;
  title: string;
  description: string;
  workstream: Workstream;
  type: (typeof TYPES)[number];
  status: Status;
  priority: 0 | 1 | 2 | 3;
  priorityReason?: string;
  impact: 1 | 2 | 3;
  confidence: 1 | 2 | 3;
  effortHours: number;
  expectedImpact: string;
  owner: string; // email, "agent" or ""
  reviewer: string;
  due: string; // YYYY-MM-DD or ""
  goalId: string;
  milestoneId: string;
  source: { kind: 'ai' | 'person'; by: string; report?: string; ref?: string };
  evidence: { text: string; facts: string[]; link: string }[];
  links: { page: string; keyword: string; campaign: string; partner: string; post: string; pr?: { url: string; number: number } };
  metric: { label: string; fact: string; baseline: string; baselineAt: string; target: string; checkOn: string };
  result?: { value: string; verdict: (typeof VERDICTS)[number]; learning: string; at: number; by: string };
  spec?: Record<string, unknown>; // what the agent needs to draft it (a content brief or a code change)
  blockedBy: string;
  wontDoReason: string;
  proof: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  doneAt?: number;
  measuredAt?: number;
};

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);
const email = (v: unknown) => (typeof v === 'string' && (v === 'agent' || /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(v)) ? v.toLowerCase() : '');

/** Priority: P0 only for high-impact, high-confidence work that is quick to do; effort nudges, it doesn't decide. */
export function priorityOf(impact: number, confidence: number, effortHours: number): 0 | 1 | 2 | 3 {
  const value = impact * confidence; // 1..9
  if (impact === 3 && confidence >= 2 && effortHours <= 8) return 0;
  if (value >= 6) return 1;
  if (value >= 3) return 2;
  return 3;
}

/** Same work in other words? Word overlap of the titles (ignoring filler words). */
export function similar(a: string, b: string): boolean {
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'with', 'by', 'from', 'your', 'our', 'one', 'real', 'first', 'this', 'that', 'it', 'is', 'be', 'yourself', 'repeat']);
  const words = (x: string) => new Set(x.toLowerCase().replace(/[^a-z0-9/ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)));
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return false;
  // Same action too: "List Lens on AlternativeTo…" and "Improve /compare/…" share topic words but aren't the same work.
  const verb = (x: string) => x.toLowerCase().match(/[a-z]+/)?.[0] ?? '';
  if (verb(a) !== verb(b)) return false;
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.min(A.size, B.size) >= 0.6;
}

/** The fields a person or the agent may set (anything else in the body is ignored). */
export function cleanFields(b: Record<string, any>, old?: Task): Partial<Task> {
  const out: Partial<Task> = {};
  if ('title' in b) out.title = text(b.title, 160);
  if ('description' in b) out.description = text(b.description, 4000);
  if ('workstream' in b) out.workstream = oneOf(b.workstream, WORKSTREAMS, old?.workstream ?? 'search');
  if ('type' in b) out.type = oneOf(b.type, TYPES, old?.type ?? 'ops');
  if ('impact' in b) out.impact = int(b.impact, 1, 3, 2) as 1 | 2 | 3;
  if ('confidence' in b) out.confidence = int(b.confidence, 1, 3, 2) as 1 | 2 | 3;
  if ('effortHours' in b) out.effortHours = int(b.effortHours, 0, 400, 2);
  if ('expectedImpact' in b) out.expectedImpact = text(b.expectedImpact, 600);
  if ('owner' in b) out.owner = email(b.owner);
  if ('reviewer' in b) out.reviewer = email(b.reviewer);
  if ('due' in b) out.due = day(b.due);
  if ('goalId' in b) out.goalId = text(b.goalId, 20).replace(/[^\w-]/g, '');
  if ('milestoneId' in b) out.milestoneId = text(b.milestoneId, 20).replace(/[^\w-]/g, '');
  if ('priorityReason' in b) out.priorityReason = text(b.priorityReason, 300);
  if ('priority' in b && [0, 1, 2, 3].includes(b.priority)) out.priority = b.priority;
  if ('evidence' in b && Array.isArray(b.evidence))
    out.evidence = b.evidence.slice(0, 12).map((e: any) => ({ text: text(e?.text, 600), facts: Array.isArray(e?.facts) ? e.facts.filter((f: unknown) => typeof f === 'string').slice(0, 10).map((f: string) => f.slice(0, 120)) : [], link: text(e?.link, 300) }));
  if ('links' in b && b.links && typeof b.links === 'object')
    out.links = { ...(old?.links ?? { page: '', keyword: '', campaign: '', partner: '', post: '' }), page: text(b.links.page, 300), keyword: text(b.links.keyword, 120), campaign: text(b.links.campaign, 80), partner: text(b.links.partner, 80), post: text(b.links.post, 300) };
  if ('metric' in b && b.metric && typeof b.metric === 'object')
    out.metric = { label: text(b.metric.label, 200), fact: text(b.metric.fact, 120), baseline: text(b.metric.baseline, 60), baselineAt: day(b.metric.baselineAt), target: text(b.metric.target, 60), checkOn: day(b.metric.checkOn) };
  if ('blockedBy' in b) out.blockedBy = text(b.blockedBy, 300);
  if ('wontDoReason' in b) out.wontDoReason = text(b.wontDoReason, 500);
  if ('proof' in b) out.proof = text(b.proof, 500);
  return out;
}

/** What a status change needs, and who may make it. Returns the problem, or undefined. */
export function transitionProblem(t: Task, to: Status, f: Partial<Task>, manager: boolean): string | undefined {
  if (!STATUSES.includes(to)) return 'Unknown status';
  if (to === t.status) return undefined;
  if (t.status === 'suggested' && to !== 'wontdo' && !manager) return 'Only a growth lead can accept suggestions';
  if (to === 'measured' && !(f.result ?? t.result)) return 'Record the result first';
  if (to === 'wontdo' && !(f.wontDoReason ?? t.wontDoReason)) return 'Say why not (the agent learns from it)';
  if (to === 'blocked' && !(f.blockedBy ?? t.blockedBy)) return 'Name what blocks it';
  if (to === 'in_review' && !(f.reviewer ?? t.reviewer)) return 'Choose a reviewer';
  if (to === 'done' && !(f.proof ?? t.proof) && !t.links?.pr) return 'Add proof: a link or a note on what shipped';
  return undefined;
}

// ---------- storage ----------

const key = (id: string) => ({ pk: 'GROWTH', sk: `TASK#${id}` });

async function nextId(): Promise<string> {
  const r = await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'COUNTER#TASK' }, UpdateExpression: 'ADD n :one', ExpressionAttributeValues: { ':one': 1 }, ReturnValues: 'UPDATED_NEW' }));
  return `T-${r.Attributes?.n}`;
}

export async function getTask(id: string): Promise<Task | undefined> {
  if (!/^T-\d{1,7}$/.test(id)) return undefined;
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: key(id) }))).Item as Task | undefined;
}

export async function listTasks(): Promise<Task[]> {
  const out: Task[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'TASK#' }, ExclusiveStartKey: start }));
    out.push(...((r.Items ?? []) as Task[]));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

let seq = 0;
async function addLog(id: string, entry: { kind: 'comment' | 'change'; by: string; text?: string; changes?: Record<string, [unknown, unknown]> }) {
  const at = Date.now();
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `TASKLOG#${id}#${String(at).padStart(15, '0')}#${seq++}`, id, at, ...entry } }));
}

async function taskLog(id: string) {
  const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': `TASKLOG#${id}#` }, ScanIndexForward: false, Limit: 200 }));
  return r.Items ?? [];
}

const EMPTY = { description: '', workstream: 'search' as Workstream, type: 'ops' as Task['type'], status: 'ready' as Status, impact: 2 as const, confidence: 2 as const, effortHours: 2, expectedImpact: '', owner: '', reviewer: '', due: '', goalId: '', milestoneId: '', evidence: [], links: { page: '', keyword: '', campaign: '', partner: '', post: '' }, metric: { label: '', fact: '', baseline: '', baselineAt: '', target: '', checkOn: '' }, blockedBy: '', wontDoReason: '', proof: '' };

/** A new task (people and the agent). Priority from ICE unless set. */
export async function createTask(fields: Partial<Task>, by: string, source: Task['source'], spec?: Record<string, unknown>): Promise<Task> {
  const now = Date.now();
  const t = { ...EMPTY, ...fields } as Task;
  const task: Task = { ...t, priority: fields.priority ?? priorityOf(t.impact, t.confidence, t.effortHours), title: t.title || 'Untitled task', source, createdAt: now, createdBy: by, updatedAt: now, id: await nextId(), ...(spec ? { spec } : {}) };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...task, ...key(task.id) }, ConditionExpression: 'attribute_not_exists(pk)' }));
  await addLog(task.id, { kind: 'change', by, text: source.kind === 'ai' ? `Suggested by the growth agent${source.report ? ` (report ${source.report})` : ''}` : 'Created' });
  return task;
}

/** The agent's items: one task per dedupe key; a known one gets fresh evidence while still Suggested. */
export async function upsertAiTask(dedupe: string, fields: Partial<Task>, report: string, spec?: Record<string, unknown>): Promise<string> {
  const k = { pk: 'GROWTH', sk: `TASKKEY#${dedupe.slice(0, 200)}` };
  const known = (await ddb.send(new GetCommand({ TableName: env.table, Key: k }))).Item?.taskId as string | undefined;
  if (known) {
    const t = await getTask(known);
    if (t?.status === 'suggested') await saveTask({ ...t, ...fields, ...(spec ? { spec } : {}), status: 'suggested', updatedAt: Date.now() });
    return known;
  }
  // Already on the list in other words (open or finished)? Note it there instead of adding a duplicate.
  const twin = (await listTasks()).find((t) => t.status !== 'wontdo' && similar(t.title, fields.title ?? ''));
  if (twin) {
    await addLog(twin.id, { kind: 'change', by: 'agent', text: `The growth agent suggested this again (report ${report}): "${fields.title}"` });
    await ddb.send(new PutCommand({ TableName: env.table, Item: { ...k, taskId: twin.id } }));
    return twin.id;
  }
  const task = await createTask({ ...fields, status: 'suggested' }, 'agent', { kind: 'ai', by: 'agent', report, ref: dedupe }, spec);
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...k, taskId: task.id } }));
  return task.id;
}

export async function saveTask(t: Task) {
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...t, ...key(t.id) } }));
}

/** System changes (draft runner, results loop): set fields and log them. */
export async function systemUpdate(id: string, set: Partial<Task>, note: string) {
  const t = await getTask(id);
  if (!t) return;
  const changes = Object.fromEntries(Object.entries(set).filter(([k, v]) => JSON.stringify((t as any)[k]) !== JSON.stringify(v)).map(([k, v]) => [k, [(t as any)[k], v]])) as Record<string, [unknown, unknown]>;
  await saveTask({ ...t, ...set, updatedAt: Date.now() });
  await addLog(id, { kind: 'change', by: 'agent', text: note, changes });
}

// ---------- email ----------

async function sendEmail(to: string[], subject: string, body: string) {
  const sender = process.env.CODE_SENDER ?? '';
  const list = [...new Set(to.filter((e) => e && e !== 'agent'))];
  if (!sender.startsWith('no-reply@') || !list.length) return;
  await new SESv2Client({})
    .send(new SendEmailCommand({ FromEmailAddress: `Lens Console <${sender}>`, Destination: { ToAddresses: list }, Content: { Simple: { Subject: { Data: subject.slice(0, 180) }, Body: { Text: { Data: body } } } } }))
    .catch((e) => console.error('growth task email', e));
}
const link = (id: string) => `${CONSOLE}/growth/tasks?task=${encodeURIComponent(id)}`;

/** @mentions in a comment: "@priya" (start of an email) or a full email of a team member. */
export function mentionedEmails(comment: string, team: string[]): string[] {
  const names = [...comment.matchAll(/@([\w.+-]+(?:@[\w-]+\.[\w.-]+)?)/g)].map((m) => m[1].toLowerCase());
  return team.filter((e) => names.some((n) => e === n || e.split('@')[0] === n));
}

// ---------- routes ----------

const manager = (role: Role) => can(role, 'growth.write');

/** GET /growth/tasks: all tasks and the team (for owners and reviewers). */
export async function tasksPage(): Promise<Res> {
  const team = (await teamMembers()).filter((m) => can(m.role, 'growth')).map((m) => ({ email: m.email, role: m.role }));
  return json(200, { tasks: (await listTasks()).sort((a, b) => a.priority - b.priority || b.updatedAt - a.updatedAt), team });
}

/** GET /growth/tasks/<id>: one task with its comments and history. */
export async function taskDetail(id: string): Promise<Res> {
  const t = await getTask(id);
  if (!t) throw new HttpError(404, 'No such task');
  return json(200, { task: t, log: await taskLog(id) });
}

/** POST /growth/tasks: a new task (contributors' tasks are theirs unless a lead assigns them). */
export async function taskCreate(req: Req, by: string, role: Role): Promise<Res> {
  const f = cleanFields(req.body ?? {});
  if (!f.title) throw new HttpError(400, 'A title is required');
  if (!manager(role)) f.owner = by;
  const t = await createTask({ ...f, status: 'ready' }, by, { kind: 'person', by });
  await log({ entity: `growth:task:${t.id}`, action: 'growth.task-create', actor: `console:${by}`, data: { title: t.title } });
  if (t.owner && t.owner !== by) await sendEmail([t.owner], `New task for you: ${t.title}`, `${by} assigned you a growth task:\n\n${t.title}\n${t.description}\n\nDue: ${t.due || 'no date'}\n${link(t.id)}`);
  return json(201, { task: t });
}

/** PATCH /growth/tasks/<id>: change fields and status (validated); assignment and review emails. */
export async function taskUpdate(id: string, req: Req, by: string, role: Role): Promise<Res> {
  const t = await getTask(id);
  if (!t) throw new HttpError(404, 'No such task');
  const isManager = manager(role);
  if (!isManager && t.owner !== by && t.reviewer !== by) throw new HttpError(403, 'You can change only tasks you own or review');
  const f = cleanFields(req.body ?? {}, t);
  if (!isManager) {
    // Contributors work on their tasks; assigning others, triage and priorities are for leads.
    for (const k of ['owner', 'priority', 'priorityReason', 'goalId', 'milestoneId'] as const) delete f[k];
  }
  if (req.body?.result && typeof req.body.result === 'object') {
    f.result = { value: text(req.body.result.value, 200), verdict: oneOf(req.body.result.verdict, VERDICTS, 'too_early'), learning: text(req.body.result.learning, 1000), at: Date.now(), by };
  }
  const to = typeof req.body?.status === 'string' ? (req.body.status as Status) : t.status;
  const problem = transitionProblem(t, to, f, isManager);
  if (problem) throw new HttpError(400, problem);
  // Priority follows ICE unless a lead set it explicitly.
  if (f.priority === undefined && (f.impact || f.confidence || f.effortHours !== undefined)) f.priority = priorityOf(f.impact ?? t.impact, f.confidence ?? t.confidence, f.effortHours ?? t.effortHours);
  const now = Date.now();
  const next: Task = { ...t, ...f, status: to, updatedAt: now, ...(to === 'done' && t.status !== 'done' ? { doneAt: now } : {}), ...(to === 'measured' ? { measuredAt: now } : {}) };
  const changes = Object.fromEntries(Object.keys({ ...f, status: to }).filter((k) => JSON.stringify((t as any)[k]) !== JSON.stringify((next as any)[k])).map((k) => [k, [(t as any)[k], (next as any)[k]]])) as Record<string, [unknown, unknown]>;
  if (!Object.keys(changes).length) return json(200, { task: t });
  await saveTask(next);
  await addLog(id, { kind: 'change', by, changes });
  await log({ entity: `growth:task:${id}`, action: 'growth.task-update', actor: `console:${by}`, data: { fields: Object.keys(changes) } });
  if (changes.owner && next.owner && next.owner !== by) await sendEmail([next.owner], `Assigned to you: ${next.title}`, `${by} assigned you a growth task:\n\n${next.title}\n${next.description}\n\nWhy: ${next.evidence.map((e) => e.text).join(' · ')}\nDue: ${next.due || 'no date'}\n${link(id)}`);
  if (changes.status && to === 'in_review' && next.reviewer && next.reviewer !== by) await sendEmail([next.reviewer], `Review needed: ${next.title}`, `${by} asks you to review:\n\n${next.title}\n${next.links.pr?.url ?? next.proof ?? ''}\n${link(id)}`);
  return json(200, { task: next });
}

/** POST /growth/tasks/<id>/comments {text}: a note on the task; @mentions get an email. */
export async function taskComment(id: string, req: Req, by: string): Promise<Res> {
  const t = await getTask(id);
  if (!t) throw new HttpError(404, 'No such task');
  const body = text(req.body?.text, 2000);
  if (!body) throw new HttpError(400, 'Write something');
  await addLog(id, { kind: 'comment', by, text: body });
  const team = (await teamMembers()).filter((m) => can(m.role, 'growth')).map((m) => m.email.toLowerCase());
  const notify = [...mentionedEmails(body, team), t.owner, t.reviewer].filter((e) => e && e !== by);
  if (notify.length) await sendEmail(notify, `New comment on: ${t.title}`, `${by}:\n\n${body}\n\n${link(id)}`);
  return json(201, { ok: true });
}
