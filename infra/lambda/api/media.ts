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
const PART_SIZE = 8 * 1024 * 1024;
const PRESIGN_SECONDS = 3600;

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
  width?: number;
  height?: number;
  duration?: number;
  createdAt: number;
  uploadedAt?: number;
};

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

export async function toClient(item: Pick<MediaRecord, 'id' | 'kind' | 'key' | 'size' | 'width' | 'height' | 'duration' | 'createdAt'>) {
  return {
    id: item.id,
    kind: item.kind,
    size: item.size,
    width: item.width,
    height: item.height,
    duration: item.duration,
    createdAt: item.createdAt,
    url: await signMediaUrl(item.key),
  };
}

function singlePutUrl(item: MediaRecord) {
  return presign(
    s3,
    new PutObjectCommand({ Bucket: env.bucket, Key: item.key, ContentType: item.contentType }),
    { expiresIn: PRESIGN_SECONDS },
  );
}

/**
 * POST /v1/media: start (or resume) an upload. Idempotent per media id, so the
 * app can call it again after a crash or network loss.
 */
export async function startUpload(identity: Identity, req: Req): Promise<Res> {
  const { id, contentType, size, width, height, duration, createdAt } = req.body;
  if (typeof id !== 'string' || !MEDIA_ID.test(id)) throw new HttpError(400, 'Invalid media id');
  const type = CONTENT_TYPES[contentType];
  if (!type) throw new HttpError(400, 'Unsupported content type');
  if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'Invalid size');
  if (size > env.maxFileBytes) throw new HttpError(413, 'File too large');

  const existing = await getMedia(identity.id, id);
  if (existing) {
    if (existing.status === 'ready') return json(200, { mode: 'done', media: await toClient(existing) });
    if (existing.uploadId) return json(200, { mode: 'multipart', uploadId: existing.uploadId, partSize: PART_SIZE });
    return json(200, { mode: 'single', url: await singlePutUrl(existing), contentType: existing.contentType });
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

  if (size > SINGLE_PUT_MAX) {
    const mpu = await s3.send(
      new CreateMultipartUploadCommand({ Bucket: env.bucket, Key: item.key, ContentType: contentType }),
    );
    item.uploadId = mpu.UploadId;
  }

  try {
    await ddb.send(new PutCommand({ TableName: env.table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') return startUpload(identity, req); // raced; resume
    throw error;
  }

  if (item.uploadId) return json(201, { mode: 'multipart', uploadId: item.uploadId, partSize: PART_SIZE });
  return json(201, { mode: 'single', url: await singlePutUrl(item), contentType });
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

/** GET /v1/media/:id/parts: which parts S3 already has (for resuming). */
export async function uploadedParts(identity: Identity, id: string): Promise<Res> {
  const item = await requireMedia(identity, id);
  if (!item.uploadId) throw new HttpError(400, 'Not a multipart upload');
  const parts = await listAllParts(item);
  return json(200, { parts: parts.map((p) => ({ n: p.PartNumber, size: p.Size })) });
}

/** POST /v1/media/:id/parts {partNumbers}: presigned URLs for the given parts. */
export async function partUrls(identity: Identity, id: string, req: Req): Promise<Res> {
  const item = await requireMedia(identity, id);
  if (!item.uploadId || item.status !== 'pending') throw new HttpError(400, 'Upload is not in progress');
  const numbers: unknown[] = Array.isArray(req.body.partNumbers) ? req.body.partNumbers.slice(0, 50) : [];
  const maxPart = Math.ceil(item.size / PART_SIZE);
  const urls: Record<number, string> = {};
  for (const n of numbers) {
    if (!Number.isInteger(n) || (n as number) < 1 || (n as number) > maxPart) throw new HttpError(400, 'Invalid part number');
    urls[n as number] = await presign(
      s3,
      new UploadPartCommand({ Bucket: env.bucket, Key: item.key, UploadId: item.uploadId, PartNumber: n as number }),
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
    const expected = Math.ceil(item.size / PART_SIZE);
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
  return json(200, { media: await toClient(item) });
}

/** GET /v1/media?cursor=: this identity's uploaded media, newest first. */
export async function listMedia(identity: Identity, req: Req): Promise<Res> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)',
      FilterExpression: '#s = :ready',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':m': 'M#', ':ready': 'ready' },
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
