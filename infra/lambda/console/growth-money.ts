// Campaigns, spend and unit economics for the growth workspace (docs/growth/growth-workspace.md, group 3).
//   GROWTH / CAMPAIGN#<id>  { name, channel, medium, goal, start, end, budget (₹), landingPage, owner, status, notes, code }
//   GROWTH / SPEND#<id>     { date, amount (₹), category, campaignId?, note, by }
// Visits come from our website analytics (utm_campaign = the campaign's code), installs and their
// outcomes from PROFILE.acquisition.campaign (Play install referrer). Revenue is an estimate (paying
// users × the monthly Plus price) until payments are reported per campaign.
import { randomBytes } from 'node:crypto';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, Req, Res } from '../api/lib';
import { log } from './log';

const SITE = 'https://lens.instagrowapp.com';
const DAY = 86_400_000;
export const PLUS_MONTHLY_RUPEES = 59;
export const CHANNELS = ['google-ads', 'meta-ads', 'instagram', 'youtube', 'reddit', 'whatsapp', 'influencer', 'partner', 'email', 'event', 'print', 'other'] as const;
export const MEDIUMS = ['paid', 'social', 'referral', 'email', 'offline', 'other'] as const;
export const SPEND_CATEGORIES = ['ads', 'influencers', 'events-and-print', 'tools', 'content', 'other'] as const;
export const CAMPAIGN_STATUSES = ['planned', 'live', 'ended'] as const;

// ---------- unit economics (pure: tested in growth-money.test.ts) ----------

export type Outcomes = { visits: number; installs: number; backedUp: number; signedIn: number; paying: number };

/** CAC and friends; null where the denominator is 0 (never a made-up number). */
export function economics(spend: number, o: Outcomes) {
  const per = (d: number) => (d > 0 ? Math.round((spend / d) * 100) / 100 : null);
  const revenue = o.paying * PLUS_MONTHLY_RUPEES;
  return {
    spend,
    costPerVisit: per(o.visits),
    cac: per(o.installs),
    costPerActivated: per(o.backedUp),
    costPerPaying: per(o.paying),
    estMonthlyRevenue: revenue,
    roi: spend > 0 ? Math.round(((revenue - spend) / spend) * 1000) / 1000 : null,
    paybackMonths: o.paying > 0 && spend > 0 ? Math.round((spend / revenue) * 10) / 10 : null,
  };
}

/** Spend per calendar month and category. */
export function spendByMonth(spend: { date: string; amount: number; category: string }[]) {
  const out: Record<string, { total: number; byCategory: Record<string, number> }> = {};
  for (const s of spend) {
    const m = s.date.slice(0, 7);
    const row = (out[m] ??= { total: 0, byCategory: {} });
    row.total += s.amount;
    row.byCategory[s.category] = (row.byCategory[s.category] ?? 0) + s.amount;
  }
  return Object.entries(out)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));
}

export const campaignLink = (c: { landingPage?: string; channel: string; medium: string; code: string }) => {
  const page = c.landingPage && /^\/[\w\-/]*$/.test(c.landingPage) ? c.landingPage : '/';
  return `${SITE}${page}?utm_source=${c.channel}&utm_medium=${c.medium}&utm_campaign=${c.code}`;
};

// ---------- storage and routes ----------

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const rupees = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v * 100) / 100 : 0);

async function rows(prefix: string) {
  const out: Record<string, any>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': prefix }, ExclusiveStartKey: start }));
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}
export const campaigns = () => rows('CAMPAIGN#');
export const spendRows = () => rows('SPEND#');

/** Website visits per campaign code over the last `days` (our analytics, WSTAT camp#<code>). */
async function campaignVisits(days: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const now = Date.now();
  const list = Array.from({ length: days }, (_, i) => new Date(now - i * DAY).toISOString().slice(0, 10));
  for (let i = 0; i < list.length; i += 10)
    await Promise.all(
      list.slice(i, i + 10).map(async (d) => {
        const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': `WSTAT#${d}`, ':s': 'camp#' } }));
        for (const it of r.Items ?? []) out.set(String(it.sk).slice(5), (out.get(String(it.sk).slice(5)) ?? 0) + (it.count ?? 0));
      }),
    );
  return out;
}

/** GET /growth/money: campaigns with outcomes and CAC, spend by month, overall unit economics. */
export async function moneyPage(analytics: { campaignInstalls?: Record<string, { installs: number; backedUp: number; signedIn: number; paying: number }>; installsByMonth?: { month: string; installs: number; backedUp: number; paying: number }[] }): Promise<Res> {
  const [cs, spend, visits] = await Promise.all([campaigns(), spendRows(), campaignVisits(90)]);
  const spentOn = (id: string) => spend.filter((s) => s.campaignId === id).reduce((a, s) => a + (s.amount ?? 0), 0);
  const out = cs
    .sort((a, b) => String(b.start ?? '').localeCompare(String(a.start ?? '')))
    .map((c) => {
      const inst = analytics.campaignInstalls?.[String(c.code)] ?? { installs: 0, backedUp: 0, signedIn: 0, paying: 0 };
      const o: Outcomes = { visits: visits.get(String(c.code)) ?? 0, ...inst };
      return { ...c, link: campaignLink(c as never), outcomes: o, economics: economics(spentOn(String(c.id)), o) };
    });
  const months = spendByMonth(spend.map((s) => ({ date: String(s.date), amount: Number(s.amount ?? 0), category: String(s.category) })));
  const byMonth = (analytics.installsByMonth ?? []).map((m) => {
    const sp = months.find((x) => x.month === m.month)?.total ?? 0;
    return { ...m, ...economics(sp, { visits: 0, installs: m.installs, backedUp: m.backedUp, signedIn: 0, paying: m.paying }) };
  });
  return json(200, { campaigns: out, spend: spend.sort((a, b) => String(b.date).localeCompare(String(a.date))), months: byMonth, spendMonths: months, plusPrice: PLUS_MONTHLY_RUPEES });
}

/** PUT /growth/campaigns/<id|new> · DELETE /growth/campaigns/<id> */
export async function campaignSave(id: string, req: Req, by: string, remove = false): Promise<Res> {
  const isNew = id === 'new';
  if (!isNew && !/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  if (remove) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `CAMPAIGN#${id}` } }));
    await log({ entity: `growth:campaign:${id}`, action: 'growth.campaign-remove', actor: `console:${by}` });
    return json(200, { ok: true });
  }
  const old = isNew ? undefined : (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `CAMPAIGN#${id}` } }))).Item;
  if (!isNew && !old) throw new HttpError(404, 'No such campaign');
  const b = req.body ?? {};
  const name = text(b.name ?? old?.name, 120);
  if (!name) throw new HttpError(400, 'A name is required');
  const channel = oneOf(b.channel ?? old?.channel, CHANNELS, 'other');
  const code = (old?.code as string | undefined) ?? `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'campaign'}-${randomBytes(2).toString('hex')}`;
  const pid = isNew ? randomBytes(5).toString('hex') : id;
  const item = {
    name,
    channel,
    medium: oneOf(b.medium ?? old?.medium, MEDIUMS, channel.endsWith('-ads') ? 'paid' : 'social'),
    goal: text(b.goal ?? old?.goal, 300),
    start: day(b.start ?? old?.start),
    end: day(b.end ?? old?.end),
    budget: rupees(b.budget ?? old?.budget),
    landingPage: text(b.landingPage ?? old?.landingPage, 200) || '/',
    owner: text(b.owner ?? old?.owner, 200),
    status: oneOf(b.status ?? old?.status, CAMPAIGN_STATUSES, 'planned'),
    notes: text(b.notes ?? old?.notes, 2000),
    code,
    createdAt: old?.createdAt ?? Date.now(),
    createdBy: old?.createdBy ?? by,
    updatedAt: Date.now(),
  };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...item, pk: 'GROWTH', sk: `CAMPAIGN#${pid}`, id: pid } }));
  await log({ entity: `growth:campaign:${pid}`, action: isNew ? 'growth.campaign-add' : 'growth.campaign-update', actor: `console:${by}`, data: { status: item.status, budget: item.budget } });
  return json(200, { campaign: { ...item, id: pid, link: campaignLink(item) } });
}

/** PUT /growth/spend/<id|new> · DELETE /growth/spend/<id> */
export async function spendSave(id: string, req: Req, by: string, remove = false): Promise<Res> {
  const isNew = id === 'new';
  if (!isNew && !/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  if (remove) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `SPEND#${id}` } }));
    await log({ entity: `growth:spend:${id}`, action: 'growth.spend-remove', actor: `console:${by}` });
    return json(200, { ok: true });
  }
  const b = req.body ?? {};
  const date = day(b.date);
  const amount = rupees(b.amount);
  if (!date || !amount) throw new HttpError(400, 'A date and an amount (₹) are required');
  const campaignId = typeof b.campaignId === 'string' && /^[a-f0-9]{10}$/.test(b.campaignId) ? b.campaignId : '';
  const pid = isNew ? randomBytes(5).toString('hex') : id;
  const item = { date, amount, category: oneOf(b.category, SPEND_CATEGORIES, 'other'), campaignId, note: text(b.note, 300), by, at: Date.now() };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...item, pk: 'GROWTH', sk: `SPEND#${pid}`, id: pid } }));
  await log({ entity: `growth:spend:${pid}`, action: 'growth.spend-save', actor: `console:${by}`, data: { amount, date, campaignId } });
  return json(200, { spend: { ...item, id: pid } });
}
