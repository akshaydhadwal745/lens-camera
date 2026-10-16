// A copy of a video with its location removed, for videos shared without
// "include location" (photos: exif-strip.ts). Only the few bytes around the
// location boxes (in moov) pass through here; the rest is copied inside S3
// (multipart UploadPartCopy), so a 2 GB video costs seconds, not 2 GB of Lambda.
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';

import { readMp4Location, wipeBoxes } from '../../../src/lib/mp4-location';
import { s3 } from './lib';

const MIN_PART = 5 * 1024 * 1024; // S3: every part but the last
const COPY_PART = 1024 * 1024 * 1024;
const SMALL = 32 * 1024 * 1024; // download, edit, put

async function range(bucket: string, key: string, start: number, length: number): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array(0);
  const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=${start}-${start + length - 1}` }));
  return new Uint8Array(await got.Body!.transformToByteArray());
}

/** [from, to) split into near-equal parts of at most COPY_PART (so none is under 5 MB unless it's alone). */
function split(from: number, to: number): [number, number][] {
  if (to <= from) return [];
  const n = Math.ceil((to - from) / COPY_PART);
  const step = Math.ceil((to - from) / n);
  const out: [number, number][] = [];
  for (let a = from; a < to; a += step) out.push([a, Math.min(to, a + step)]);
  return out;
}

/**
 * Writes `dstKey` = `srcKey` without its location. Returns 'copied', 'none' (the
 * file has no location: share the original as is) or 'unreadable' (no moov we can
 * read: share the preview only, as for HEIC/RAW).
 */
export async function stripVideoLocation(
  bucket: string,
  srcKey: string,
  dstKey: string,
  size: number,
  contentType: string,
): Promise<'copied' | 'none' | 'unreadable'> {
  const found = await readMp4Location((o, n) => range(bucket, srcKey, o, Math.min(n, size - o)), size);
  if (!found) return 'unreadable';
  if (!found.boxes.length) return 'none';

  if (size <= SMALL) {
    const bytes = await range(bucket, srcKey, 0, size);
    wipeBoxes(bytes, 0, found.boxes);
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: dstKey, Body: bytes, ContentType: contentType }));
    return 'copied';
  }

  // The edited part [m0, m1) holds every location box; parts before it are ≥ 5 MB,
  // and it is ≥ 5 MB itself unless it runs to the end (the last part may be small).
  const lo = Math.min(...found.boxes.map((b) => b.start));
  const hi = Math.max(...found.boxes.map((b) => b.start + b.size));
  const m0 = lo >= 2 * MIN_PART ? lo - MIN_PART : 0;
  const m1 = Math.min(size, Math.max(hi, m0 + MIN_PART));
  const edited = await range(bucket, srcKey, m0, m1 - m0);
  wipeBoxes(edited, m0, found.boxes);

  const { UploadId } = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: dstKey, ContentType: contentType }));
  try {
    const source = `${bucket}/${srcKey.split('/').map(encodeURIComponent).join('/')}`;
    const copy = (n: number, [a, b]: [number, number]) =>
      s3
        .send(new UploadPartCopyCommand({ Bucket: bucket, Key: dstKey, UploadId, PartNumber: n, CopySource: source, CopySourceRange: `bytes=${a}-${b - 1}` }))
        .then((r) => ({ PartNumber: n, ETag: r.CopyPartResult!.ETag! }));
    const before = split(0, m0);
    const after = split(m1, size);
    const parts = await Promise.all([
      ...before.map((r, i) => copy(i + 1, r)),
      s3
        .send(new UploadPartCommand({ Bucket: bucket, Key: dstKey, UploadId, PartNumber: before.length + 1, Body: edited }))
        .then((r) => ({ PartNumber: before.length + 1, ETag: r.ETag! })),
      ...after.map((r, i) => copy(before.length + 2 + i, r)),
    ]);
    await s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: dstKey, UploadId, MultipartUpload: { Parts: parts } }));
    return 'copied';
  } catch (error) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: dstKey, UploadId })).catch(() => {});
    throw error;
  }
}
