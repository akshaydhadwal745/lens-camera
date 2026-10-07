// Uploads one local capture to S3 through the API. Fully resumable: the API's
// start call is idempotent per media id and reports which multipart parts S3
// already holds, so after a crash, kill or network loss we just call
// uploadEntry() again and it continues where it stopped.
import { File, FileMode, Paths, UploadType } from 'expo-file-system';

import { api } from './api';
import { fileFor, fileSize } from './local-store';
import { LocalEntry, RemoteMedia } from './types';

const URL_BATCH = 10;

export class UploadCancelled extends Error {}

type Options = {
  onProgress: (fraction: number) => void;
  isCancelled: () => boolean;
};

async function put(file: File, url: string, contentType: string | undefined, onBytes: (sent: number) => void) {
  const result = await file.upload(url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: contentType ? { 'Content-Type': contentType } : {},
    onProgress: ({ bytesSent }) => onBytes(bytesSent),
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Storage rejected upload (${result.status})`);
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

export async function uploadEntry(original: LocalEntry, { onProgress, isCancelled }: Options): Promise<RemoteMedia> {
  const source = fileFor(original);
  if (!source.exists) throw new Error('Local file is missing');
  // Always measure the file itself; the stored size may be stale or missing.
  const entry = { ...original, size: fileSize(source) };
  if (entry.size <= 0) throw new Error('Could not read the file size');

  const plan = await api.startUpload({
    id: entry.id,
    kind: entry.kind,
    contentType: entry.contentType,
    size: entry.size,
    width: entry.width,
    height: entry.height,
    duration: entry.duration,
    createdAt: entry.createdAt,
  });

  if (plan.mode === 'done') return plan.media;

  if (plan.mode === 'single') {
    await put(source, plan.url, plan.contentType, (sent) => onProgress(sent / entry.size));
  } else {
    const { partSize } = plan;
    const total = Math.ceil(entry.size / partSize);
    const expected = (n: number) => Math.min(partSize, entry.size - (n - 1) * partSize);
    const { parts } = await api.uploadedParts(entry.id);
    const done = new Set(parts.filter((p) => p.size === expected(p.n)).map((p) => p.n));
    let doneBytes = [...done].reduce((sum, n) => sum + expected(n), 0);
    onProgress(doneBytes / entry.size);

    const missing = Array.from({ length: total }, (_, i) => i + 1).filter((n) => !done.has(n));
    for (let i = 0; i < missing.length; i += URL_BATCH) {
      const batch = missing.slice(i, i + URL_BATCH);
      const { urls } = await api.partUrls(entry.id, batch);
      for (const n of batch) {
        if (isCancelled()) throw new UploadCancelled();
        const chunk = writeChunk(source, entry, n, partSize);
        try {
          await put(chunk, urls[n], undefined, (sent) => onProgress((doneBytes + sent) / entry.size));
        } finally {
          if (chunk.exists) chunk.delete();
        }
        doneBytes += expected(n);
        onProgress(doneBytes / entry.size);
      }
    }
  }

  if (isCancelled()) throw new UploadCancelled();
  const { media } = await api.complete(entry.id);
  onProgress(1);
  return media;
}
