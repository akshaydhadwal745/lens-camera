// Uploads one local capture to S3 through the API. Fully resumable: the API's
// start call is idempotent per media id and reports which multipart parts S3
// already holds, so after a crash, kill or network loss we just call
// uploadEntry() again and it continues where it stopped.
//
// Integrity: every request carries the MD5 of exactly the bytes being sent
// (computed natively), and that MD5 is part of the presigned signature, so S3
// rejects anything that arrives altered. Originals are never re-encoded.
import { File, FileMode, Paths, UploadType } from 'expo-file-system';

import { api } from './api';
import { captureFile, fileFor, fileSize } from './local-store';
import { LocalEntry, RemoteMedia } from './types';

export class UploadCancelled extends Error {}

type Options = {
  onProgress: (fraction: number) => void;
  isCancelled: () => boolean;
  /** Parts uploaded in parallel (multipart only). */
  concurrency?: number;
  /** False when only thumbnail + preview may go up now (e.g. big file on mobile data). */
  includeOriginal?: boolean;
  /** Called as soon as the item is visible in the cloud (previews verified). */
  onPreviews?: (media: RemoteMedia) => void;
};

export type UploadResult = { media: RemoteMedia; originalDone: boolean };

type DerivativeName = 'thumb' | 'preview';

function derivativeFiles(entry: LocalEntry): Partial<Record<DerivativeName, File>> {
  const out: Partial<Record<DerivativeName, File>> = {};
  if (entry.thumbFile) out.thumb = captureFile(entry.thumbFile);
  if (entry.previewFile) out.preview = captureFile(entry.previewFile);
  return out;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Hex MD5 (as returned natively) → base64, the form the Content-MD5 header wants. */
export function md5HexToBase64(hex: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = bytes.slice(i, i + 3);
    const n = (a << 16) | (b << 8) | c;
    out += BASE64[(n >> 18) & 63] + BASE64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64[n & 63] : '=';
  }
  return out;
}

function md5Of(file: File): string {
  const hex = file.md5;
  if (!hex) throw new Error('Could not checksum the file');
  return md5HexToBase64(hex);
}

async function put(file: File, url: string, headers: Record<string, string>, onBytes: (sent: number) => void) {
  const result = await file.upload(url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers,
    onProgress: ({ bytesSent }) => onBytes(bytesSent),
  });
  if (result.status < 200 || result.status >= 300) {
    const reason = /BadDigest|InvalidDigest/.test(result.body) ? 'checksum mismatch' : `status ${result.status}`;
    throw new Error(`Storage rejected upload (${reason})`);
  }
}

/** Copies part `n` of the file into a temporary chunk file. */
function writeChunk(source: File, entry: LocalEntry, n: number, partSize: number): File {
  const offset = (n - 1) * partSize;
  const length = Math.min(partSize, entry.size - offset);
  const handle = source.open(FileMode.ReadOnly);
  let bytes: Uint8Array;
  try {
    handle.offset = offset;
    bytes = handle.readBytes(length);
  } finally {
    handle.close();
  }
  const chunk = new File(Paths.cache, `part-${entry.id}-${n}.bin`);
  if (chunk.exists) chunk.delete();
  chunk.create();
  chunk.write(bytes);
  return chunk;
}

export async function uploadEntry(
  original: LocalEntry,
  { onProgress, isCancelled, concurrency = 3, includeOriginal = true, onPreviews }: Options,
): Promise<UploadResult> {
  const source = fileFor(original);
  if (!source.exists) throw new Error('Local file is missing');
  // Always measure the file itself; the stored size may be stale or missing.
  const entry = { ...original, size: fileSize(source) };
  if (entry.size <= 0) throw new Error('Could not read the file size');

  // Small files go up in one request; checksum them whole (native, fast).
  const singleMd5 = entry.size <= 16 * 1024 * 1024 ? md5Of(source) : undefined;

  // Thumbnail + preview (small) go first, so the item shows up everywhere quickly.
  const derivatives = original.previewsUploaded ? {} : derivativeFiles(original);
  const derivativeSpecs =
    derivatives.thumb?.exists && derivatives.preview?.exists
      ? {
          thumb: { md5: md5Of(derivatives.thumb), size: fileSize(derivatives.thumb) },
          preview: { md5: md5Of(derivatives.preview), size: fileSize(derivatives.preview) },
        }
      : undefined;

  const plan = await api.startUpload({
    md5: singleMd5,
    derivatives: derivativeSpecs,
    id: entry.id,
    kind: entry.kind,
    contentType: entry.contentType,
    size: entry.size,
    width: entry.width,
    height: entry.height,
    duration: entry.duration,
    createdAt: entry.createdAt,
  });

  let latest: RemoteMedia | undefined = plan.mode === 'done' ? plan.media : undefined;
  if (plan.derivativeUrls && derivativeSpecs) {
    for (const name of ['thumb', 'preview'] as const) {
      const url = plan.derivativeUrls[name];
      const file = derivatives[name];
      if (!url || !file) continue;
      await put(file, url, { 'Content-Type': 'image/jpeg', 'Content-MD5': derivativeSpecs[name].md5 }, () => {});
    }
    latest = (await api.previewsUploaded(entry.id)).media;
    onPreviews?.(latest);
  } else if (plan.previewReady && !original.previewsUploaded) {
    onPreviews?.(latest ?? (await api.previewsUploaded(entry.id)).media);
  }

  if (plan.mode === 'done') return { media: latest ?? plan.media, originalDone: true };
  if (!includeOriginal) {
    if (!latest) throw new Error('Nothing could be uploaded on this network yet');
    return { media: latest, originalDone: false };
  }

  if (plan.mode === 'single') {
    const headers: Record<string, string> = { 'Content-Type': plan.contentType };
    if (singleMd5) headers['Content-MD5'] = singleMd5;
    await put(source, plan.url, headers, (sent) => onProgress(sent / entry.size));
  } else {
    const { partSize } = plan;
    const total = Math.ceil(entry.size / partSize);
    const expected = (n: number) => Math.min(partSize, entry.size - (n - 1) * partSize);
    const { parts } = await api.uploadedParts(entry.id);
    const done = new Set(parts.filter((p) => p.size === expected(p.n)).map((p) => p.n));
    let doneBytes = [...done].reduce((sum, n) => sum + expected(n), 0);
    onProgress(doneBytes / entry.size);

    const missing = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !done.has(n));
    const inFlight = new Map<number, number>();
    const report = () => {
      let sending = 0;
      inFlight.forEach((b) => (sending += b));
      onProgress(Math.min(1, (doneBytes + sending) / entry.size));
    };

    // A small pool of workers, each taking the next missing part.
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        if (isCancelled()) throw new UploadCancelled();
        const n = missing[next++];
        const chunk = writeChunk(source, entry, n, partSize);
        try {
          const md5 = md5Of(chunk);
          const { urls } = await api.partUrls(entry.id, [{ n, md5 }]);
          inFlight.set(n, 0);
          await put(chunk, urls[n], { 'Content-MD5': md5 }, (sent) => {
            inFlight.set(n, sent);
            report();
          });
        } finally {
          inFlight.delete(n);
          if (chunk.exists) chunk.delete();
        }
        doneBytes += expected(n);
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, missing.length)) }, worker));
  }

  if (isCancelled()) throw new UploadCancelled();
  const { media } = await api.complete(entry.id);
  onProgress(1);
  return { media, originalDone: true };
}
