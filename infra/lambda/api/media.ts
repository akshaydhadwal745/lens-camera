import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  Part,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import {
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, decodeCursor, encodeCursor, env, HttpError, json, Req, Res, s3, signMediaUrl } from './lib';

/** Files up to this size use a single PUT; larger ones use S3 multipart. */
const SINGLE_PUT_MAX = 16 * 1024 * 1024;
const MIN_PART_SIZE = 8 * 1024 * 1024;
/** S3 allows 10,000 parts; stay well under so part size never has to change mid-upload. */
const TARGET_MAX_PARTS = 9000;
const MIB = 1024 * 1024;
const PRESIGN_SECONDS = 3600;
/** Originals are written once and read rarely: let S3 move them to cheaper
 * instant-access tiers automatically (no retrieval fees, millisecond access). */
const ORIGINAL_STORAGE_CLASS = 'INTELLIGENT_TIERING' as const;
const MD5_BASE64 = /^[A-Za-z0-9+/]{22}==$/;

/** Part size for a file: at least 8 MiB, whole MiB, and never more than ~9,000 parts. */
export function partSizeFor(size: number): number {
  return Math.max(MIN_PART_SIZE, Math.ceil(size / TARGET_MAX_PARTS / MIB) * MIB);
}

function md5Param(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !MD5_BASE64.test(value)) throw new HttpError(400, 'Invalid md5');
  return value;
}

const CONTENT_TYPES: Record<string, { ext: string; kind: 'photo' | 'video' }> = {
  'image/jpeg': { ext: 'jpg', kind: 'photo' },
  'image/heic': { ext: 'heic', kind: 'photo' },
  'image/png': { ext: 'png', kind: 'photo' },
  'image/x-adobe-dng': { ext: 'dng', kind: 'photo' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
};

/** Client-generated, time-sortable ids: 8 base36 chars of ms timestamp + '-' + random. */
const MEDIA_ID = /^[0-9a-z]{8}-[0-9a-z]{4,12}$/;

export type MediaRecord = {
  pk: string;
  sk: string;
  id: string;
  kind: 'photo' | 'video';
  contentType: string;
  key: string;
  size: number;
  status: 'pending' | 'ready';
  uploadId?: string;
  partSize?: number;
  storageClass?: string;
  /** Thumbnail + preview uploaded and verified (visible before the original finishes). */
  previewReady?: boolean;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: number;
  uploadedAt?: number;
};

// ---------- Derivatives (thumbnail + preview) ----------
// Small JPEGs made on the phone, uploaded before the original so the item shows
// up everywhere within seconds. Stored next to (never instead of) the original.

export const DERIVATIVES = ['thumb', 'preview'] as const;
export type Derivative = (typeof DERIVATIVES)[number];
const MAX_DERIVATIVE_BYTES = 5 * 1024 * 1024;

/** d/{owner}/{mediaId}/{name}.jpg, derived from the original's key m/{owner}/{mediaId}.{ext}. */
export function derivativeKey(originalKey: string, name: Derivative): string {
  const [, owner, file] = originalKey.split('/');
  const mediaId = file.slice(0, file.lastIndexOf('.'));
  return `d/${owner}/${mediaId}/${name}.jpg`;
}

type DerivativeSpec = { md5: string; size: number };

function parseDerivatives(value: unknown): Partial<Record<Derivative, DerivativeSpec>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Partial<Record<Derivative, DerivativeSpec>> = {};
  for (const name of DERIVATIVES) {
    const spec = (value as Record<string, any>)[name];
    if (!spec) continue;
    const md5 = md5Param(spec.md5);
    if (!md5 || !Number.isInteger(spec.size) || spec.size <= 0 || spec.size > MAX_DERIVATIVE_BYTES) {
      throw new HttpError(400, `Invalid ${name}`);
    }
    out[name] = { md5, size: spec.size };
  }
  return Object.keys(out).length ? out : undefined;
}

async function derivativeUrls(item: MediaRecord, specs: Partial<Record<Derivative, DerivativeSpec>> | undefined) {
  if (!specs || item.previewReady) return undefined;
  const urls: Partial<Record<Derivative, string>> = {};
  for (const name of DERIVATIVES) {
    const spec = specs[name];
    if (!spec) continue;
    urls[name] = await presign(
      s3,
      new PutObjectCommand({
        Bucket: env.bucket,
        Key: derivativeKey(item.key, name),
        ContentType: 'image/jpeg',
        ContentMD5: spec.md5,
        CacheControl: 'private, max-age=31536000, immutable',
      }),
      { expiresIn: PRESIGN_SECONDS },
    );
  }
  return urls;
}

export function mediaKey(ownerId: string, id: string) {
  return { pk: `D#${ownerId}`, sk: `M#${id}` };
}

export async function getMedia(ownerId: string, id: string): Promise<MediaRecord | undefined> {
  const result = await ddb.send(new GetCommand({ TableName: env.table, Key: mediaKey(ownerId, id) }));
  return result.Item as MediaRecord | undefined;
}

async function requireMedia(identity: Identity, id: string): Promise<MediaRecord> {
  if (!MEDIA_ID.test(id)) throw new HttpError(400, 'Invalid media id');
  const item = await getMedia(identity.id, id);
  if (!item) throw new HttpError(404, 'Not found');
  return item;
}

type ClientFields = Pick<
  MediaRecord,
  'id' | 'kind' | 'key' | 'size' | 'width' | 'height' | 'duration' | 'createdAt' | 'status' | 'previewReady'
>;

export async function toClient(item: ClientFields) {
  const originalReady = item.status === 'ready';
  const [url, thumbUrl, previewUrl] = await Promise.all([
    originalReady ? signMediaUrl(item.key) : undefined,
    item.previewReady ? signMediaUrl(derivativeKey(item.key, 'thumb')) : undefined,
    item.previewReady ? signMediaUrl(derivativeKey(item.key, 'preview')) : undefined,
  ]);
  return {
    id: item.id,
    kind: item.kind,
    size: item.size,
    width: item.width,
    height: item.height,
    duration: item.duration,
    createdAt: item.createdAt,
    originalReady,
    url,
    thumbUrl,
    previewUrl,
  };
}

/**
 * Single-PUT URL. When the client sends the file's MD5, it is part of the
 * signature: S3 rejects the upload (BadDigest) unless the bytes match.
 */
function singlePutUrl(item: MediaRecord, md5?: string) {
  return presign(
    s3,
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: item.key,
      ContentType: item.contentType,
      ContentMD5: md5,
      StorageClass: ORIGINAL_STORAGE_CLASS,
    }),
    { expiresIn: PRESIGN_SECONDS },
  );
}

function multipartPlan(item: MediaRecord) {
  return { mode: 'multipart' as const, uploadId: item.uploadId, partSize: item.partSize ?? partSizeFor(item.size) };
}

/**
 * POST /v1/media: start (or resume) an upload. Idempotent per media id, so the
 * app can call it again after a crash or network loss.
 */
export async function startUpload(identity: Identity, req: Req): Promise<Res> {
  const { id, contentType, size, width, height, duration, createdAt } = req.body;
  const md5 = md5Param(req.body.md5);
  const derivatives = parseDerivatives(req.body.derivatives);
  if (typeof id !== 'string' || !MEDIA_ID.test(id)) throw new HttpError(400, 'Invalid media id');
  const type = CONTENT_TYPES[contentType];
  if (!type) throw new HttpError(400, 'Unsupported content type');
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'Invalid size');
  if (size > env.maxFileBytes) throw new HttpError(413, 'File too large');

  const existing = await getMedia(identity.id, id);
  if (existing) {
    const extra = { derivativeUrls: await derivativeUrls(existing, derivatives), previewReady: !!existing.previewReady };
    if (existing.status === 'ready') return json(200, { mode: 'done', media: await toClient(existing), ...extra });
    if (existing.uploadId) return json(200, { ...multipartPlan(existing), ...extra });
    return json(200, { mode: 'single', url: await singlePutUrl(existing, md5), contentType: existing.contentType, ...extra });
  }

  if (identity.usedBytes + size > env.quotaBytes) throw new HttpError(413, 'Storage quota exceeded');

  const item: MediaRecord = {
    ...mediaKey(identity.id, id),
    id,
    kind: type.kind,
    contentType,
    key: `m/${identity.id}/${id}.${type.ext}`,
    size,
    status: 'pending',
    width: num(width),
    height: num(height),
    duration: num(duration),
    createdAt: num(createdAt) ?? Date.now(),
  };

  item.storageClass = ORIGINAL_STORAGE_CLASS;
  if (size > SINGLE_PUT_MAX) {
    const mpu = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: env.bucket,
        Key: item.key,
        ContentType: contentType,
        StorageClass: ORIGINAL_STORAGE_CLASS,
      }),
    );
    item.uploadId = mpu.UploadId;
    item.partSize = partSizeFor(size);
  }

  try {
    await ddb.send(new PutCommand({ TableName: env.table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') return startUpload(identity, req); // raced; resume
    throw error;
  }

  const extra = { derivativeUrls: await derivativeUrls(item, derivatives), previewReady: false };
  if (item.uploadId) return json(201, { ...multipartPlan(item), ...extra });
  return json(201, { mode: 'single', url: await singlePutUrl(item, md5), contentType, ...extra });
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function listAllParts(item: MediaRecord): Promise<Part[]> {
  const parts: Part[] = [];
  let marker: string | undefined;
  do {
    const page = await s3.send(
      new ListPartsCommand({ Bucket: env.bucket, Key: item.key, UploadId: item.uploadId, PartNumberMarker: marker }),
    );
    parts.push(...(page.Parts ?? []));
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
}

/**
 * POST /v1/media/:id/previews: the phone uploaded thumbnail + preview; verify
 * they exist and make the item visible on other devices (before the original).
 */
export async function previewsUploaded(identity: Identity, id: string): Promise<Res> {
  const item = await requireMedia(identity, id);
  if (!item.previewReady) {
    for (const name of DERIVATIVES) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: env.bucket, Key: derivativeKey(item.key, name) }));
      } catch (error: any) {
        if (error?.name === 'NotFound') throw new HttpError(409, `${name} not uploaded yet`);
        throw error;
      }
    }
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: mediaKey(identity.id, id),
        UpdateExpression: 'SET previewReady = :t',
        ExpressionAttributeValues: { ':t': true },
      }),
    );
    item.previewReady = true;
  }
  return json(200, { media: await toClient(item) });
}

/** GET /v1/media/:id/parts: which parts S3 already has (for resuming). */
export async function uploadedParts(identity: Identity, id: string): Promise<Res> {
  const item = await requireMedia(identity, id);
  if (!item.uploadId) throw new HttpError(400, 'Not a multipart upload');
  try {
    const parts = await listAllParts(item);
    return json(200, { parts: parts.map((p) => ({ n: p.PartNumber, size: p.Size })) });
  } catch (error: any) {
    // The bucket aborts multipart uploads idle for 7 days (e.g. a big video
    // waiting for Wi-Fi). Start a fresh one transparently.
    if (error?.name !== 'NoSuchUpload') throw error;
    const mpu = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: env.bucket,
        Key: item.key,
        ContentType: item.contentType,
        StorageClass: ORIGINAL_STORAGE_CLASS,
      }),
    );
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: mediaKey(identity.id, id),
        UpdateExpression: 'SET uploadId = :u',
        ExpressionAttributeValues: { ':u': mpu.UploadId },
      }),
    );
    return json(200, { parts: [] });
  }
}

/**
 * POST /v1/media/:id/parts {parts: [{n, md5}]}: presigned URLs for the given
 * parts. Each part's MD5 is signed in, so S3 verifies every part on arrival.
 * (`partNumbers: number[]` without checksums is still accepted.)
 */
export async function partUrls(identity: Identity, id: string, req: Req): Promise<Res> {
  const item = await requireMedia(identity, id);
  if (!item.uploadId || item.status !== 'pending') throw new HttpError(400, 'Upload is not in progress');
  const requested: { n: unknown; md5?: unknown }[] = Array.isArray(req.body.parts)
    ? req.body.parts
    : Array.isArray(req.body.partNumbers)
      ? req.body.partNumbers.map((n: unknown) => ({ n }))
      : [];
  const maxPart = Math.ceil(item.size / (item.partSize ?? partSizeFor(item.size)));
  const urls: Record<number, string> = {};
  for (const { n, md5 } of requested.slice(0, 50)) {
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > maxPart) throw new HttpError(400, 'Invalid part number');
    urls[n as number] = await presign(
      s3,
      new UploadPartCommand({
        Bucket: env.bucket,
        Key: item.key,
        UploadId: item.uploadId,
        PartNumber: n as number,
        ContentMD5: md5Param(md5),
      }),
      { expiresIn: PRESIGN_SECONDS },
    );
  }
  return json(200, { urls });
}

/** POST /v1/media/:id/complete: verify the object in S3 and mark it ready. */
export async function completeUpload(identity: Identity, id: string): Promise<Res> {
  const item = await requireMedia(identity, id);
  if (item.status === 'ready') return json(200, { media: await toClient(item) });

  if (item.uploadId) {
    const parts = await listAllParts(item);
    const expected = Math.ceil(item.size / (item.partSize ?? partSizeFor(item.size)));
    const total = parts.reduce((sum, p) => sum + (p.Size ?? 0), 0);
    if (parts.length !== expected || total !== item.size) {
      throw new HttpError(409, `Upload incomplete: ${parts.length}/${expected} parts`);
    }
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: env.bucket,
        Key: item.key,
        UploadId: item.uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })) },
      }),
    );
  } else {
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: env.bucket, Key: item.key }));
      if (head.ContentLength !== item.size) throw new HttpError(409, 'Uploaded size does not match');
    } catch (error: any) {
      if (error instanceof HttpError) throw error;
      if (error?.name === 'NotFound') throw new HttpError(409, 'Upload not found in storage');
      throw error;
    }
  }

  try {
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: env.table,
              Key: mediaKey(identity.id, id),
              UpdateExpression: 'SET #s = :ready, uploadedAt = :now REMOVE uploadId',
              ConditionExpression: '#s = :pending',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':ready': 'ready', ':pending': 'pending', ':now': Date.now() },
            },
          },
          {
            Update: {
              TableName: env.table,
              Key: { pk: `D#${identity.id}`, sk: 'PROFILE' },
              UpdateExpression: 'ADD usedBytes :size',
              ExpressionAttributeValues: { ':size': item.size },
            },
          },
        ],
      }),
    );
  } catch (error: any) {
    // Another request completed it first; that's fine.
    if (error?.name !== 'TransactionCanceledException') throw error;
  }
  return json(200, { media: await toClient({ ...item, status: 'ready' }) });
}

/** GET /v1/media?cursor=: this identity's uploaded media, newest first. */
export async function listMedia(identity: Identity, req: Req): Promise<Res> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)',
      FilterExpression: '#s = :ready OR previewReady = :t',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':m': 'M#', ':ready': 'ready', ':t': true },
      ScanIndexForward: false,
      Limit: 100,
      ExclusiveStartKey: decodeCursor(req.query.cursor),
    }),
  );
  const items = await Promise.all((result.Items as MediaRecord[]).map(toClient));
  return json(200, { items, cursor: encodeCursor(result.LastEvaluatedKey) });
}

/** DELETE /v1/media/:id: removes the object, the record and any shares of it. */
export async function deleteMedia(identity: Identity, id: string): Promise<Res> {
  const item = await requireMedia(identity, id);

  if (item.uploadId) {
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: env.bucket, Key: item.key, UploadId: item.uploadId }))
      .catch(() => {});
  }
  await s3.send(new DeleteObjectCommand({ Bucket: env.bucket, Key: item.key }));
  await Promise.all(
    DERIVATIVES.map((name) =>
      s3.send(new DeleteObjectCommand({ Bucket: env.bucket, Key: derivativeKey(item.key, name) })).catch(() => {}),
    ),
  );

  await ddb.send(new DeleteCommand({ TableName: env.table, Key: mediaKey(identity.id, id) }));
  if (item.status === 'ready') {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${identity.id}`, sk: 'PROFILE' },
        UpdateExpression: 'ADD usedBytes :neg',
        ExpressionAttributeValues: { ':neg': -item.size },
      }),
    );
  }

  // Remove the item from everyone it was shared with.
  const shares = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :g',
      ExpressionAttributeValues: { ':g': `SM#${identity.id}#${id}` },
      ProjectionExpression: 'pk, sk',
    }),
  );
  const keys = (shares.Items ?? []).map((s) => ({ DeleteRequest: { Key: { pk: s.pk, sk: s.sk } } }));
  for (let i = 0; i < keys.length; i += 25) {
    await ddb.send(new BatchWriteCommand({ RequestItems: { [env.table]: keys.slice(i, i + 25) } }));
  }

  return json(200, { deleted: id });
}
