// App state: identity, local captures + upload queue, cloud listing, shared
// items and settings. Components read it with useStore(selector).
import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { api, ApiError, setAuth } from './api';
import { ensureIdentity, Identity, loadIdentity, saveIdentity } from './identity';
import {
  captureFile,
  clearChunkFiles,
  deleteFileFor,
  importCapture,
  loadEntries,
  loadPrefs,
  loadRemoteCache,
  saveEntries,
  savePrefs,
  saveRemoteCache,
  uriFor,
} from './local-store';
import { GalleryItem, LocalEntry, NewCapture, RemoteMedia, SharedMedia } from './types';
import { makeDerivatives } from './derivatives';
import { UploadCancelled, uploadEntry } from './uploader';

const isWeb = Platform.OS === 'web';
const DAY = 24 * 3600 * 1000;
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000];
const REMOTE_STALE_MS = 30 * 60 * 1000;

export type CellularPolicy = 'all' | 'small' | 'off';

export type Settings = {
  /** Days to keep a local copy after it's safely in the cloud; -1 = forever. */
  retentionDays: number;
  /** What may upload over mobile data: everything, files ≤ 100 MB, or nothing. */
  cellularUploads: CellularPolicy;
};

export const CELLULAR_OPTIONS: { value: CellularPolicy; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'small', label: 'Up to 100 MB' },
  { value: 'off', label: 'Wi-Fi only' },
];

const SMALL_FILE_BYTES = 100 * 1024 * 1024;

export const RETENTION_OPTIONS = [
  { days: 1, label: '1 day' },
  { days: 3, label: '3 days' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: -1, label: 'Always' },
];

const DEFAULT_SETTINGS: Settings = { retentionDays: 7, cellularUploads: 'small' };

export type State = {
  status: 'booting' | 'ready' | 'needs-link';
  identity: Identity | null;
  entries: LocalEntry[];
  remote: RemoteMedia[];
  remoteFetchedAt: number;
  remoteLoading: boolean;
  shared: SharedMedia[];
  sharedLoading: boolean;
  uploadingId: string | null;
  progress: number;
  online: boolean;
  /** Connected over mobile data (uploads follow `settings.cellularUploads`). */
  cellular: boolean;
  settings: Settings;
  usage: { usedBytes: number; quotaBytes: number } | null;
};

let state: State = {
  status: 'booting',
  identity: null,
  entries: [],
  remote: [],
  remoteFetchedAt: 0,
  remoteLoading: false,
  shared: [],
  sharedLoading: false,
  uploadingId: null,
  progress: 0,
  online: true,
  cellular: false,
  settings: DEFAULT_SETTINGS,
  usage: null,
};

const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getState() {
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

// ---------- Derived data (memoized on input references) ----------

let galleryMemo: { entries: LocalEntry[]; remote: RemoteMedia[]; uploadingId: string | null; out: GalleryItem[] } | null =
  null;

export function selectGallery(s: State): GalleryItem[] {
  if (galleryMemo && galleryMemo.entries === s.entries && galleryMemo.remote === s.remote && galleryMemo.uploadingId === s.uploadingId) {
    return galleryMemo.out;
  }
  const map = new Map<string, GalleryItem>();
  for (const r of s.remote) {
    map.set(r.id, {
      id: r.id,
      kind: r.kind,
      createdAt: r.createdAt,
      width: r.width,
      height: r.height,
      duration: r.duration,
      size: r.size,
      remoteUrl: r.url,
      thumbUri: r.thumbUrl,
      previewUri: r.previewUrl,
      sync: r.originalReady ? 'synced' : 'partial',
    });
  }
  for (const e of s.entries) {
    const cloud = map.get(e.id);
    const originalInCloud = !!e.uploadedAt || cloud?.sync === 'synced';
    const sync: GalleryItem['sync'] = originalInCloud
      ? 'synced'
      : s.uploadingId === e.id
        ? 'uploading'
        : e.error
          ? 'failed'
          : e.previewsUploaded || cloud
            ? 'partial'
            : 'queued';
    map.set(e.id, {
      ...cloud,
      id: e.id,
      kind: e.kind,
      createdAt: e.createdAt,
      width: e.width,
      height: e.height,
      duration: e.duration,
      size: e.size,
      localUri: uriFor(e),
      // Local derivative files are faster than the network; fall back to cloud ones.
      thumbUri: e.thumbFile ? captureFile(e.thumbFile).uri : cloud?.thumbUri,
      previewUri: e.previewFile ? captureFile(e.previewFile).uri : cloud?.previewUri,
      sync,
      error: e.error,
    });
  }
  const out = [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
  galleryMemo = { entries: s.entries, remote: s.remote, uploadingId: s.uploadingId, out };
  return out;
}

let sharedMemo: { shared: SharedMedia[]; out: GalleryItem[] } | null = null;

export function selectShared(s: State): GalleryItem[] {
  if (sharedMemo?.shared === s.shared) return sharedMemo.out;
  const out = s.shared.map<GalleryItem>((m) => ({
    id: m.id,
    kind: m.kind,
    createdAt: m.createdAt,
    width: m.width,
    height: m.height,
    duration: m.duration,
    size: m.size,
    remoteUrl: m.url,
    thumbUri: m.thumbUrl,
    previewUri: m.previewUrl,
    sync: 'synced',
    ownerId: m.ownerId,
    ownerName: m.ownerName,
  }));
  sharedMemo = { shared: s.shared, out };
  return out;
}

export const selectPendingCount = (s: State) => s.entries.filter((e) => !e.uploadedAt && !e.error).length;

/** Previews always go up (tiny); originals follow the mobile-data setting. */
function needsWork(e: LocalEntry, s: State, now: number): boolean {
  if (e.error || (e.nextAttemptAt ?? 0) > now) return false;
  if (!e.previewsUploaded && e.thumbFile && e.previewFile) return true; // includes backfill for old items
  return !e.uploadedAt && allowedOnThisNetwork(e, s);
}

function allowedOnThisNetwork(e: LocalEntry, s: State): boolean {
  if (!s.cellular) return true;
  const policy = s.settings.cellularUploads;
  return policy === 'all' || (policy === 'small' && e.size <= SMALL_FILE_BYTES);
}

/** Items held back until Wi-Fi by the mobile-data setting. */
export const selectWaitingForWifi = (s: State) =>
  s.entries.filter((e) => !e.uploadedAt && !e.error && !allowedOnThisNetwork(e, s)).length;
export const selectFailedCount = (s: State) => s.entries.filter((e) => !e.uploadedAt && e.error).length;

let usageMemo: { entries: LocalEntry[]; out: ReturnType<typeof computeLocalUsage> } | null = null;

export function selectLocalUsage(s: State) {
  if (usageMemo?.entries !== s.entries) usageMemo = { entries: s.entries, out: computeLocalUsage(s) };
  return usageMemo.out;
}

function computeLocalUsage(s: State) {
  let bytes = 0;
  let freeable = 0;
  let freeableCount = 0;
  for (const e of s.entries) {
    bytes += e.size;
    if (e.uploadedAt) {
      freeable += e.size;
      freeableCount += 1;
    }
  }
  return { count: s.entries.length, bytes, freeable, freeableCount };
}

// ---------- Boot ----------

let booted = false;

export async function boot() {
  if (booted) return;
  booted = true;

  const settings = loadPrefs(DEFAULT_SETTINGS);
  set({ settings, entries: loadEntries(), remote: loadRemoteCache() });
  clearChunkFiles();

  const identity = await loadIdentity();
  if (identity) applyIdentity(identity);

  if (isWeb) {
    set({ status: identity ? 'ready' : 'needs-link' });
  } else {
    // The camera works offline; the identity is created on first connectivity.
    set({ status: 'ready' });
    watchConnectivity();
  }

  runCleanup();
  if (!isWeb) void backfillDerivatives();
  if (state.identity || !isWeb) {
    void ensureCloudIdentity().then((ok) => {
      if (!ok) return;
      refreshRemote();
      refreshShared();
      kickSync();
    });
  }
}

function watchConnectivity() {
  NetInfo.addEventListener((net) => {
    const online = net.isConnected !== false && net.isInternetReachable !== false;
    const wasOnline = state.online;
    const wasCellular = state.cellular;
    const cellular = net.type === 'cellular';
    set({ online, cellular });
    if (wasCellular && !cellular) kickSync(); // Wi-Fi arrived: release held-back items
    if (online && !wasOnline) {
      kickSync();
      refreshRemote();
    }
  });
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    runCleanup();
    kickSync();
    if (Date.now() - state.remoteFetchedAt > REMOTE_STALE_MS) {
      refreshRemote();
      refreshShared();
    }
  });
}

// ---------- Identity ----------

function applyIdentity(identity: Identity | null) {
  setAuth(identity?.token ?? null, handleUnauthorized);
  set({ identity });
}

async function handleUnauthorized() {
  // The token is no longer valid (identity removed server-side).
  await saveIdentity(null);
  applyIdentity(null);
  saveRemoteCache([]);
  set({ remote: [], shared: [], usage: null, ...(isWeb ? { status: 'needs-link' as const } : {}) });
}

let identityInflight: Promise<boolean> | null = null;

/** Native: make sure this device has a cloud identity (registers on first use). */
function ensureCloudIdentity(): Promise<boolean> {
  if (state.identity) return Promise.resolve(true);
  if (isWeb) return Promise.resolve(false);
  identityInflight ??= ensureIdentity()
    .then((identity) => {
      applyIdentity(identity);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      identityInflight = null;
    });
  return identityInflight;
}

/** Web: sign this browser in as the identity that generated `code`. */
export async function linkWithCode(code: string) {
  const identity = await api.claimPairing(code);
  await saveIdentity(identity);
  applyIdentity(identity);
  set({ status: 'ready' });
  refreshRemote();
  refreshShared();
}

export async function unlinkBrowser() {
  await saveIdentity(null);
  applyIdentity(null);
  set({ status: 'needs-link', remote: [], shared: [], usage: null });
}

// ---------- Cloud listings ----------

let remoteInflight: Promise<void> | null = null;

export function refreshRemote(): Promise<void> {
  if (!state.identity) return Promise.resolve();
  remoteInflight ??= (async () => {
    set({ remoteLoading: true });
    try {
      const all: RemoteMedia[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const result = await api.listMedia(cursor);
        all.push(...result.items);
        cursor = result.cursor;
        if (!cursor) break;
      }
      set({ remote: all, remoteFetchedAt: Date.now() });
      saveRemoteCache(all);
      api
        .me()
        .then((me) => set({ usage: { usedBytes: me.usedBytes, quotaBytes: me.quotaBytes } }))
        .catch(() => {});
    } catch {
      // Keep showing the cached listing.
    } finally {
      set({ remoteLoading: false });
      remoteInflight = null;
    }
  })();
  return remoteInflight;
}

let sharedInflight: Promise<void> | null = null;

export function refreshShared(): Promise<void> {
  if (!state.identity) return Promise.resolve();
  sharedInflight ??= (async () => {
    set({ sharedLoading: true });
    try {
      const all: SharedMedia[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page++) {
        const result = await api.shared(cursor);
        all.push(...result.items);
        cursor = result.cursor;
        if (!cursor) break;
      }
      set({ shared: all });
    } catch {
      // Keep the previous list.
    } finally {
      set({ sharedLoading: false });
      sharedInflight = null;
    }
  })();
  return sharedInflight;
}

function upsertRemote(media: RemoteMedia) {
  const remote = [media, ...state.remote.filter((r) => r.id !== media.id)].sort((a, b) => b.createdAt - a.createdAt);
  set({ remote });
  saveRemoteCache(remote);
}

// ---------- Capture + upload queue ----------

function setEntries(entries: LocalEntry[]) {
  saveEntries(entries);
  set({ entries });
}

function updateEntry(id: string, patch: Partial<LocalEntry>) {
  if (!state.entries.some((e) => e.id === id)) return;
  setEntries(state.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
}

/** Saves a fresh capture locally and queues it for upload immediately. */
export function capture(input: NewCapture): LocalEntry {
  const entry = importCapture(input);
  setEntries([entry, ...state.entries]);
  void ensureDerivatives(entry).finally(kickSync);
  return entry;
}

/** Older captures (before previews existed): make their previews one at a time. */
async function backfillDerivatives() {
  for (const entry of state.entries) {
    if (entry.thumbFile && entry.previewFile) continue;
    await ensureDerivatives(entry);
  }
  kickSync();
}

/** Makes thumbnail + preview if missing. Failure is non-fatal: the original still uploads. */
async function ensureDerivatives(entry: LocalEntry): Promise<LocalEntry> {
  if (entry.thumbFile && entry.previewFile) return entry;
  try {
    const files = await makeDerivatives(entry);
    updateEntry(entry.id, files);
    return { ...entry, ...files };
  } catch (error) {
    console.warn('Could not make previews', entry.id, error);
    return entry;
  }
}

let syncing = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const cancelled = new Set<string>();

export function kickSync() {
  if (!syncing && !isWeb) void syncLoop();
}

async function syncLoop() {
  syncing = true;
  try {
    while (state.online) {
      const now = Date.now();
      // Newest first, so the shot you just took reaches the cloud first.
      const next = state.entries.find((e) => needsWork(e, state, now));
      if (!next) break;
      if (!(await ensureCloudIdentity())) {
        updateEntry(next.id, { nextAttemptAt: Date.now() + BACKOFF_MS[2] });
        break;
      }

      set({ uploadingId: next.id, progress: 0 });
      let lastEmit = 0;
      try {
        const entry = await ensureDerivatives(next);
        const result = await uploadEntry(entry, {
          onProgress: (p) => {
            const t = Date.now();
            if (t - lastEmit > 150 || p >= 1) {
              lastEmit = t;
              set({ progress: p });
            }
          },
          isCancelled: () => cancelled.has(next.id),
          concurrency: state.cellular ? 2 : 3,
          includeOriginal: !entry.uploadedAt && allowedOnThisNetwork(entry, state),
          onPreviews: (media) => {
            updateEntry(next.id, { previewsUploaded: true });
            upsertRemote(media);
          },
        });
        updateEntry(next.id, {
          previewsUploaded: !!(entry.thumbFile && entry.previewFile) || entry.previewsUploaded,
          ...(result.originalDone ? { uploadedAt: entry.uploadedAt ?? Date.now() } : {}),
          attempts: 0,
          nextAttemptAt: undefined,
          error: undefined,
        });
        upsertRemote(result.media);
      } catch (error) {
        if (error instanceof UploadCancelled) continue;
        const attempts = (next.attempts ?? 0) + 1;
        if (error instanceof ApiError && error.permanent) {
          updateEntry(next.id, { attempts, error: error.message });
        } else {
          updateEntry(next.id, {
            attempts,
            nextAttemptAt: Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
          });
        }
        if (error instanceof ApiError && error.status === 0) break; // offline; NetInfo will wake us
      } finally {
        set({ uploadingId: null, progress: 0 });
      }
    }
  } finally {
    syncing = false;
    scheduleRetry();
  }
}

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const waits = state.entries
    .filter((e) => !e.uploadedAt && !e.error && e.nextAttemptAt)
    .map((e) => e.nextAttemptAt! - Date.now());
  if (!waits.length) return;
  retryTimer = setTimeout(kickSync, Math.max(1000, Math.min(...waits)));
}

export function retryFailed() {
  setEntries(
    state.entries.map((e) => (e.error && !e.uploadedAt ? { ...e, error: undefined, attempts: 0, nextAttemptAt: undefined } : e)),
  );
  kickSync();
}

// ---------- Delete / cleanup ----------

/** Deletes items everywhere (cloud + this device). Returns ids that failed. */
export async function deleteItems(ids: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    const entry = state.entries.find((e) => e.id === id);
    const inCloud = state.remote.some((r) => r.id === id);
    const touchedServer = inCloud || !!entry?.uploadedAt || !!entry?.attempts || state.uploadingId === id;

    if (state.uploadingId === id) cancelled.add(id);
    if (touchedServer) {
      try {
        await api.deleteMedia(id);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) {
          failed.push(id);
          continue;
        }
      }
    }
    if (entry) {
      deleteFileFor(entry);
      setEntries(state.entries.filter((e) => e.id !== id));
    }
    if (inCloud) {
      const remote = state.remote.filter((r) => r.id !== id);
      set({ remote });
      saveRemoteCache(remote);
    }
  }
  if (failed.length < ids.length) api.me().then((me) => set({ usage: me })).catch(() => {});
  return failed;
}

export async function removeSharedItem(item: GalleryItem) {
  if (!item.ownerId) return;
  await api.removeShared(item.ownerId, item.id);
  set({ shared: state.shared.filter((s) => !(s.id === item.id && s.ownerId === item.ownerId)) });
}

function dropLocalCopies(predicate: (e: LocalEntry) => boolean): { count: number; bytes: number } {
  // Only ever drop copies that are confirmed in the cloud.
  const drop = state.entries.filter((e) => e.uploadedAt && predicate(e));
  if (!drop.length) return { count: 0, bytes: 0 };
  drop.forEach(deleteFileFor);
  const ids = new Set(drop.map((e) => e.id));
  setEntries(state.entries.filter((e) => !ids.has(e.id)));
  return { count: drop.length, bytes: drop.reduce((sum, e) => sum + e.size, 0) };
}

/** Removes local copies older than the retention window. */
export function runCleanup() {
  const days = state.settings.retentionDays;
  if (days < 0) return { count: 0, bytes: 0 };
  const cutoff = Date.now() - days * DAY;
  return dropLocalCopies((e) => e.uploadedAt! < cutoff);
}

/** Removes every local copy that is already safe in the cloud. */
export function freeUpSpace() {
  return dropLocalCopies(() => true);
}

export function setRetention(days: number) {
  const settings = { ...state.settings, retentionDays: days };
  savePrefs(settings);
  set({ settings });
  runCleanup();
}

export function setCellularUploads(policy: CellularPolicy) {
  const settings = { ...state.settings, cellularUploads: policy };
  savePrefs(settings);
  set({ settings });
  kickSync();
}
