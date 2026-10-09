import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadObjectCommand,
  ListPartsCommand,
  Part,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { checkQuota, ddb, decodeCursor, encodeCursor, env, HttpError, json, Req, Res, s3, signMediaUrl } from './lib';
import { listStorages, PROVIDERS, Provider } from './storage';

/** Files up to this size use a single PUT; larger ones use S3 multipart. */
const SINGLE_PUT_MAX = 16 * 1024 * 1024;
const MIN_PART_SIZE = 8 * 1024 * 1024;
/** S3 allows 10,000 parts; stay well under so part size never has to change mid-upload. */
const TARGET_MAX_PARTS = 9000;
const MIB = 1024 * 1024;
/** Uploads that start while recording (size unknown): fixed parts, up to 10,000 (≈80 GB). */
const LIVE_PART_SIZE = 8 * MIB;
const MAX_PARTS = 10_000;
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
  // Common on computers (website uploads); stored as-is like every original.
  'image/webp': { ext: 'webp', kind: 'photo' },
  'image/heif': { ext: 'heif', kind: 'photo' },
  'image/avif': { ext: 'avif', kind: 'photo' },
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
  /** Non-destructive edit recipe (look, adjustments, crop…); the original is never modified. */
  edit?: Record<string, unknown>;
  /** Version of the thumbnail/preview files (bumped when an edit re-renders them). */
  derivVersion?: number;
  pendingDerivVersion?: number;
  pendingEdit?: Record<string, unknown> | null;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: number;
  uploadedAt?: number;
  /** Deleted: in the Trash for 30 days, then the Archive (see trash.ts). */
  deletedAt?: number;
  /** "Delete only for me" on a shared item: hidden from the owner, recipients keep it. */
  ownerHidden?: boolean;
  /** Tagged for the Intelligent-Tiering archive tier; off the owner's quota. */
  archived?: boolean;
  /** Archive recovery requested (S3 restore in progress). */
  recoveringSince?: number;
  /** Uploading while still recording: size is set when the recording ends. */
  streaming?: boolean;
  /** HLS streaming copy (see stream.ts): queued → ready. */
  streamStatus?: 'queued' | 'ready';
  streamJobId?: string;
  streamQueuedAt?: number;
  streamAttempts?: number;
  gsi1pk?: string;
  gsi1sk?: string;
  /**
   * The original lives in the user's own storage (Google Drive, Dropbox…), not
   * in Lens S3. Previews are still in Lens. Doesn't count toward Lens quota.
   */
  location?: StorageLocation;
};

export type StorageLocation = {
  storageId: string;
  provider: Provider;
  /** Provider file id/path, set when the upload is verified. */
  ref?: string;
  /** Provider checksum the phone verified against (e.g. Drive md5, Dropbox content_hash). */
  checksum?: string;
};

// ---------- Derivatives (thumbnail + preview) ----------
// Small JPEGs made on the phone, uploaded before the original so the item shows
// up everywhere within seconds. Stored next to (never instead of) the original.

export const DERIVATIVES = ['thumb', 'preview'] as const;
export type Derivative = (typeof DERIVATIVES)[number];
const MAX_DERIVATIVE_BYTES = 5 * 1024 * 1024;

/**
 * d/{owner}/{mediaId}/{name}.jpg (version 0) or {name}-v{n}.jpg after edits,
 * derived from the original's key m/{owner}/{mediaId}.{ext}. New versions get
 * new keys so CDN caches never serve a stale look.
 */
export function derivativeKey(originalKey: string, name: Derivative, version = 0): string {
  const [, owner, file] = originalKey.split('/');
  const mediaId = file.slice(0, file.lastIndexOf('.'));
  return `d/${owner}/${mediaId}/${name}${version ? `-v${version}` : ''}.jpg`;
}

type DerivativeSpec = { md5: string; size: number };

const MAX_EDIT_BYTES = 8 * 1024;

/** Edit recipe JSON (≤ 8 KB); null = reset to original. */
export function parseEdit(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Invalid edit');
  if (JSON.stringify(value).length > MAX_EDIT_BYTES) throw new HttpError(413, 'Edit too large');
  return value as Record<string, unknown>;
}

export function parseDerivatives(value: unknown): Partial<Record<Derivative, DerivativeSpec>> | undefined {
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

export async function derivativeUrls(
  item: MediaRecord,
  specs: Partial<Record<Derivative, DerivativeSpec>> | undefined,
  version = 0,
  force = false,
) {
  if (!specs || (item.previewReady && !force)) return undefined;
  const urls: Partial<Record<Derivative, string>> = {};
  for (const name of DERIVATIVES) {
    const spec = specs[name];
    if (!spec) continue;
    urls[name] = await presign(
      s3,
      new PutObjectCommand({
        Bucket: env.bucket,
        Key: derivativeKey(item.key, name, version),
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

export async function requireMedia(identity: Identity, id: string): Promise<MediaRecord> {
  if (!MEDIA_ID.test(id)) throw new HttpError(400, 'Invalid media id');
  const item = await getMedia(identity.id, id);
  if (!item) throw new HttpError(404, 'Not found');
  return item;
}

type ClientFields = Pick<
  MediaRecord,
  | 'id'
  | 'kind'
  | 'key'
  | 'size'
  | 'width'
  | 'height'
  | 'duration'
  | 'createdAt'
  | 'status'
  | 'previewReady'
  | 'edit'
  | 'derivVersion'
  | 'location'
> & { contentType?: string };

export async function toClient(item: ClientFields) {
  const originalReady = item.status === 'ready';
  const [url, thumbUrl, previewUrl] = await Promise.all([
    // Originals in the user's own storage are opened through their provider, not a Lens URL.
    originalReady && !item.location ? signMediaUrl(item.key) : undefined,
    item.previewReady ? signMediaUrl(derivativeKey(item.key, 'thumb', item.derivVersion)) : undefined,
    item.previewReady ? signMediaUrl(derivativeKey(item.key, 'preview', item.derivVersion)) : undefined,
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
    edit: item.edit,
    contentType: item.contentType,
    location: item.location?.ref
      ? { storageId: item.location.storageId, provider: item.location.provider, ref: item.location.ref }
      : undefined,
  };
}

/** Validates `{storageId, provider}` from the app against the identity's connected storages. */
async function parseLocation(identity: Identity, value: unknown): Promise<StorageLocation | undefined> {
  if (value === undefined || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.storageId !== 'string' || !PROVIDERS.includes(v.provider as Provider)) throw new HttpError(400, 'Invalid location');
  const connected = await listStorages(identity.id);
  if (!connected.some((s) => s.storageId === v.storageId && s.provider === v.provider)) {
    throw new HttpError(409, 'That storage isn’t connected');
  }
  return { storageId: v.storageId, provider: v.provider as Provider };
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
  const { id, contentType, width, height, duration, createdAt } = req.body;
  // A recording in progress has no size yet (streaming): its multipart upload
  // grows while recording and the size is given at /complete.
  const streaming = req.body.streaming === true;
  const size = streaming && !req.body.size ? 0 : req.body.size;
  const md5 = md5Param(req.body.md5);
  const derivatives = parseDerivatives(req.body.derivatives);
  const edit = req.body.edit === undefined ? undefined : parseEdit(req.body.edit) ?? undefined;
  if (typeof id !== 'string' || !MEDIA_ID.test(id)) throw new HttpError(400, 'Invalid media id');
  const type = CONTENT_TYPES[contentType];
  if (!type) throw new HttpError(400, 'Unsupported content type');
  if (!Number.isInteger(size) || size < 0 || (!streaming && size === 0)) throw new HttpError(400, 'Invalid size');
  if (streaming && type.kind !== 'video') throw new HttpError(400, 'Only videos can upload while recording');
  if (size > env.maxFileBytes) throw new HttpError(413, 'File too large');

  const location = await parseLocation(identity, req.body.location);

  const existing = await getMedia(identity.id, id);
  if (existing?.streaming && existing.status === 'pending' && !existing.size && size > 0) {
    // The recording ended before /complete (e.g. the app restarted): now we know its size.
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: mediaKey(identity.id, id),
        UpdateExpression: 'SET #sz = :s',
        ConditionExpression: '#st = :pending',
        ExpressionAttributeNames: { '#sz': 'size', '#st': 'status' },
        ExpressionAttributeValues: { ':s': size, ':pending': 'pending' },
      }),
    );
    existing.size = size;
  }
  if (existing) {
    if (existing.status !== 'ready' && existing.location?.storageId !== location?.storageId) {
      // Destination changed before the original finished (e.g. their storage is full → Lens).
      await switchDestination(identity, existing, location);
      return startUpload(identity, req);
    }
    const extra = { derivativeUrls: await derivativeUrls(existing, derivatives), previewReady: !!existing.previewReady };
    if (existing.status === 'ready') return json(200, { mode: 'done', media: await toClient(existing), ...extra });
    if (existing.location) return json(200, { mode: 'external', location: existing.location, ...extra });
    if (existing.uploadId) return json(200, { ...multipartPlan(existing), ...extra });
    return json(200, { mode: 'single', url: await singlePutUrl(existing, md5), contentType: existing.contentType, ...extra });
  }

  if (streaming && location) throw new HttpError(400, 'Upload while recording goes to Lens storage');
  if (!location) checkQuota(identity, size);

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
    edit,
  };

  if (location) item.location = location;
  else item.storageClass = ORIGINAL_STORAGE_CLASS;
  if (streaming) item.streaming = true;
  if (!location && (streaming || size > SINGLE_PUT_MAX)) {
    const mpu = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: env.bucket,
        Key: item.key,
        ContentType: contentType,
        StorageClass: ORIGINAL_STORAGE_CLASS,
      }),
    );
    item.uploadId = mpu.UploadId;
    item.partSize = streaming ? LIVE_PART_SIZE : partSizeFor(size);
  }

  try {
    await ddb.send(new PutCommand({ TableName: env.table, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') return startUpload(identity, req); // raced; resume
    throw error;
  }

  const extra = { derivativeUrls: await derivativeUrls(item, derivatives), previewReady: false };
  if (item.location) return json(201, { mode: 'external', location: item.location, ...extra });
  if (item.uploadId) return json(201, { ...multipartPlan(item), ...extra });
  return json(201, { mode: 'single', url: await singlePutUrl(item, md5), contentType, ...extra });
}

/** Re-points an unfinished upload at another destination (Lens ↔ their storage). */
async function switchDestination(identity: Identity, item: MediaRecord, location: StorageLocation | undefined) {
  if (item.uploadId) {
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: env.bucket, Key: item.key, UploadId: item.uploadId }))
      .catch(() => {});
  }
  const toLens = !location;
  if (toLens) checkQuota(identity, item.size);
  let uploadId: string | undefined;
  if (toLens && item.size > SINGLE_PUT_MAX) {
    const mpu = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: env.bucket,
        Key: item.key,
        ContentType: item.contentType,
        StorageClass: ORIGINAL_STORAGE_CLASS,
      }),
    );
    uploadId = mpu.UploadId;
  }
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: mediaKey(identity.id, item.id),
      UpdateExpression: toLens
        ? `SET storageClass = :sc${uploadId ? ', uploadId = :u, partSize = :ps' : ''} REMOVE #loc${uploadId ? '' : ', uploadId'}`
        : 'SET #loc = :loc REMOVE uploadId, partSize, storageClass',
      ConditionExpression: '#s = :pending',
      ExpressionAttributeNames: { '#loc': 'location', '#s': 'status' },
      ExpressionAttributeValues: {
        ':pending': 'pending',
        ...(toLens
          ? { ':sc': ORIGINAL_STORAGE_CLASS, ...(uploadId ? { ':u': uploadId, ':ps': partSizeFor(item.size) } : {}) }
          : { ':loc': location }),
      },
    }),
  );
}

/**
 * POST /v1/media/:id/external {ref, checksum}: the phone uploaded the original
 * to the user's own storage and verified the provider's checksum. Lens quota
 * is not used.
 */
export async function completeExternal(identity: Identity, id: string, req: Req): Promise<Res> {
  const item = await requireMedia(identity, id);
  if (!item.location) throw new HttpError(400, 'This item is stored in Lens');
  if (item.status === 'ready') return json(200, { media: await toClient(item) });
  const ref = req.body.ref;
  const checksum = req.body.checksum;
  if (typeof ref !== 'string' || !ref || ref.length > 1024) throw new HttpError(400, 'Invalid ref');
  if (checksum !== undefined && (typeof checksum !== 'string' || checksum.length > 200)) throw new HttpError(400, 'Invalid checksum');
  const location: StorageLocation = { ...item.location, ref, checksum };
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: mediaKey(identity.id, id),
        UpdateExpression: 'SET #s = :ready, uploadedAt = :now, #loc = :loc',
        ConditionExpression: '#s = :pending AND #loc.storageId = :sid',
        ExpressionAttributeNames: { '#s': 'status', '#loc': 'location' },
        ExpressionAttributeValues: { ':ready': 'ready', ':pending': 'pending', ':now': Date.now(), ':loc': location, ':sid': location.storageId },
      }),
    );
  } catch (error: any) {
    if (error?.name !== 'ConditionalCheckFailedException') throw error;
    const latest = await requireMedia(identity, id);
    return json(latest.status === 'ready' ? 200 : 409, { media: await toClient(latest) });
  }
  return json(200, { media: await toClient({ ...item, status: 'ready', location }) });
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
    // etag = MD5 of the part (SSE-S3), so the app can re-check parts of a file
    // that changed after upload (a recording's header is rewritten at the end).
    return json(200, { parts: parts.map((p) => ({ n: p.PartNumber, size: p.Size, etag: p.ETag?.replace(/"/g, '') })) });
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
  const maxPart = item.streaming && !item.size ? MAX_PARTS : Math.ceil(item.size / (item.partSize ?? partSizeFor(item.size)));
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

/** POST /v1/media/:id/complete {size?}: verify the object in S3 and mark it ready. */
export async function completeUpload(identity: Identity, id: string, req?: Req): Promise<Res> {
  const item = await requireMedia(identity, id);
  if (item.location) throw new HttpError(400, 'This item goes to your own storage');
  if (item.status === 'ready') return json(200, { media: await toClient(item) });

  if (item.streaming) {
    // Recorded while uploading: the final size arrives now.
    const size = req?.body?.size ?? item.size;
    if (!Number.isInteger(size) || size <= 0) throw new HttpError(400, 'Missing final size');
    if (size > env.maxFileBytes) throw new HttpError(413, 'File too large');
    checkQuota(identity, size);
    if (size !== item.size) {
      await ddb.send(
        new UpdateCommand({
          TableName: env.table,
          Key: mediaKey(identity.id, id),
          UpdateExpression: 'SET #sz = :s',
          ExpressionAttributeNames: { '#sz': 'size' },
          ExpressionAttributeValues: { ':s': size },
        }),
      );
      item.size = size;
    }
  }

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
      FilterExpression:
        '(#s = :ready OR previewReady = :t) AND attribute_not_exists(deletedAt) AND attribute_not_exists(ownerHidden)',
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
