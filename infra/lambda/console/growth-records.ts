// Growth workspace records (docs/growth/growth-workspace.md W3): the partnership pipeline and the
// content calendar. Each gets a tagged link so its visits are counted by our analytics.
//   GROWTH / PARTNER#<id>  organisation, type, contact, stage, value, next step + date, owner, notes, code
//   GROWTH / POST#<id>     a content package (docs/growth/content-engine.md): format, hook, slides or script,
//                          one version per platform (caption, hashtags, CTA, title, alt text), status,
//                          approval (cleared by any later edit), published links, campaign code, task
import { randomBytes } from 'node:crypto';

import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, Req, Res } from '../api/lib';
import { assetProblems, credits, hasLensPhoto, loadAssets, readAssetRefs, type Asset } from './growth-assets';
import { packageProblems, PLATFORMS, postText, readPackage, type Platform } from './growth-content-rules';
import { log } from './log';

export const STAGES = ['lead', 'contacted', 'meeting', 'pilot', 'live', 'won', 'lost'] as const;
export const PARTNER_TYPES = ['photographer', 'planner', 'venue', 'college', 'influencer', 'company', 'community', 'other'] as const;
export const CHANNELS = ['instagram', 'youtube', 'reddit', 'whatsapp', 'linkedin', 'x', 'facebook', 'pinterest', 'blog', 'other'] as const;
/** approved and scheduled are set only by POST /growth/posts/<id>/approve (managers), never by a save. */
export const POST_STATUSES = ['idea', 'drafted', 'in_review', 'approved', 'scheduled', 'published', 'archived'] as const;
const SET_BY_SAVE = ['idea', 'drafted', 'in_review', 'published', 'archived'] as const;
/** Fields whose change means the approved version is no longer what would go out. */
const CONTENT_KEYS = ['format', 'hook', 'slides', 'script', 'variants', 'assets', 'page'] as const;
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
  const pkg = readPackage(b, old);
  const first = (Object.keys(pkg.variants)[0] as string | undefined) ?? '';
  return {
    channel: oneOf(b.channel ?? old?.channel ?? first, CHANNELS, 'other'),
    date: day(b.date ?? old?.date),
    title: text(b.title ?? old?.title, 160),
    body: text(b.body ?? old?.body, 5000),
    status: oneOf(b.status ?? old?.status, POST_STATUSES, 'idea'),
    url: text(b.url ?? old?.url, 300),
    page: text(b.page ?? old?.page, 200),
    owner: text(b.owner ?? old?.owner, 200),
    taskId: text(b.taskId ?? old?.taskId, 20),
    pillar: text(b.pillar ?? old?.pillar, 40),
    ...pkg,
    // Only a cleared photo taken with Lens in the media makes "shot on Lens" true (set by postProblems' caller).
    realPhoto: false,
    assets: readAssetRefs(b.assets !== undefined ? b.assets : old?.assets),
  };
}

/** The tagged link for one platform (utm_source = the platform, so visits are counted per platform). */
export const platformLink = (platform: string, code: string, page: string) => postLink(platform, code, page && page.startsWith('/') ? page : '/');

/** What stops approval, for the editor and the approve button (the post's library media included). */
export function postProblems(p: ReturnType<typeof postFields>, code: string, assets: Map<string, Asset> = new Map()): string[] {
  const realPhoto = hasLensPhoto(p.assets, assets);
  return [...packageProblems({ ...p, realPhoto }, (k) => platformLink(k, code, p.page)), ...assetProblems(p.assets, assets)];
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
  if (!f.title && !f.body && !f.hook && !Object.keys(f.variants).length) throw new HttpError(400, 'Write a title, a hook or a caption');
  // Approval is a decision about exact content: a save can't grant it, and changing the content takes it back.
  const changed = !!old && CONTENT_KEYS.some((k) => stable(old[k]) !== stable((f as any)[k]));
  const wasApproved = old?.status === 'approved' || old?.status === 'scheduled';
  let status = f.status;
  if (!(SET_BY_SAVE as readonly string[]).includes(status)) status = wasApproved && !changed ? (old!.status as typeof status) : 'in_review';
  else if (wasApproved && changed && status !== 'archived' && status !== 'published') status = 'in_review';
  const keepApproval = wasApproved && !changed && (status === 'approved' || status === 'scheduled');
  const pid = isNew ? newId() : id;
  const code = (old?.code as string | undefined) ?? codeOf(f.title || f.hook || f.channel);
  const problems = postProblems(f, code, await loadAssets(f.assets.map((a) => a.id)));
  const links = Object.fromEntries(Object.keys(f.variants).map((k) => [k, platformLink(k, code, f.page)]));
  const published = { ...(old?.published ?? {}), ...readPublished(req.body?.published) };
  if (status !== 'published' && Object.keys(readPublished(req.body?.published)).length) status = 'published';
  // Nothing goes out unapproved: only the approved, unchanged version can be marked published.
  if (status === 'published' && old?.status !== 'published' && (!wasApproved || changed)) throw new HttpError(400, 'Approve this post before marking it published');
  const item = {
    ...f,
    // Written by the render jobs, not the editor: a save must not lose them.
    renders: old?.renders,
    renderedAt: old?.renderedAt,
    rendersZip: old?.rendersZip,
    score: old?.score,
    reel: old?.reel,
    reelScore: old?.reelScore,
    status,
    code,
    link: postLink(f.channel, code, f.page && f.page.startsWith('/') ? f.page : '/'),
    links,
    problems,
    published,
    approvedBy: keepApproval ? old?.approvedBy : undefined,
    approvedAt: keepApproval ? old?.approvedAt : undefined,
    createdAt: old?.createdAt ?? Date.now(),
    createdBy: old?.createdBy ?? by,
    updatedAt: Date.now(),
    updatedBy: by,
    ...(status === 'published' && old?.status !== 'published' ? { publishedAt: Date.now() } : { publishedAt: old?.publishedAt }),
    pk: 'GROWTH',
    sk: `POST#${pid}`,
    id: pid,
  };
  await ddb.send(new PutCommand({ TableName: env.table, Item: item }));
  await log({ entity: `growth:post:${pid}`, action: isNew ? 'growth.post-add' : 'growth.post-update', actor: `console:${by}`, data: { status, format: f.format, platforms: Object.keys(f.variants), approvalCleared: wasApproved && !keepApproval } });
  return json(200, { post: item });
}

/** JSON with object keys sorted: DynamoDB doesn't keep map key order, so plain JSON would see a change. */
export function stable(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'null';
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** {platform: "https://…"} published links a person pasted after posting by hand. */
function readPublished(v: unknown): Record<string, { url: string; at: number; how: 'manual' }> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, { url: string; at: number; how: 'manual' }> = {};
  for (const [k, url] of Object.entries(v as Record<string, unknown>)) {
    if ((PLATFORMS as readonly string[]).includes(k) && typeof url === 'string' && /^https:\/\/[^\s]{4,300}$/.test(url.trim())) out[k] = { url: url.trim(), at: Date.now(), how: 'manual' };
  }
  return out;
}

/** POST /growth/posts/<id>/approve (growth.write): only a package without problems can be approved. */
export async function postApprove(id: string, by: string, undo = false): Promise<Res> {
  if (!/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  const old = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${id}` } }))).Item;
  if (!old) throw new HttpError(404, 'No such post');
  if (undo) {
    if (old.status !== 'approved' && old.status !== 'scheduled') throw new HttpError(400, 'This post is not approved');
  } else {
    if (!['drafted', 'in_review', 'idea'].includes(old.status)) throw new HttpError(400, `A ${old.status.replace('_', ' ')} post can't be approved`);
    const f = postFields({}, old);
    const problems = postProblems(f, old.code, await loadAssets(f.assets.map((a) => a.id)));
    if (problems.length) throw new HttpError(400, `Fix first: ${problems.join('; ')}`);
  }
  const item = { ...old, status: undo ? 'in_review' : 'approved', approvedBy: undo ? undefined : by, approvedAt: undo ? undefined : Date.now(), updatedAt: Date.now(), updatedBy: by, problems: [] };
  await ddb.send(new PutCommand({ TableName: env.table, Item: item }));
  await log({ entity: `growth:post:${id}`, action: undo ? 'growth.post-unapprove' : 'growth.post-approve', actor: `console:${by}`, data: { platforms: Object.keys(old.variants ?? {}), format: old.format } });
  return json(200, { post: item });
}

/** GET /growth/posts/<id>/export: ready-to-paste text per platform, for posting by hand. */
export async function postExport(id: string): Promise<Res> {
  if (!/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${id}` } }))).Item;
  if (!p) throw new HttpError(404, 'No such post');
  const f = postFields({}, p);
  const platforms = Object.keys(f.variants) as Platform[];
  const lines = credits(f.assets, await loadAssets(f.assets.map((a) => a.id)));
  return json(200, {
    approved: p.status === 'approved' || p.status === 'scheduled' || p.status === 'published',
    credits: lines,
    platforms: platforms.map((k) => {
      const v = f.variants[k]!;
      const link = platformLink(k, p.code, f.page);
      const body = postText(v, link, k);
      return { platform: k, title: v.title, text: lines.length ? `${body}\n\n${lines.join('\n')}` : body, altText: v.altText, link };
    }),
  });
}

/** DELETE /growth/<partners|posts>/<id> */
export async function recordDelete(kind: 'PARTNER' | 'POST', id: string, by: string): Promise<Res> {
  if (!/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'Bad id');
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `${kind}#${id}` } }));
  await log({ entity: `growth:${kind.toLowerCase()}:${id}`, action: 'growth.record-delete', actor: `console:${by}` });
  return json(200, { ok: true });
}
