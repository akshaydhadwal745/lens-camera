// Native on-device storage: captured files in the documents directory plus a
// JSON index, a cache of the cloud listing (for offline), and preferences.
// File names are stored rather than absolute URIs because the iOS container
// path can change between installs.
import { Directory, File, FileMode, Paths } from 'expo-file-system';

import { LocalEntry, NewCapture, RemoteMedia, newId } from './types';

const capturesDir = new Directory(Paths.document, 'captures');
const indexFile = new File(Paths.document, 'captures-index.json');
const remoteCacheFile = new File(Paths.document, 'remote-cache.json');
const prefsFile = new File(Paths.document, 'prefs.json');

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  heic: 'image/heic',
  png: 'image/png',
  dng: 'image/x-adobe-dng',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
};

function readJson<T>(file: File, fallback: T): T {
  try {
    return file.exists ? (JSON.parse(file.textSync()) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file: File, value: unknown) {
  if (!file.exists) file.create();
  file.write(JSON.stringify(value));
}

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Size in bytes. `file.size` can come back null/0 on iOS right after a move,
 * so fall back to info() and finally to an open file handle.
 */
export function fileSize(file: File): number {
  const fromProperty = file.size;
  if (fromProperty > 0) return fromProperty;
  try {
    const fromInfo = file.info().size;
    if (fromInfo && fromInfo > 0) return fromInfo;
  } catch {
    // Try the handle.
  }
  try {
    const handle = file.open(FileMode.ReadOnly);
    try {
      return handle.size ?? 0;
    } finally {
      handle.close();
    }
  } catch {
    return 0;
  }
}

export function fileFor(entry: Pick<LocalEntry, 'fileName'>): File {
  return new File(capturesDir, entry.fileName);
}

export function uriFor(entry: Pick<LocalEntry, 'fileName'>): string {
  return fileFor(entry).uri;
}

/** A file next to the originals (thumbnails, previews). */
export function captureFile(name: string): File {
  capturesDir.create({ idempotent: true });
  return new File(capturesDir, name);
}

export function loadEntries(): LocalEntry[] {
  capturesDir.create({ idempotent: true });
  const raw = readJson<Partial<LocalEntry>[]>(indexFile, []);
  const exists = (name?: string) => (name && new File(capturesDir, name).exists ? name : undefined);
  const out: LocalEntry[] = [];
  for (const e of raw) {
    if (!e.id || !e.fileName) continue;
    const hasOriginal = fileFor(e as LocalEntry).exists;
    const thumbFile = exists(e.thumbFile);
    const previewFile = exists(e.previewFile);
    // Without the original, an entry is only worth keeping if it's safe in the
    // cloud and we still have its previews (offloaded by the storage guardian).
    if (!hasOriginal && !(e.uploadedAt && (thumbFile || previewFile))) continue;
    const size = e.size && e.size > 0 ? e.size : hasOriginal ? fileSize(fileFor(e as LocalEntry)) : 0;
    // Entries that failed only because their size was misread get retried.
    const sizeError = !e.uploadedAt && e.error && /invalid size/i.test(e.error);
    out.push({
      ...(e as LocalEntry),
      thumbFile,
      previewFile,
      contentType: e.contentType ?? CONTENT_TYPES[extOf(e.fileName)] ?? 'image/jpeg',
      size,
      offloadedAt: hasOriginal ? undefined : (e.offloadedAt ?? Date.now()),
      liveUploading: undefined, // a restart ends live uploading; the regular uploader finishes it
      ...(sizeError ? { error: undefined, attempts: 0, nextAttemptAt: undefined } : {}),
    });
  }
  return out;
}

export function saveEntries(entries: LocalEntry[]) {
  writeJson(indexFile, entries);
}

/** Moves a fresh camera file into permanent storage and returns its entry. */
export function importCapture(input: NewCapture): LocalEntry {
  capturesDir.create({ idempotent: true });
  const id = input.id ?? newId();
  const source = new File(input.sourceUri);
  const ext = extOf(source.name) || (input.kind === 'video' ? 'mov' : 'jpg');
  const fileName = `${id}.${ext}`;
  const dest = new File(capturesDir, fileName);
  source.moveSync(dest);
  return {
    id,
    kind: input.kind,
    fileName,
    contentType: CONTENT_TYPES[ext] ?? (input.kind === 'video' ? 'video/quicktime' : 'image/jpeg'),
    size: fileSize(dest),
    createdAt: Date.now(),
    width: input.width,
    height: input.height,
    duration: input.duration,
    edit: input.edit,
    ...(input.live ? { liveUploading: true, streamed: true } : {}),
  };
}

export function deleteFileFor(entry: LocalEntry) {
  for (const name of [entry.fileName, entry.thumbFile, entry.previewFile]) {
    if (!name) continue;
    const file = new File(capturesDir, name);
    if (file.exists) file.delete();
  }
}

/** Removes only the original (thumbnail + preview stay). Returns bytes freed. */
export function deleteOriginal(entry: LocalEntry): number {
  const file = fileFor(entry);
  if (!file.exists) return 0;
  const bytes = fileSize(file) || entry.size;
  file.delete();
  return bytes;
}

/** Free space on the phone in bytes, or null if the OS doesn't tell us. */
export function freeDiskBytes(): number | null {
  try {
    const free = Paths.availableDiskSpace;
    return Number.isFinite(free) && free > 0 ? free : null;
  } catch {
    return null;
  }
}

/** Cloud originals downloaded for sharing, saving or editing (re-downloadable). */
const DOWNLOAD_PREFIXES = ['dl-', 'orig-', 'poster-'];

/** Deletes cached downloads of cloud originals. Returns bytes freed. */
export function clearDownloadCache(): number {
  let bytes = 0;
  try {
    for (const item of new Directory(Paths.cache).list()) {
      if (!(item instanceof File) || !DOWNLOAD_PREFIXES.some((p) => item.name.startsWith(p))) continue;
      bytes += fileSize(item);
      item.delete();
    }
  } catch {
    // Best effort.
  }
  return bytes;
}

export function loadRemoteCache(): RemoteMedia[] {
  return readJson<RemoteMedia[]>(remoteCacheFile, []);
}

export function saveRemoteCache(items: RemoteMedia[]) {
  writeJson(remoteCacheFile, items);
}

export function loadPrefs<T extends object>(fallback: T): T {
  return { ...fallback, ...readJson<Partial<T>>(prefsFile, {}) };
}

export function savePrefs(prefs: object) {
  writeJson(prefsFile, prefs);
}

/** Small JSON documents in the documents directory (camera settings, presets…). */
export function loadDoc<T>(name: string, fallback: T): T {
  return readJson<T>(new File(Paths.document, `${name}.json`), fallback);
}

export function saveDoc(name: string, value: unknown) {
  writeJson(new File(Paths.document, `${name}.json`), value);
}

/** Removes leftover multipart chunk files from the cache directory. */
export function clearChunkFiles() {
  try {
    for (const item of new Directory(Paths.cache).list()) {
      if (item instanceof File && item.name.startsWith('part-')) item.delete();
    }
  } catch {
    // Best effort.
  }
}
