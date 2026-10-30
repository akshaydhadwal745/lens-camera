// Website tools for the growth workspace (docs/growth/growth-workspace.md, group 4): GA4 charts, the
// title/description editor (changes go to the agent as a draft pull request, never straight to the site)
// and the content calendar (task due dates, social posts, partner follow-ups and campaigns in one month).
//   GROWTH / GA4SNAP   28 days of GA4 (written daily by the maintenance job: api/search-console.ts)
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, Req, Res } from '../api/lib';
import { campaigns } from './growth-money';
import { partners, posts } from './growth-records';
import { createTask, listTasks } from './growth-tasks';

/** GET /growth/ga4: the latest GA4 snapshot, or connected: false until the first daily pull. */
export async function ga4Page(): Promise<Res> {
  const s = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: 'GA4SNAP' } }))).Item;
  if (!s) return json(200, { connected: false });
  const { pk: _p, sk: _s, ...rest } = s;
  return json(200, { connected: true, ...rest });
}

// ---------- titles and descriptions ----------

export const META_LIMITS = { title: [15, 60], description: [70, 155] } as const;

export type MetaChange = { path: string; title: string; description: string; oldTitle: string; oldDescription: string };

/** Checks a requested change; returns the clean change or the reason it can't go in. */
export function checkMeta(c: Record<string, unknown>): MetaChange | string {
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const path = s(c.path, 200);
  if (!/^\/[\w\-/]*$/.test(path)) return `Bad page path: ${path || '(empty)'}`;
  const out = { path, title: s(c.title, 120), description: s(c.description, 300), oldTitle: s(c.oldTitle, 200), oldDescription: s(c.oldDescription, 400) };
  if (!out.title && !out.description) return `${path}: nothing to change`;
  if (out.title && (out.title.length < META_LIMITS.title[0] || out.title.length > 70)) return `${path}: titles should be ${META_LIMITS.title[0]}–${META_LIMITS.title[1]} characters`;
  if (out.description && (out.description.length < 50 || out.description.length > 170)) return `${path}: descriptions should be ${META_LIMITS.description[0]}–${META_LIMITS.description[1]} characters`;
  if (out.title === out.oldTitle && out.description === out.oldDescription) return `${path}: same as now`;
  return out;
}

/** POST /growth/seo/meta {changes:[{path,title,description,oldTitle,oldDescription}]}: one fix task the agent drafts as a PR. */
export async function metaRequest(req: Req, by: string): Promise<Res> {
  const list = Array.isArray(req.body?.changes) ? (req.body.changes as Record<string, unknown>[]).slice(0, 30) : [];
  if (!list.length) throw new HttpError(400, 'No changes');
  const checked = list.map(checkMeta);
  const bad = checked.filter((c): c is string => typeof c === 'string');
  if (bad.length) throw new HttpError(400, bad.join('; '));
  const changes = checked as MetaChange[];
  const t = await createTask(
    {
      title: `Update the title and description on ${changes.length === 1 ? changes[0].path : `${changes.length} pages`}`.slice(0, 160),
      description: changes.map((c) => `${c.path}\n  title: ${c.oldTitle || '—'} → ${c.title || '(unchanged)'}\n  description: ${c.oldDescription || '—'} → ${c.description || '(unchanged)'}`).join('\n\n'),
      workstream: 'search',
      type: 'fix',
      status: 'ready',
      impact: 2,
      confidence: 2,
      effortHours: 1,
      owner: 'agent',
      reviewer: by,
      links: { page: changes[0].path, keyword: '', campaign: '', partner: '', post: '' },
      metric: { label: `Search clicks on ${changes.length === 1 ? changes[0].path : 'these pages'}`, fact: 'gsc.clicks_28d', baseline: '', baselineAt: '', target: '', checkOn: '' },
    },
    by,
    { kind: 'person', by },
    { kind: 'meta', changes },
  );
  return json(200, { task: t });
}

// ---------- content calendar ----------

export type CalendarItem = { date: string; kind: 'task' | 'post' | 'partner' | 'campaign-start' | 'campaign-end'; id: string; title: string; status: string; owner: string; channel?: string };

const CONTENT_TYPES = new Set(['page', 'content', 'social', 'listing']);

/** Everything with a date in the month, oldest first (pure: tested in growth-content.test.ts). */
export function calendarItems(month: string, data: { tasks: { id: string; title: string; type: string; status: string; owner: string; due: string }[]; posts: Record<string, any>[]; partners: Record<string, any>[]; campaigns: Record<string, any>[] }, contentOnly = false): CalendarItem[] {
  const inMonth = (d: unknown) => typeof d === 'string' && d.startsWith(month);
  const out: CalendarItem[] = [
    ...data.tasks.filter((t) => inMonth(t.due) && !['wontdo'].includes(t.status) && (!contentOnly || CONTENT_TYPES.has(t.type))).map((t) => ({ date: t.due, kind: 'task' as const, id: t.id, title: t.title, status: t.status, owner: t.owner })),
    ...data.posts.filter((p) => inMonth(p.date)).map((p) => ({ date: p.date, kind: 'post' as const, id: p.id, title: p.title || String(p.body ?? '').slice(0, 80), status: p.status, owner: p.owner ?? '', channel: p.channel })),
    ...(contentOnly ? [] : data.partners.filter((p) => inMonth(p.nextDate) && !['won', 'lost'].includes(p.stage)).map((p) => ({ date: p.nextDate, kind: 'partner' as const, id: p.id, title: `${p.name}: ${p.nextStep || 'follow up'}`, status: p.stage, owner: p.owner ?? '' }))),
    ...data.campaigns.filter((c) => inMonth(c.start)).map((c) => ({ date: c.start, kind: 'campaign-start' as const, id: c.id, title: `${c.name} starts`, status: c.status, owner: c.owner ?? '', channel: c.channel })),
    ...data.campaigns.filter((c) => inMonth(c.end)).map((c) => ({ date: c.end, kind: 'campaign-end' as const, id: c.id, title: `${c.name} ends`, status: c.status, owner: c.owner ?? '', channel: c.channel })),
  ];
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
}

/** GET /growth/calendar?month=YYYY-MM&content=1 */
export async function calendarPage(req: Req): Promise<Res> {
  const q = req.query;
  const month = /^\d{4}-\d{2}$/.test(q.month ?? '') ? q.month! : new Date().toISOString().slice(0, 7);
  const [tasks, ps, prs, cs] = await Promise.all([listTasks(), posts(), partners(), campaigns()]);
  const items = calendarItems(month, { tasks, posts: ps, partners: prs, campaigns: cs }, q.content === '1');
  // Undated content work, so nothing planned gets lost off the calendar.
  const undated = tasks.filter((t) => !t.due && CONTENT_TYPES.has(t.type) && ['ready', 'in_progress', 'in_review'].includes(t.status)).map((t) => ({ id: t.id, title: t.title, status: t.status, owner: t.owner }));
  const ideas = ps.filter((p) => !p.date && p.status !== 'published').map((p) => ({ id: p.id, title: p.title || String(p.body ?? '').slice(0, 80), status: p.status, channel: p.channel }));
  return json(200, { month, items, undated, ideas });
}

// ---------- account integrations (status rows written daily by api/growth-integrations.ts) ----------

const SETUP: Record<string, { label: string; what: string; param: string; json: string; steps: string[] }> = {
  instagram: {
    label: 'Instagram & Facebook',
    what: 'Followers, posts and likes on your latest posts (Instagram business account and Facebook Page).',
    param: '/lens/growth/instagram',
    json: '{"accessToken":"…","igUserId":"…","pageId":"…"}',
    steps: ['Make the Instagram account a business account linked to a Facebook Page', 'Create an app at developers.facebook.com with instagram_basic, pages_show_list and pages_read_engagement', 'Get a long-lived Page access token and the Instagram business account id', 'Store them as a SecureString at the parameter below'],
  },
  youtube: {
    label: 'YouTube',
    what: 'Subscribers, views and your latest videos (public channel statistics).',
    param: '/lens/growth/youtube',
    json: '{"apiKey":"…","channelId":"UC…"}',
    steps: ['Enable "YouTube Data API v3" in the Google Cloud project we already use', 'Create an API key restricted to that API', 'Copy the channel id (YouTube Studio → Settings → Channel → Advanced)', 'Store them as a SecureString at the parameter below'],
  },
  pinterest: {
    label: 'Pinterest',
    what: 'Followers, monthly views, impressions, saves and clicks to the website (30 days).',
    param: '/lens/growth/pinterest',
    json: '{"accessToken":"…"}',
    steps: ['Create a Pinterest business account', 'Create an app at developers.pinterest.com with user_accounts:read and pins:read', 'Generate an access token', 'Store it as a SecureString at the parameter below'],
  },
  email: {
    label: 'Email marketing (Amazon SES)',
    what: 'How many accounts agreed to tips and news by email. Sending stays off until people opt in and the owner approves a send.',
    param: '/lens/growth/email',
    json: '{"from":"Lens <hello@lens.instagrowapp.com>","secret":"<32 random characters>"}',
    steps: ['Move SES out of the sandbox (production access) for the sending domain', 'Add the "Tips and news by email" switch in the app (calls PUT /v1/me/marketing-email)', 'Pick the from address and a random secret for unsubscribe links', 'Store them as a SecureString at the parameter below'],
  },
};

/** GET /growth/integrations */
export async function integrationsPage(): Promise<Res> {
  const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'INTEG#' } }));
  const rows = new Map((r.Items ?? []).map((i) => [String(i.sk).slice(6), i]));
  return json(200, {
    integrations: Object.entries(SETUP).map(([key, s]) => {
      const row = rows.get(key);
      return { key, ...s, connected: !!row?.connected, checkedAt: row?.at ?? null, metrics: row?.metrics ?? {}, recent: row?.recent ?? [], error: row?.error ?? null, note: row?.note ?? null };
    }),
  });
}
