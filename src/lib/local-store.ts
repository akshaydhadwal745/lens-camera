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

export function loadEntries(): LocalEntry[] {
  capturesDir.create({ idempotent: true });
  const raw = readJson<Partial<LocalEntry>[]>(indexFile, []);
  // Drop entries whose file is gone; fill fields missing from older versions.
  return raw
    .filter((e): e is LocalEntry => !!e.id && !!e.fileName && fileFor(e as LocalEntry).exists)
    .map((e) => {
      const size = e.size && e.size > 0 ? e.size : fileSize(fileFor(e));
      // Entries that failed only because their size was misread get retried.
      const sizeError = !e.uploadedAt && e.error && /invalid size/i.test(e.error);
      return {
        ...e,
        contentType: e.contentType ?? CONTENT_TYPES[extOf(e.fileName)] ?? 'image/jpeg',
        size,
        ...(sizeError ? { error: undefined, attempts: 0, nextAttemptAt: undefined } : {}),
      };
    });
}

export function saveEntries(entries: LocalEntry[]) {
  writeJson(indexFile, entries);
}

/** Moves a fresh camera file into permanent storage and returns its entry. */
export function importCapture(input: NewCapture): LocalEntry {
  capturesDir.create({ idempotent: true });
  const id = newId();
  const source = new File(input.sourceUri);
  const ext = extOf(source.name) || (input.kind === 'video' ? 'mov' : 'jpg');
  const fileName = `${id}.${ext}`;
  const dest = new File(capturesDir, fileName);
  source.move(dest);
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
  };
}

export function deleteFileFor(entry: LocalEntry) {
  const file = fileFor(entry);
  if (file.exists) file.delete();
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
