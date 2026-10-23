// "Download everything" (docs/features/export.md): every original kept in Lens storage, packed into
// ZIP files of up to ~3.5 GB (photos by year: Lens/2026/…), ready within minutes to hours, kept 7
// days (bucket lifecycle on x/). Free: people have a right to a copy of their own data; downloads
// come through CloudFront (1 TB/month free tier). Originals in their own storage (Drive, …) are
// already theirs and aren't included. Files over 1 GB (long videos) get their own direct link.
//
// ZIP: "stored" (no compression: photos/videos don't shrink), data descriptors, no ZIP64 (every part
// stays under 4 GB and 60,000 entries). Built by the Maintenance Lambda, one part per pass, streamed
// S3 → S3 with a multipart upload. Records: D#<id>/EXPORT.
import { crc32 } from 'node:zlib';
import { Readable } from 'node:stream';

import { CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetObjectCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { audit } from './audit';
import { Identity } from './identity';
import { ddb, env, HttpError, json, randomId, Res, s3, signMediaUrl } from './lib';
import { MediaRecord } from './media';
import { notify } from './push';
import { notify as email } from './referrals';

const GB = 1024 ** 3;
const PART_MAX = 3.5 * GB;
const PART_ENTRIES = 60_000;
const BIG_FILE = 1 * GB;
const KEEP_DAYS = 7;
const AGAIN_AFTER_MS = 7 * 86_400_000;
const UPLOAD_PART = 16 * 1024 * 1024;
const lambda = new LambdaClient({});

type Part = { key: string; bytes: number; items: number };
export type ExportJob = {
  pk: string;
  sk: 'EXPORT';
  id: string;
  status: 'building' | 'ready' | 'failed';
  /** Packed up to here (items sorted by createdAt, id); only items backed up before the start. */
  cursor?: { t: number; id: string };
  doneItems: number;
  /** Small items still to pack (big ones have their own links). */
  leftItems: number;
  parts: Part[];
  /** Files over 1 GB: their own link (the original's key). */
  big: { id: string; key: string; bytes: number; name: string }[];
  totalItems: number;
  totalBytes: number;
  startedAt: number;
  updatedAt: number;
  readyAt?: number;
  expiresAt?: number;
};

const jobKey = (id: string) => ({ pk: `D#${id}`, sk: 'EXPORT' });

const fileName = (m: MediaRecord) => {
  const d = new Date(m.createdAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const ext = m.key.split('.').pop()?.slice(0, 5) || (m.kind === 'video' ? 'mp4' : 'jpg');
  return `Lens/${d.getUTCFullYear()}/Lens ${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}.${p(d.getUTCMinutes())}.${p(d.getUTCSeconds())} ${m.id.slice(-8)}.${ext}`;
};

async function lensOriginals(id: string): Promise<MediaRecord[]> {
  const out: MediaRecord[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)', ExpressionAttributeValues: { ':p': `D#${id}`, ':m': 'M#' }, ExclusiveStartKey: start }));
    for (const m of (r.Items ?? []) as (MediaRecord & { recap?: unknown })[]) {
      if (m.status === 'ready' && !m.location && !m.deletedAt && !m.archived && !m.streaming && m.size > 0) out.push(m);
    }
    start = r.LastEvaluatedKey;
  } while (start);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

async function getJob(id: string) {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: jobKey(id) }))).Item as ExportJob | undefined;
}

async function forClient(job: ExportJob | undefined) {
  if (!job) return undefined;
  const ready = job.status === 'ready' && (job.expiresAt ?? 0) > Date.now();
  return {
    status: job.status === 'ready' && !ready ? 'expired' : job.status,
    totalItems: job.totalItems,
    totalBytes: job.totalBytes,
    doneItems: job.doneItems + (job.status === 'ready' ? job.big.length : 0),
    startedAt: job.startedAt,
    readyAt: job.readyAt,
    expiresAt: job.expiresAt,
    nextAllowedAt: job.startedAt + AGAIN_AFTER_MS,
    files: ready
      ? [
          ...(await Promise.all(job.parts.map(async (p, i) => ({ name: `Lens export ${i + 1} of ${job.parts.length}.zip`, bytes: p.bytes, items: p.items, url: await signMediaUrl(p.key) })))),
          ...(await Promise.all(job.big.map(async (b) => ({ name: b.name.split('/').pop()!, bytes: b.bytes, items: 1, url: await signMediaUrl(b.key) })))),
        ]
      : [],
  };
}

/** GET /v1/export */
export async function getExport(identity: Identity): Promise<Res> {
  return json(200, { export: await forClient(await getJob(identity.id)) });
}

/** POST /v1/export: start one (at most one a week). */
export async function startExport(identity: Identity): Promise<Res> {
  if (!identity.email) throw new HttpError(403, 'Sign in to download everything', 'sign-in');
  const current = await getJob(identity.id);
  if (current?.status === 'building') return getExport(identity);
  if (current && current.startedAt + AGAIN_AFTER_MS > Date.now()) {
    throw new HttpError(429, `You can make a new export on ${new Date(current.startedAt + AGAIN_AFTER_MS).toUTCString().slice(5, 16)}.`, 'too-soon');
  }
  const media = await lensOriginals(identity.id);
  if (!media.length) throw new HttpError(400, 'Nothing in Lens storage to download.', 'nothing');
  const now = Date.now();
  const job: ExportJob = {
    ...jobKey(identity.id),
    sk: 'EXPORT',
    id: randomId(6),
    status: 'building',
    doneItems: 0,
    leftItems: media.filter((m) => m.size <= BIG_FILE).length,
    parts: [],
    big: media.filter((m) => m.size > BIG_FILE).map((m) => ({ id: m.id, key: m.key, bytes: m.size, name: fileName(m) })),
    totalItems: media.length,
    totalBytes: media.reduce((s, m) => s + m.size, 0),
    startedAt: now,
    updatedAt: now,
  };
  await ddb.send(new PutCommand({ TableName: env.table, Item: job }));
  await audit({ entity: `account:${identity.id}`, action: 'export.started', actor: identity.id, data: { items: job.totalItems, bytes: job.totalBytes } });
  await kick(identity.id);
  return getExport(identity);
}

async function kick(id: string) {
  if (!env.maintenanceFunction) return;
  await lambda.send(new InvokeCommand({ FunctionName: env.maintenanceFunction, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ exportFor: id })) }));
}

// ---------- ZIP writer (stored entries + data descriptors) ----------

function dosTime(t: number) {
  const d = new Date(t);
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

class MultipartSink {
  private parts: { ETag: string; PartNumber: number }[] = [];
  private buf: Buffer[] = [];
  private len = 0;
  written = 0;
  constructor(private key: string, private uploadId: string) {}
  static async open(key: string, downloadName: string) {
    const r = await s3.send(new CreateMultipartUploadCommand({ Bucket: env.bucket, Key: key, ContentType: 'application/zip', ContentDisposition: `attachment; filename="${downloadName}"` }));
    return new MultipartSink(key, r.UploadId!);
  }
  async write(b: Buffer) {
    this.buf.push(b);
    this.len += b.length;
    this.written += b.length;
    if (this.len >= UPLOAD_PART) await this.flush();
  }
  private async flush() {
    if (!this.len) return;
    const body = Buffer.concat(this.buf, this.len);
    this.buf = [];
    this.len = 0;
    const n = this.parts.length + 1;
    const r = await s3.send(new UploadPartCommand({ Bucket: env.bucket, Key: this.key, UploadId: this.uploadId, PartNumber: n, Body: body }));
    this.parts.push({ ETag: r.ETag!, PartNumber: n });
  }
  async close() {
    await this.flush();
    await s3.send(new CompleteMultipartUploadCommand({ Bucket: env.bucket, Key: this.key, UploadId: this.uploadId, MultipartUpload: { Parts: this.parts } }));
  }
}

/** Builds the next ZIP part; returns false when out of time before finishing (it starts over next run). */
async function buildPart(id: string, job: ExportJob, deadline: number): Promise<boolean> {
  const n = job.parts.length + 1;
  const key = `x/${id}/${job.id}/part-${n}.zip`;
  // What's left, read again (deleted since → skipped; backed up after the start → not included).
  const after = (m: MediaRecord) => !job.cursor || m.createdAt > job.cursor.t || (m.createdAt === job.cursor.t && m.id > job.cursor.id);
  const todo = (await lensOriginals(id)).filter((m) => m.size <= BIG_FILE && (m.uploadedAt ?? m.createdAt) <= job.startedAt && after(m)).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  if (!todo.length) {
    job.leftItems = 0;
    return true;
  }
  const sink = await MultipartSink.open(key, `Lens export ${n}.zip`);
  const central: Buffer[] = [];
  let cursor = job.cursor;
  let items = 0;
  for (const m of todo) {
    if (items >= PART_ENTRIES || sink.written + m.size + 200 > PART_MAX) break;
    if (Date.now() + 60_000 + (m.size / (40 * 1024 * 1024)) * 1000 > deadline) return false;
    const name = Buffer.from(fileName(m), 'utf8');
    const { time, date } = dosTime(m.createdAt);
    const offset = sink.written;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0808, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt16LE(name.length, 26);
    await sink.write(Buffer.concat([local, name]));
    const obj = await s3.send(new GetObjectCommand({ Bucket: env.bucket, Key: m.key }));
    let crc = 0;
    let size = 0;
    for await (const chunk of obj.Body as Readable) {
      const b = chunk as Buffer;
      crc = crc32(b, crc);
      size += b.length;
      await sink.write(b);
    }
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeUInt32LE(size, 8);
    desc.writeUInt32LE(size, 12);
    await sink.write(desc);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0808, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12);
    c.writeUInt16LE(date, 14);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(size, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    items++;
    cursor = { t: m.createdAt, id: m.id };
  }
  const left = todo.length - items;
  const cdStart = sink.written;
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items, 8);
  end.writeUInt16LE(items, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(cdStart, 16);
  await sink.write(Buffer.concat([cd, end]));
  await sink.close();
  job.parts.push({ key, bytes: sink.written, items });
  job.cursor = cursor;
  job.doneItems += items;
  job.leftItems = left;
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: jobKey(id),
      UpdateExpression: 'SET parts = :p, #c = :c, doneItems = :d, leftItems = :l, updatedAt = :now',
      ConditionExpression: 'id = :id',
      ExpressionAttributeNames: { '#c': 'cursor' },
      ExpressionAttributeValues: { ':p': job.parts, ':c': cursor, ':d': job.doneItems, ':l': left, ':now': Date.now(), ':id': job.id },
    }),
  );
  return true;
}

/** Maintenance { exportFor }: builds parts until done or the deadline; true when finished. */
export async function runExport(id: string, deadline: number): Promise<boolean> {
  const job = await getJob(id);
  if (!job || job.status !== 'building') return true;
  try {
    while (job.leftItems > 0) {
      if (!(await buildPart(id, job, deadline))) return false;
    }
  } catch (e) {
    console.error('export', id, e);
    await ddb.send(new UpdateCommand({ TableName: env.table, Key: jobKey(id), UpdateExpression: 'SET #s = :f, updatedAt = :now', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':f': 'failed', ':now': Date.now() } }));
    return true;
  }
  const now = Date.now();
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: jobKey(id),
      UpdateExpression: 'SET #s = :r, readyAt = :now, expiresAt = :exp, updatedAt = :now',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':r': 'ready', ':now': now, ':exp': now + (KEEP_DAYS - 1) * 86_400_000 },
    }),
  );
  const msg = { title: 'Your Lens download is ready', body: `${job.totalItems} photos and videos in ${job.parts.length + job.big.length} files. Download them within ${KEEP_DAYS - 1} days from Settings → Storage → Download everything.` };
  await notify(id, 'storage', { ...msg, route: '/storage' }).catch(() => {});
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' }, ProjectionExpression: 'email' }))).Item;
  if (p?.email) await email(p.email, msg.title, `${msg.body}\n\nOn a computer: ${env.webOrigin}/app/storage\n\n— Lens`).catch(() => {});
  return true;
}

/** Maintenance tick: exports whose worker went quiet (crash or timeout) carry on. */
export async function resumeExports(rows: { pk: string; sk: string; status?: string; updatedAt?: number }[], now = Date.now()) {
  for (const r of rows) {
    if (r.sk === 'EXPORT' && r.status === 'building' && (r.updatedAt ?? 0) < now - 20 * 60_000) await kick(String(r.pk).slice(2));
  }
}
