// Publishing to Instagram (docs/growth/content-engine.md, phase 6; owner 2026-11-11: Instagram only for now,
// X on hold, Facebook skipped). Instagram API with Instagram login on the owner's "clashhub New" app (development
// mode: the account is an Instagram tester, no App Review). Token: SSM /lens/growth/instagram (SecureString JSON
// {token, userId, username, savedAt, refreshedAt}), a 60-day token the engine refreshes every week
// (refresh_access_token: no secret needed); a failed refresh emails the owners.
// Only an approved, unchanged post goes out: Publish now, or Schedule (status "scheduled", picked up by the
// 10-minute content chain when its time comes). What goes out is exactly the Export text for Instagram (caption,
// hashtags, link line, credit lines) with the reel, or the carousel / single image (as JPEG; story-shaped images
// are left out of the feed).
//   GROWTH / POST#<id>  schedule.instagram (ms), published.instagram { url, at, how: 'auto', mediaId }, publishError
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, HttpError, json, s3, signedCdnUrl, type Res } from '../api/lib';
import { platformText } from './growth-records';

const API = 'https://graph.instagram.com/v23.0';
const PARAM = '/lens/growth/instagram';
const BUCKET = process.env.GROWTH_CONTENT_BUCKET ?? '';
const TMP = '/tmp/ig';

type IgConf = { token: string; userId: string; username: string; savedAt: number; refreshedAt: number | null };
type Render = { assetId: string; label: string; w: number; h: number };

async function conf(): Promise<IgConf | undefined> {
  const v = await getParam(PARAM).catch(() => undefined);
  return v ? (JSON.parse(v) as IgConf) : undefined;
}

// ---------- pure ----------

const without = (m: Record<string, unknown> | undefined, k: string) => Object.fromEntries(Object.entries(m ?? {}).filter(([x]) => x !== k));

/** Instagram's limits on a caption: 2,200 characters and 30 hashtags (extra hashtags are dropped from the end). */
export function igCaption(text: string): string {
  let n = 0;
  const out = text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, (m) => (++n > 30 ? '' : m));
  return out.length > 2200 ? `${out.slice(0, 2199).trimEnd()}…` : out;
}

/** The images that fit Instagram's feed (aspect 4:5 to 1.91:1), in order, at most 10. */
export const feedRenders = (renders: Render[]): Render[] => renders.filter((r) => r.w > 0 && r.h / r.w <= 1.25 + 1e-6 && r.w / r.h <= 1.92).slice(0, 10);

/** What a post publishes as: its reel, a carousel, a single image, or nothing usable. */
export function igPlan(p: { reel?: { assetId?: string }; renders?: Render[]; format?: string }): { kind: 'reel'; assetId: string } | { kind: 'carousel' | 'image'; renders: Render[] } | undefined {
  if (p.reel?.assetId && (p.format === 'reel' || p.format === 'short' || !p.renders?.length)) return { kind: 'reel', assetId: p.reel.assetId };
  const feed = feedRenders(p.renders ?? []);
  if (feed.length >= 2) return { kind: 'carousel', renders: feed };
  if (feed.length === 1) return { kind: 'image', renders: feed };
  if (p.reel?.assetId) return { kind: 'reel', assetId: p.reel.assetId };
  return undefined;
}

// ---------- Instagram calls ----------

async function call(method: 'GET' | 'POST', path: string, params: Record<string, string>, token: string): Promise<Record<string, any>> {
  const qs = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(method === 'GET' ? `${API}/${path}?${qs}` : `${API}/${path}`, { method, ...(method === 'POST' ? { body: qs, headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}), signal: AbortSignal.timeout(60_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok || j.error) throw new Error(`Instagram: ${String(j.error?.error_user_msg || j.error?.message || r.status).slice(0, 300)}`);
  return j;
}

/** Wait for a media container to finish processing (videos take a minute or two). */
async function ready(id: string, token: string, maxMs: number) {
  const until = Date.now() + maxMs;
  for (;;) {
    const s = await call('GET', id, { fields: 'status_code,status' }, token);
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram couldn't process the media: ${String(s.status ?? s.status_code).slice(0, 200)}`);
    if (Date.now() > until) throw new Error('Instagram took too long to process the media');
    await new Promise((r) => setTimeout(r, 5000));
  }
}

const cdn = (key: string, seconds = 3600) => signedCdnUrl(`${process.env.CONSOLE_ORIGIN}/${key.split('/').map(encodeURIComponent).join('/')}`, seconds);

/** A render as a JPEG Instagram can fetch (it takes JPEG only): converted with ffmpeg, stored under x/ig/. */
async function jpegUrl(postId: string, i: number, assetId: string): Promise<string> {
  mkdirSync(TMP, { recursive: true });
  const r = await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${assetId}` } }));
  const key = String(r.Item?.key ?? '');
  if (!key) throw new Error(`Image ${i + 1} is missing`);
  const body = await s3Get(key);
  const src = join(TMP, `in-${i}`);
  const out = join(TMP, `out-${i}.jpg`);
  writeFileSync(src, body);
  const ff = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', src, '-q:v', '2', out]);
  if (ff.status !== 0) throw new Error(`Couldn't convert image ${i + 1}: ${String(ff.stderr).slice(0, 200)}`);
  const jkey = `x/ig/${postId}/${i + 1}.jpg`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: jkey, Body: readFileSync(out), ContentType: 'image/jpeg' }));
  return cdn(jkey);
}

async function s3Get(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return Buffer.from(await r.Body!.transformToByteArray());
}

async function emailOwners(subject: string, body: string) {
  const to = (process.env.ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const sender = process.env.CODE_SENDER ?? '';
  if (!sender.startsWith('no-reply@') || !to.length) return;
  await new SESv2Client({}).send(new SendEmailCommand({ FromEmailAddress: `Lens Console <${sender}>`, Destination: { ToAddresses: to }, Content: { Simple: { Subject: { Data: subject.slice(0, 180) }, Body: { Text: { Data: body } } } } })).catch((e) => console.error('ig notify', e));
}

// ---------- publish ----------

/** Publish one approved post to Instagram now (GrowthAnalyst; a reel's processing can take minutes). */
export async function publishInstagram(postId: string, by: string): Promise<Record<string, unknown>> {
  const key = { pk: 'GROWTH', sk: `POST#${postId}` };
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: key }))).Item;
  if (!p) return { publish: 'no post' };
  if (p.published?.instagram?.url) return { publish: 'already published', url: p.published.instagram.url };
  try {
    if (p.status !== 'approved' && p.status !== 'scheduled') throw new Error('The post is no longer approved (it changed after approval). Approve it again.');
    const c = await conf();
    if (!c) throw new Error('Instagram is not connected (SSM /lens/growth/instagram).');
    const plan = igPlan(p);
    if (!plan) throw new Error('Nothing to post yet: make the images or the reel first.');
    const caption = igCaption((await platformText(p, 'instagram')).text);
    let container: string;
    if (plan.kind === 'reel') {
      const a = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${plan.assetId}` } }))).Item;
      if (!a?.key) throw new Error('The reel file is missing');
      container = String((await call('POST', `${c.userId}/media`, { media_type: 'REELS', video_url: await cdn(String(a.key), 7200), caption, share_to_feed: 'true' }, c.token)).id);
      await ready(container, c.token, 9 * 60_000);
    } else if (plan.kind === 'image') {
      container = String((await call('POST', `${c.userId}/media`, { image_url: await jpegUrl(postId, 0, plan.renders[0].assetId), caption }, c.token)).id);
      await ready(container, c.token, 2 * 60_000);
    } else {
      const kids: string[] = [];
      for (const [i, r] of plan.renders.entries()) kids.push(String((await call('POST', `${c.userId}/media`, { image_url: await jpegUrl(postId, i, r.assetId), is_carousel_item: 'true' }, c.token)).id));
      for (const k of kids) await ready(k, c.token, 2 * 60_000);
      container = String((await call('POST', `${c.userId}/media`, { media_type: 'CAROUSEL', children: kids.join(','), caption }, c.token)).id);
      await ready(container, c.token, 2 * 60_000);
    }
    const mediaId = String((await call('POST', `${c.userId}/media_publish`, { creation_id: container }, c.token)).id);
    const permalink = String((await call('GET', mediaId, { fields: 'permalink' }, c.token).catch(() => ({ permalink: '' }))).permalink ?? '');
    const at = Date.now();
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: key,
        UpdateExpression: 'SET published = :v, schedule = :sc, #s = :pub, publishedAt = if_not_exists(publishedAt, :at), updatedAt = :at REMOVE publishError, publishing',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':v': { ...(p.published ?? {}), instagram: { url: permalink || `https://www.instagram.com/${c.username}/`, at, how: 'auto', mediaId, kind: plan.kind, by } }, ':sc': without(p.schedule, 'instagram'), ':pub': 'published', ':at': at },
      }),
    );
    console.log(JSON.stringify({ igPublished: postId, kind: plan.kind, mediaId, permalink }));
    return { publish: 'ok', url: permalink, kind: plan.kind };
  } catch (e) {
    const message = (e as Error).message.slice(0, 400);
    await ddb.send(new UpdateCommand({ TableName: env.table, Key: key, UpdateExpression: 'SET publishError = :e REMOVE publishing', ExpressionAttributeValues: { ':e': { platform: 'instagram', message, at: Date.now() } } })).catch(() => undefined);
    console.error(JSON.stringify({ igPublishFailed: postId, message }));
    await emailOwners(`Instagram post failed: ${String(p.title ?? postId).slice(0, 80)}`, `The post "${p.title ?? postId}" didn't go out on Instagram.\n\n${message}\n\nIt is still approved in the Console (Content). Fix the problem and press Publish again.`);
    return { publish: 'failed', message };
  }
}

/** Scheduled posts whose time has come (the 10-minute content chain calls this first). One at a time. */
export async function duePublishes(now = Date.now()): Promise<string[]> {
  const out: string[] = [];
  let start: Record<string, unknown> | undefined;
  const due: { id: string; by: string }[] = [];
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', FilterExpression: '#s = :sch', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'POST#', ':sch': 'scheduled' }, ExclusiveStartKey: start }));
    for (const p of r.Items ?? []) if (Number(p.schedule?.instagram) && Number(p.schedule.instagram) <= now && !p.published?.instagram && !(p.publishError?.at > Number(p.schedule.instagram))) due.push({ id: String(p.id), by: String(p.scheduledBy ?? 'schedule') });
    start = r.LastEvaluatedKey;
  } while (start);
  for (const d of due.slice(0, 2)) {
    await publishInstagram(d.id, d.by);
    out.push(d.id);
  }
  return out;
}

// ---------- the token ----------

/** Weekly: swap the 60-day token for a new one before it runs out. A failure emails the owners. */
export async function refreshInstagram(): Promise<Record<string, unknown>> {
  const c = await conf();
  if (!c) return { igRefresh: 'not connected' };
  try {
    const r = await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: c.token })}`, { signal: AbortSignal.timeout(30_000) });
    const j = (await r.json()) as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!r.ok || !j.access_token) throw new Error(String(j.error?.message ?? r.status).slice(0, 300));
    const next: IgConf = { ...c, token: j.access_token, refreshedAt: Date.now() };
    await new SSMClient({}).send(new PutParameterCommand({ Name: PARAM, Type: 'SecureString', Overwrite: true, Value: JSON.stringify(next) }));
    console.log(JSON.stringify({ igRefresh: 'ok', days: Math.round((j.expires_in ?? 0) / 86400) }));
    return { igRefresh: 'ok', days: Math.round((j.expires_in ?? 0) / 86400) };
  } catch (e) {
    const message = (e as Error).message;
    console.error(JSON.stringify({ igRefreshFailed: message }));
    await emailOwners('Instagram connection needs a new token', `Lens couldn't renew the Instagram token for @${c.username}: ${message}\n\nPosting to Instagram stops until it's replaced. In Meta for Developers → clashhub New → Instagram → API setup with Instagram login → Generate token, then send the new token to Claude (it goes in SSM ${PARAM}).`);
    return { igRefresh: 'failed', message };
  }
}

// ---------- the Console's buttons (ConsoleApi) ----------

/** POST /growth/posts/<id>/publish {platform:'instagram', at?}: now, or scheduled for `at`. DELETE cancels a schedule. */
export async function publishStart(postId: string, body: Record<string, unknown> | undefined, by: string, cancel = false): Promise<Res> {
  if (!/^[a-f0-9]{10}$/.test(postId)) throw new HttpError(400, 'Bad post id');
  if ((body?.platform ?? 'instagram') !== 'instagram') throw new HttpError(400, 'Only Instagram can be published from here for now');
  const key = { pk: 'GROWTH', sk: `POST#${postId}` };
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: key }))).Item;
  if (!p) throw new HttpError(404, 'No such post');
  if (cancel) {
    if (p.status !== 'scheduled') throw new HttpError(400, 'This post is not scheduled');
    await ddb.send(new UpdateCommand({ TableName: env.table, Key: key, UpdateExpression: 'SET #s = :a, schedule = :sc', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':a': 'approved', ':sc': without(p.schedule, 'instagram') } }));
    return json(200, { post: await fresh(key) });
  }
  if (p.status !== 'approved' && p.status !== 'scheduled') throw new HttpError(400, 'Approve this post first');
  if (p.published?.instagram?.url) throw new HttpError(409, 'Already on Instagram');
  if (!igPlan(p)) throw new HttpError(400, 'Make the images or the reel first');
  const at = Number(body?.at);
  if (Number.isFinite(at) && at > Date.now() + 60_000) {
    if (at > Date.now() + 60 * 86_400_000) throw new HttpError(400, 'Schedule within the next 60 days');
    await ddb.send(new UpdateCommand({ TableName: env.table, Key: key, UpdateExpression: 'SET #s = :sch, schedule = :sc, scheduledBy = :by REMOVE publishError', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':sch': 'scheduled', ':sc': { ...(p.schedule ?? {}), instagram: at }, ':by': by } }));
    return json(200, { post: await fresh(key) });
  }
  const { InvokeCommand, LambdaClient } = await import('@aws-sdk/client-lambda');
  await new LambdaClient({}).send(new InvokeCommand({ FunctionName: process.env.GROWTH_FUNCTION, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ publish: { postId, platform: 'instagram' }, by })) }));
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: key, UpdateExpression: 'SET publishing = :p REMOVE publishError', ExpressionAttributeValues: { ':p': { instagram: Date.now() } } }));
  return json(202, { post: await fresh(key) });
}

const fresh = async (key: { pk: string; sk: string }) => {
  const { pk: _p, sk: _s, ...post } = (await ddb.send(new GetCommand({ TableName: env.table, Key: key }))).Item ?? {};
  return post;
};
