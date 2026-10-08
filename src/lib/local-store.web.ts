// Web is a viewer only: nothing is captured or kept locally except prefs.
import { LocalEntry, NewCapture, RemoteMedia } from './types';

const PREFS_KEY = 'lens.prefs';

export function fileFor(): never {
  throw new Error('No local files on web');
}
export function uriFor(_entry: Pick<LocalEntry, 'fileName'>): string {
  return '';
}
export function captureFile(_name: string): never {
  throw new Error('No local files on web');
}
export function loadEntries(): LocalEntry[] {
  return [];
}
export function saveEntries(_entries: LocalEntry[]) {}
export function importCapture(_input: NewCapture): LocalEntry {
  throw new Error('Capturing is not available on web');
}
export function deleteFileFor(_entry: LocalEntry) {}
export function deleteOriginal(_entry: LocalEntry): number {
  return 0;
}
export function freeDiskBytes(): number | null {
  return null;
}
export function clearDownloadCache(): number {
  return 0;
}
export function loadRemoteCache(): RemoteMedia[] {
  return [];
}
export function saveRemoteCache(_items: RemoteMedia[]) {}
export function loadPrefs<T extends object>(fallback: T): T {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return fallback;
  }
}
export function savePrefs(prefs: object) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable (private mode).
  }
}
export function clearChunkFiles() {}
export function loadDoc<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`lens.${name}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function saveDoc(name: string, value: unknown) {
  try {
    localStorage.setItem(`lens.${name}`, JSON.stringify(value));
  } catch {
    // Storage may be unavailable.
  }
}
