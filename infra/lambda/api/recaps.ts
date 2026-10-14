import { BatchClient, DescribeJobsCommand, SubmitJobCommand } from '@aws-sdk/client-batch';
import { CopyObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { createAlbumWith } from './albums';
import { Identity } from './identity';
import { checkQuota, ddb, env, HttpError, json, randomId, rateLimit, Req, Res, s3 } from './lib';
import { derivativeKey, MediaRecord, mediaKey, ORIGINAL_STORAGE_CLASS, toClient } from './media';
import { FILM_MAX, findRecaps, Recap, RecapInput } from './recap-detect';

// Automatic trip and event recaps (docs/design/switch-features.md §4). Found on
// request from metadata the server already has (recap-detect.ts), nothing runs
// in the background and nothing is shared: the person previews a recap, then
// saves it as an album and/or asks for a film. Films are rendered in the cloud
// (AWS Batch, the transcoder image, MODE=recap) from the 2048 px previews, then
// become an ordinary video in their roll. Records:
//   D#<id> R#<key>   { status: 'dismissed' | 'rendering' | 'ready' | 'failed', albumId?, videoId?, jobId?, at }

const batch = new BatchClient({});
const LOOKBACK = 180 * 24 * 3600 * 1000;
const MAX_ITEMS = 5000;
const MAX_LISTED = 12;
const KEY = /^[A-Za-z0-9_-]{16}$/;
/** A film that hasn't finished in this long counts as failed (try again). */
const STALE_RENDER_MS = 2 * 3600 * 1000;

type RecapState = { pk: string; sk: string; status?: 'dismissed' | 'rendering' | 'ready' | 'failed'; albumId?: string; videoId?: string; jobId?: string; at?: number };

/** The person's recent photos/videos (metadata only), newest first. */
async function recentItems(ownerId: string, now: number): Promise<(RecapInput & { record: Record<string, any> })[]> {
  const out: (RecapInput & { record: Record<string, any> })[] = [];
  let key: Record<string, any> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)',
        FilterExpression: 'previewReady = :t AND attribute_not_exists(deletedAt) AND attribute_not_exists(ownerHidden)',
        ProjectionExpression: 'id, kind, createdAt, width, height, place, #k, derivVersion, recap',
        ExpressionAttributeNames: { '#k': 'key' },
        ExpressionAttributeValues: { ':p': `D#${ownerId}`, ':m': 'M#', ':t': true },
        ScanIndexForward: false,
        ExclusiveStartKey: key,
      }),
    );
    for (const m of page.Items ?? []) {
      // Recap films themselves never become part of a recap.
      if (m.recap) continue;
      if (now - m.createdAt > LOOKBACK) continue;
      out.push({ id: m.id, kind: m.kind, createdAt: m.createdAt, width: m.width, height: m.height, place: m.place, record: m });
    }
    key = page.LastEvaluatedKey;
    // Media ids are time-sortable by when they reached Lens: stop well past the window.
    const oldest = page.Items?.[page.Items.length - 1];
    if (oldest && now - oldest.createdAt > LOOKBACK * 2) break;
  } while (key && out.length < MAX_ITEMS);
  return out;
}

async function states(ownerId: string): Promise<Map<string, RecapState>> {
  const result = await ddb.send(
    new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :r)', ExpressionAttributeValues: { ':p': `D#${ownerId}`, ':r': 'R#' } }),
  );
  return new Map((result.Items ?? []).map((i) => [(i.sk as string).slice(2), i as RecapState]));
}

/** The person's time zone offset (minutes east of UTC) from ?tz=, for titles. */
function offset(req: Req): number {
  const tz = Number(req.query?.tz);
  return Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz * 60 * 1000 : 0;
}

async function find(identity: Identity, req: Req, key?: string): Promise<{ recaps: Recap[]; byId: Map<string, Record<string, any>> }> {
  const now = Date.now();
  const items = await recentItems(identity.id, now);
  const byId = new Map(items.map((i) => [i.id, i.record]));
  const recaps = findRecaps(items, now, offset(req));
  return { recaps: key ? recaps.filter((r) => r.key === key) : recaps, byId };
}

async function clientOf(record: Record<string, any> | undefined) {
  if (!record) return null;
  return toClient({ ...(record as MediaRecord), status: 'ready', previewReady: true });
}

/** A film being made: finished (→ into the roll), failed, or still going. */
async function settle(identity: Identity, recap: Recap, state: RecapState): Promise<RecapState> {
  if (state.status !== 'rendering') return state;
  const prefix = `r/${identity.id}/${recap.key}/`;
  const done = await s3
    .send(new GetObjectCommand({ Bucket: env.bucket, Key: `${prefix}done.json` }))
    .then(async (r) => JSON.parse(await r.Body!.transformToString()) as { size: number; duration: number; width: number; height: number })
    .catch(() => null);
  if (done) return finish(identity, recap, done);
  const stale = Date.now() - (state.at ?? 0) > STALE_RENDER_MS;
  const job = state.jobId ? (await batch.send(new DescribeJobsCommand({ jobs: [state.jobId] }))).jobs?.[0] : undefined;
  if (stale || !job || job.status === 'FAILED') {
    const next = { ...state, status: 'failed' as const };
    await ddb.send(new PutCommand({ TableName: env.table, Item: next }));
    return next;
  }
  return state;
}

/** The finished film becomes an ordinary video in their roll (it counts toward their storage). */
async function finish(identity: Identity, recap: Recap, done: { size: number; duration: number; width: number; height: number }): Promise<RecapState> {
  const prefix = `r/${identity.id}/${recap.key}/`;
  const id = `${Date.now().toString(36).padStart(8, '0')}-${randomId(6).toLowerCase().replace(/[^0-9a-z]/g, '0').slice(0, 8)}`;
  const key = `m/${identity.id}/${id}.mp4`;
  const copy = (from: string, to: string, storageClass?: typeof ORIGINAL_STORAGE_CLASS) =>
    s3.send(new CopyObjectCommand({ Bucket: env.bucket, CopySource: `${env.bucket}/${prefix}${from}`, Key: to, ...(storageClass ? { StorageClass: storageClass } : {}) }));
  await Promise.all([copy('recap.mp4', key, ORIGINAL_STORAGE_CLASS), copy('thumb.jpg', derivativeKey(key, 'thumb')), copy('preview.jpg', derivativeKey(key, 'preview'))]);
  const now = Date.now();
  const item: MediaRecord & { recap: string } = {
    ...mediaKey(identity.id, id),
    id,
    kind: 'video',
    contentType: 'video/mp4',
    key,
    size: done.size,
    status: 'ready',
    previewReady: true,
    storageClass: ORIGINAL_STORAGE_CLASS,
    width: done.width,
    height: done.height,
    duration: done.duration,
    // Right after the trip/event in the roll, where it belongs.
    createdAt: recap.end + 1000,
    uploadedAt: now,
    recap: recap.key,
  };
  const state: RecapState = { pk: `D#${identity.id}`, sk: `R#${recap.key}`, status: 'ready', videoId: id, at: now };
  const current = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: state.pk, sk: state.sk } }))).Item as RecapState | undefined;
  if (current?.albumId) state.albumId = current.albumId;
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: env.table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' } },
        { Update: { TableName: env.table, Key: { pk: `D#${identity.id}`, sk: 'PROFILE' }, UpdateExpression: 'ADD usedBytes :s', ExpressionAttributeValues: { ':s': done.size } } },
        { Put: { TableName: env.table, Item: state } },
      ],
    }),
  );
  return state;
}

async function view(identity: Identity, r: Recap, byId: Map<string, Record<string, any>>, state: RecapState | undefined, withItems: boolean) {
  const settled = state ? await settle(identity, r, state) : undefined;
  const video = settled?.videoId ? (await ddb.send(new GetCommand({ TableName: env.table, Key: mediaKey(identity.id, settled.videoId) }))).Item : undefined;
  return {
    key: r.key,
    kind: r.kind,
    title: r.title,
    start: r.start,
    end: r.end,
    count: r.items.length,
    photos: r.film.length,
    cover: await clientOf(byId.get(r.cover)),
    albumId: settled?.albumId ?? null,
    film:
      settled?.status === 'ready' && video && !video.deletedAt
        ? { status: 'ready', media: await toClient(video as MediaRecord) }
        : { status: settled?.status === 'rendering' || settled?.status === 'failed' ? settled.status : 'none' },
    ...(withItems ? { items: await Promise.all(r.items.map((id) => clientOf(byId.get(id)))), filmIds: r.film } : {}),
  };
}

/** GET /v1/recaps?tz=<minutes>: suggested recaps (not dismissed), newest first. */
export async function listRecaps(identity: Identity, req: Req): Promise<Res> {
  await rateLimit(`recaps#${identity.id}`, 300);
  const [{ recaps, byId }, saved] = await Promise.all([find(identity, req), states(identity.id)]);
  const shown = recaps.filter((r) => saved.get(r.key)?.status !== 'dismissed').slice(0, MAX_LISTED);
  return json(200, { recaps: await Promise.all(shown.map((r) => view(identity, r, byId, saved.get(r.key), false))) });
}

async function one(identity: Identity, key: string, req: Req) {
  if (!KEY.test(key)) throw new HttpError(404, 'Recap not found');
  const { recaps, byId } = await find(identity, req, key);
  const recap = recaps[0];
  if (!recap) throw new HttpError(404, 'Recap not found (the photos changed?)');
  const state = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `R#${key}` } }))).Item as RecapState | undefined;
  return { recap, byId, state };
}

/** GET /v1/recaps/:key: the recap with every item (preview before saving anything). */
export async function recapDetail(identity: Identity, key: string, req: Req): Promise<Res> {
  const { recap, byId, state } = await one(identity, key, req);
  return json(200, { recap: await view(identity, recap, byId, state, true) });
}

/** Ids the person kept in the preview (a subset of the recap's own items). */
function chosen(req: Req, allowed: string[]): string[] {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).filter((v): v is string => typeof v === 'string') : null;
  if (!ids) return allowed;
  const ok = new Set(allowed);
  return [...new Set(ids)].filter((id) => ok.has(id));
}

/** POST /v1/recaps/:key/album {ids?}: save it as an album (the photos stay where they are). */
export async function recapAlbum(identity: Identity, key: string, req: Req): Promise<Res> {
  const { recap, state } = await one(identity, key, req);
  if (state?.albumId) return json(200, { albumId: state.albumId });
  const ids = chosen(req, recap.items);
  if (!ids.length) throw new HttpError(400, 'Keep at least one photo');
  const albumId = await createAlbumWith(identity, recap.title, ids);
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...(state ?? { pk: `D#${identity.id}`, sk: `R#${key}` }), albumId, at: Date.now() } }));
  return json(200, { albumId });
}

/** POST /v1/recaps/:key/film {ids?}: make the film in the cloud (a minute or two); it lands in the roll. */
export async function recapFilm(identity: Identity, key: string, req: Req): Promise<Res> {
  await rateLimit(`recap-film#${identity.id}`, 20, 'You can make 20 films an hour. Try again later.');
  const { recap, byId, state } = await one(identity, key, req);
  if (state?.status === 'rendering' || state?.status === 'ready') return json(200, { status: state.status });
  const ids = chosen(req, recap.film).slice(0, FILM_MAX);
  if (ids.length < 2) throw new HttpError(400, 'Keep at least two photos for a film');
  // About 1 MB per photo second; checked now so the film never fails at the end.
  checkQuota(identity, ids.length * 2_000_000);
  const prefix = `r/${identity.id}/${key}/`;
  const manifest = {
    title: recap.title,
    orientation: recap.orientation,
    items: ids.map((id) => {
      const m = byId.get(id)!;
      return { key: derivativeKey(m.key, 'preview', m.derivVersion) };
    }),
  };
  await s3.send(new PutObjectCommand({ Bucket: env.bucket, Key: `${prefix}manifest.json`, Body: JSON.stringify(manifest), ContentType: 'application/json' }));
  const job = await batch.send(
    new SubmitJobCommand({
      jobName: `recap-${key}`,
      jobQueue: env.transcodeQueueSpot,
      jobDefinition: env.transcodeJob,
      containerOverrides: { environment: [{ name: 'MODE', value: 'recap' }, { name: 'PREFIX', value: prefix }] },
    }),
  );
  await ddb.send(
    new PutCommand({ TableName: env.table, Item: { ...(state ?? { pk: `D#${identity.id}`, sk: `R#${key}` }), status: 'rendering', jobId: job.jobId, at: Date.now() } }),
  );
  return json(200, { status: 'rendering' });
}

/** POST /v1/recaps/:key/dismiss: not interested (it won't be suggested again). */
export async function dismissRecap(identity: Identity, key: string): Promise<Res> {
  if (!KEY.test(key)) throw new HttpError(404, 'Recap not found');
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `D#${identity.id}`, sk: `R#${key}` },
      UpdateExpression: 'SET #s = :d, #a = :now',
      ExpressionAttributeNames: { '#s': 'status', '#a': 'at' },
      ExpressionAttributeValues: { ':d': 'dismissed', ':now': Date.now() },
    }),
  );
  return json(200, { dismissed: key });
}

