// Growth workspace records (docs/growth/growth-workspace.md W3): the partnership pipeline and the
// social/content calendar. Each gets a tagged link so its visits are counted by our analytics.
//   GROWTH / PARTNER#<id>  organisation, type, contact, stage, value, next step + date, owner, notes, code
//   GROWTH / POST#<id>     channel, date, text, status, url, owner, campaign code, task
import { randomBytes } from 'node:crypto';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, Req, Res } from '../api/lib';
import { log } from './log';

export const STAGES = ['lead', 'contacted', 'meeting', 'pilot', 'live', 'won', 'lost'] as const;
export const PARTNER_TYPES = ['photographer', 'planner', 'venue', 'college', 'influencer', 'company', 'community', 'other'] as const;
export const CHANNELS = ['instagram', 'youtube', 'reddit', 'whatsapp', 'linkedin', 'x', 'facebook', 'blog', 'other'] as const;
export const POST_STATUSES = ['idea', 'drafted', 'approved', 'published'] as const;
const SITE = 'https://lens.instagrowapp.com';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const newId = () => randomBytes(5).toString('hex');
export const codeOf = (name: string) => (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'x') + '-' + randomBytes(2).toString('hex');

/** The link a partner shares: our analytics count its visits (utm_campaign = the partner's code). */
export const partnerLink = (code: string) => `${SITE}/?utm_source=partner&utm_medium=referral&utm_campaign=${code}`;
export const postLink = (channel: string, code: string, path = '/') => `${SITE}${path}?utm_source=${channel}&utm_medium=social&utm_campaign=${code}`;

export function partnerFields(b: Record<string, any>, old?: Record<string, any>) {
  return {
    name: text(b.name ?? old?.name, 120),
    type: oneOf(b.type ?? old?.type, PARTNER_TYPES, 'other'),
    city: text(b.city ?? old?.city, 80),
    contact: text(b.contact ?? old?.contact, 200),
    stage: oneOf(b.stage ?? old?.stage, STAGES, 'lead'),
    value: text(b.value ?? old?.value, 200),
    nextStep: text(b.nextStep ?? old?.nextStep, 200),
    nextDate: day(b.nextDate ?? old?.nextDate),
    owner: text(b.owner ?? old?.owner, 200),
    notes: text(b.notes ?? old?.notes, 4000),
    lostReason: text(b.lostReason ?? old?.lostReason, 300),
  };
}

export function postFields(b: Record<string, any>, old?: Record<string, any>) {
  return {
    channel: oneOf(b.channel ?? old?.channel, CHANNELS, 'other'),
    date: day(b.date ?? old?.date),
    title: text(b.title ?? old?.title, 160),
    body: text(b.body ?? old?.body, 5000),
    status: oneOf(b.status ?? old?.status, POST_STATUSES, 'idea'),
    url: text(b.url ?? old?.url, 300),
    page: text(b.page ?? old?.page, 200),
    owner: text(b.owner ?? old?.owner, 200),
    taskId: text(b.taskId ?? old?.taskId, 20),
  };
}

async function rows(prefix: string) {
  const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': prefix } }));
  return r.Items ?? [];
}
export const partners = () => rows('PARTNER#');
export const posts = () => rows('POST#');

/** PUT /growth/partners/<id|new>: create or update a partner (stage changes are logged). */
export async function partnerSave(id: string, req: Req, by: string): Promise<Res> {
  const isNew = id === 'new';
  if (!isNew && !/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  const old = isNew ? undefined : (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `PARTNER#${id}` } }))).Item;
  if (!isNew && !old) throw new HttpError(404, 'No such partner');
  const f = partnerFields(req.body ?? {}, old);
  if (!f.name) throw new HttpError(400, 'A name is required');
  const pid = isNew ? newId() : id;
  const code = (old?.code as string | undefined) ?? codeOf(f.name);
  const stages = [...((old?.stages as { stage: string; at: number; by: string }[] | undefined) ?? []), ...(old?.stage !== f.stage ? [{ stage: f.stage, at: Date.now(), by }] : [])].slice(-30);
  const item = { ...f, code, link: partnerLink(code), stages, createdAt: old?.createdAt ?? Date.now(), createdBy: old?.createdBy ?? by, updatedAt: Date.now(), pk: 'GROWTH', sk: `PARTNER#${pid}`, id: pid };
  await ddb.send(new PutCommand({ TableName: env.table, Item: item }));
  await log({ entity: `growth:partner:${pid}`, action: isNew ? 'growth.partner-add' : 'growth.partner-update', actor: `console:${by}`, data: { stage: f.stage } });
  return json(200, { partner: item });
}

/** PUT /growth/posts/<id|new>: create or update a post in the calendar. */
export async function postSave(id: string, req: Req, by: string): Promise<Res> {
  const isNew = id === 'new';
  if (!isNew && !/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  const old = isNew ? undefined : (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${id}` } }))).Item;
  if (!isNew && !old) throw new HttpError(404, 'No such post');
  const f = postFields(req.body ?? {}, old);
  if (!f.title && !f.body) throw new HttpError(400, 'Write a title or the post');
  const pid = isNew ? newId() : id;
  const code = (old?.code as string | undefined) ?? codeOf(f.title || f.channel);
  const item = { ...f, code, link: postLink(f.channel, code, f.page && f.page.startsWith('/') ? f.page : '/'), createdAt: old?.createdAt ?? Date.now(), createdBy: old?.createdBy ?? by, updatedAt: Date.now(), ...(f.status === 'published' && old?.status !== 'published' ? { publishedAt: Date.now() } : { publishedAt: old?.publishedAt }), pk: 'GROWTH', sk: `POST#${pid}`, id: pid };
  await ddb.send(new PutCommand({ TableName: env.table, Item: item }));
  await log({ entity: `growth:post:${pid}`, action: isNew ? 'growth.post-add' : 'growth.post-update', actor: `console:${by}`, data: { status: f.status, channel: f.channel } });
  return json(200, { post: item });
}

/** DELETE /growth/<partners|posts>/<id> */
export async function recordDelete(kind: 'PARTNER' | 'POST', id: string, by: string): Promise<Res> {
  if (!/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `${kind}#${id}` } }));
  await log({ entity: `growth:${kind.toLowerCase()}:${id}`, action: 'growth.record-delete', actor: `console:${by}` });
  return json(200, { ok: true });
}
