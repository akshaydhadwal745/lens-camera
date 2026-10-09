// App state: identity, local captures + upload queue, cloud listing, shared
// items and settings. Components read it with useStore(selector).
import NetInfo from '@react-native-community/netinfo';
import { useSyncExternalStore } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { api, ApiError, setAuth, SignInResult } from './api';
import { deviceLabel, ensureIdentity, Identity, loadIdentity, saveIdentity } from './identity';
import {
  captureFile,
  clearChunkFiles,
  clearDownloadCache,
  deleteFileFor,
  deleteOriginal,
  freeDiskBytes,
  importCapture,
  importEntry,
  loadDoc,
  loadEntries,
  loadPrefs,
  loadRemoteCache,
  saveDoc,
  saveEntries,
  savePrefs,
  saveRemoteCache,
  uriFor,
} from './local-store';
import {
  DeleteScope,
  GalleryItem,
  LocalEntry,
  NewCapture,
  OffloadReason,
  ProviderId,
  RemoteMedia,
  SharedMedia,
  ConnectedStorage,
  StorageOverview,
  TrashItem,
} from './types';
import { makeDerivatives } from './derivatives';
import { renderCloudDerivatives } from './edit-remote';
import { compact, EditRecipe, forPaste } from './edits';
import { pushEdit, UploadCancelled, uploadEntry } from './uploader';
import { authForLocation, authorizeInBrowser, checkStorage, chooseDestination, storageAction } from './storage';
import { FileTooLarge, SignedOut, StorageFull } from './storage/types';
import { LiveUpload } from './live-upload';
import { setPrefetchContext } from './video-prefetch';
import { registerBackgroundBackup } from './background';
import { backupService, mediaPicker, onThermalChange, ThermalLevel, thermalLevel } from '../../modules/lens-device';

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
  /** Storage guardian: keep at least this much free on the phone; 0 = off. */
  keepFreeGB: number;
  /** Upload videos while recording (Android): on Wi-Fi only, on any network, or never. */
  liveUpload: LiveUploadPolicy;
};

export type LiveUploadPolicy = 'wifi' | 'all' | 'off';

export const LIVE_UPLOAD_OPTIONS: { value: LiveUploadPolicy; label: string }[] = [
  { value: 'wifi', label: 'Wi-Fi only' },
  { value: 'all', label: 'Wi-Fi + mobile data' },
  { value: 'off', label: 'Off' },
];

export const KEEP_FREE_OPTIONS = [
  { gb: 0, label: 'Off' },
  { gb: 1, label: '1 GB' },
  { gb: 2, label: '2 GB' },
  { gb: 5, label: '5 GB' },
  { gb: 10, label: '10 GB' },
];

const GB = 1024 ** 3;
/** Below this the phone is nearly full (warn if nothing more can be freed). */
const CRITICAL_FREE_BYTES = 500 * 1024 ** 2;

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

const DEFAULT_SETTINGS: Settings = { retentionDays: 7, cellularUploads: 'small', keepFreeGB: 2, liveUpload: 'wifi' };

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
  /** Originals on their way to the cloud right now (regular and live uploads), by id. */
  transfers: Record<string, Transfer>;
  online: boolean;
  /** Connected over mobile data (uploads follow `settings.cellularUploads`). */
  cellular: boolean;
  settings: Settings;
  usage: { usedBytes: number; quotaBytes: number } | null;
  /** "Copy edit" clipboard (looks + adjustments, never crop). */
  copiedEdit: EditRecipe | null;
  /** Free space on the phone (null = unknown, e.g. web). */
  freeBytes: number | null;
  /** Deleted items (Trash + Archive), loaded when the Trash screen opens. */
  trash: TrashItem[];
  trashLoading: boolean;
  /** Lens storage usage + connected storages (null until loaded). */
  storage: StorageOverview | null;
  /**
   * The account's session ended (logged out from another device, or expired).
   * Uploads pause until the user signs in again, so nothing lands in a new guest.
   */
  signedOut: boolean;
  /** Phone heat: when hot, uploads and preview-making pause until it cools. */
  thermal: ThermalLevel;
  /** An import is waiting because the phone is low on space. */
  importWaitingForSpace: boolean;
  /** The storage guardian just removed originals for space (gallery note until dismissed). */
  spaceFreed: { count: number; bytes: number; keepFreeGB: number; at: number } | null;
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
  transfers: {},
  online: true,
  cellular: false,
  settings: DEFAULT_SETTINGS,
  usage: null,
  copiedEdit: null,
  freeBytes: null,
  trash: [],
  trashLoading: false,
  storage: null,
  signedOut: false,
  thermal: 'normal',
  spaceFreed: null,
  importWaitingForSpace: false,
};

const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if ('cellular' in patch || 'thermal' in patch) setPrefetchContext({ cellular: state.cellular, hot: isHot(state.thermal) });
  listeners.forEach((l) => l());
}

// ---------- Transfers (bytes in the cloud vs on the phone) ----------

export type Transfer = {
  /** Bytes of the original already in the cloud (or being sent). */
  sent: number;
  /** Size of the original; grows while a video is still recording. */
  total: number;
  /** Upload speed, bytes per second (smoothed; 0 until known). */
  rate: number;
  /** Still recording (upload while recording). */
  recording?: boolean;
  /** When `sent`/`rate` were last measured. */
  at: number;
};

const TRANSFER_EMIT_MS = 400;

/** Records upload progress for the gallery/viewer/camera; throttled, speed smoothed. */
function setTransfer(id: string, sent: number, total: number, recording = false) {
  const prev = state.transfers[id];
  const now = Date.now();
  const done = total > 0 && sent >= total && !recording;
  if (prev && now - prev.at < TRANSFER_EMIT_MS && !done && prev.recording === recording) return;
  let rate = prev?.rate ?? 0;
  if (prev && now > prev.at && sent >= prev.sent) {
    const instant = ((sent - prev.sent) * 1000) / (now - prev.at);
    rate = rate ? rate * 0.8 + instant * 0.2 : instant;
  }
  set({ transfers: { ...state.transfers, [id]: { sent, total: Math.max(total, sent), rate, recording, at: now } } });
}

function clearTransfer(id: string) {
  if (!state.transfers[id]) return;
  const { [id]: _, ...rest } = state.transfers;
  set({ transfers: rest });
}

type TransferTotals = { sent: number; total: number; rate: number; count: number };
let totalsMemo: { transfers: State['transfers']; out: TransferTotals } | null = null;

/** All current transfers summed, for the gallery's upload bar (memoized: stable for useStore). */
export function selectTransferTotals(s: State): TransferTotals {
  if (totalsMemo?.transfers === s.transfers) return totalsMemo.out;
  totalsMemo = { transfers: s.transfers, out: sumTransfers(s.transfers) };
  return totalsMemo.out;
}

function sumTransfers(transfers: State['transfers']): TransferTotals {
  let sent = 0;
  let total = 0;
  let rate = 0;
  let count = 0;
  for (const t of Object.values(transfers)) {
    sent += t.sent;
    total += t.total;
    rate += t.rate;
    count++;
  }
  return { sent, total, rate, count };
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
      edit: r.edit,
      location: r.location,
      contentType: r.contentType,
    });
  }
  for (const e of s.entries) {
    const cloud = map.get(e.id);
    const originalInCloud = !!e.uploadedAt || cloud?.sync === 'synced';
    const sync: GalleryItem['sync'] = originalInCloud
      ? 'synced'
      : s.uploadingId === e.id || e.liveUploading
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
      // Imports: until copied (and after our copy is removed) the phone's own gallery file is the local original.
      localUri: e.awaitingCopy ? e.importUri : e.offloadedAt ? e.importUri : uriFor(e),
      offloadReason: e.offloadedAt ? e.offloadReason : undefined,
      // Local derivative files are faster than the network; fall back to cloud ones.
      thumbUri: e.thumbFile ? captureFile(e.thumbFile).uri : cloud?.thumbUri,
      previewUri: e.previewFile ? captureFile(e.previewFile).uri : cloud?.previewUri,
      sync,
      error: e.error,
      edit: e.edit ?? cloud?.edit,
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
    edit: m.edit,
    ownerId: m.ownerId,
    ownerName: m.ownerName,
  }));
  sharedMemo = { shared: s.shared, out };
  return out;
}

export const selectPendingCount = (s: State) => s.entries.filter((e) => !e.uploadedAt && !e.error).length;

/** Previews always go up (tiny); originals follow the mobile-data setting. */
function needsWork(e: LocalEntry, s: State, now: number): boolean {
  if (e.error || e.liveUploading || (e.nextAttemptAt ?? 0) > now) return false;
  if (!e.previewsUploaded && e.thumbFile && e.previewFile) return true; // includes backfill for old items
  if (e.editDirty && e.previewsUploaded && e.thumbFile && e.previewFile) return true;
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
/** Uploads stopped because free guest storage is full (signing in lifts the limit). */
export const selectGuestFull = (s: State) => s.entries.some((e) => !e.uploadedAt && e.errorCode === 'guest-quota');

let usageMemo: { entries: LocalEntry[]; out: ReturnType<typeof computeLocalUsage> } | null = null;

export function selectLocalUsage(s: State) {
  if (usageMemo?.entries !== s.entries) usageMemo = { entries: s.entries, out: computeLocalUsage(s) };
  return usageMemo.out;
}

function computeLocalUsage(s: State) {
  let count = 0;
  let bytes = 0;
  let freeable = 0;
  let freeableCount = 0;
  let offloaded = 0;
  for (const e of s.entries) {
    if (e.offloadedAt) {
      offloaded += 1;
      continue;
    }
    count += 1;
    bytes += e.size;
    if (e.uploadedAt) {
      freeable += e.size;
      freeableCount += 1;
    }
  }
  /** count/bytes: originals on this phone · offloaded: only the preview is here. */
  return { count, bytes, freeable, freeableCount, offloaded };
}

/**
 * Phone is nearly full and the guardian can't help: everything left on the
 * phone is still waiting to upload. Returns how many items are waiting.
 */
export function selectStorageStuck(s: State): number {
  if (s.freeBytes === null || s.freeBytes >= CRITICAL_FREE_BYTES) return 0;
  if (s.entries.some((e) => e.uploadedAt && !e.offloadedAt)) return 0;
  return s.entries.filter((e) => !e.uploadedAt).length;
}

// ---------- Boot ----------

let booted = false;

export async function boot() {
  if (booted) return;
  booted = true;

  const settings = loadPrefs(DEFAULT_SETTINGS);
  set({ settings, entries: loadEntries(), remote: loadRemoteCache(), signedOut: !isWeb && loadDoc('signed-out', false) });
  clearChunkFiles();

  const identity = await loadIdentity();
  if (identity) applyIdentity(identity);

  if (isWeb) {
    set({ status: identity ? 'ready' : 'needs-link' });
    watchWebSync();
  } else {
    // The camera works offline; the identity is created on first connectivity.
    set({ status: 'ready' });
    watchConnectivity();
  }

  runCleanup();
  if (!isWeb) setTimeout(checkImportLinks, 3000);
  if (!isWeb) void registerBackgroundBackup();
  if (!isWeb) watchThermal();
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

/**
 * Website: stay in sync automatically. Changes made on phones (new shots,
 * edits, deletes, shares) appear without reloading: every 30 s while the tab
 * is visible, and right away when you come back to the tab.
 */
const WEB_SYNC_MS = 30_000;
function watchWebSync() {
  if (typeof document === 'undefined') return;
  const sync = () => {
    if (!state.identity || document.hidden) return;
    refreshRemote();
    refreshShared();
  };
  setInterval(sync, WEB_SYNC_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) sync();
  });
  globalThis.addEventListener?.('online', sync);
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
  // Connected storage health while the app is open (sign-in, space).
  setInterval(() => {
    if (AppState.currentState === 'active') void checkStorages();
  }, 5 * 60 * 1000);
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    runCleanup();
    kickSync();
    void checkStorages();
    if (Date.now() - state.remoteFetchedAt > REMOTE_STALE_MS) {
      refreshRemote();
      refreshShared();
    }
  });
}

// ---------- Background run (OS-scheduled) ----------

/** Called by the periodic background task: upload for up to `ms`, then return. */
export async function runBackgroundSync(ms: number) {
  await boot();
  const deadline = Date.now() + ms;
  kickSync();
  // Wait while the loop works; give up at the deadline (the OS will call again).
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const now = Date.now();
    if (!syncing && !state.entries.some((e) => needsWork(e, state, now))) return;
  }
}

// ---------- Heat guard ----------

/** Hot or worse: heavy background work (uploads, preview-making) waits. */
export const isHot = (level: ThermalLevel) => level === 'hot' || level === 'critical';

function watchThermal() {
  set({ thermal: thermalLevel() });
  onThermalChange((level) => {
    const wasHot = isHot(state.thermal);
    set({ thermal: level });
    if (wasHot && !isHot(level)) void backfillDerivatives(); // cooled down: catch up (also restarts uploads)
  });
}

// ---------- Identity ----------

function applyIdentity(identity: Identity | null) {
  setAuth(identity?.token ?? null, handleUnauthorized);
  set({ identity });
}

async function handleUnauthorized() {
  // The token is no longer valid (session revoked or expired). A signed-in
  // account waits for the user to sign in again; a guest just starts over.
  const hadAccount = !!state.identity?.email;
  if (!isWeb && hadAccount) setSignedOut(true);
  await saveIdentity(null);
  applyIdentity(null);
  saveRemoteCache([]);
  set({ remote: [], shared: [], trash: [], storage: null, usage: null, ...(isWeb ? { status: 'needs-link' as const } : {}) });
}

let identityInflight: Promise<boolean> | null = null;

/** Native: make sure this device has a cloud identity (registers on first use). */
function ensureCloudIdentity(): Promise<boolean> {
  if (state.identity) return Promise.resolve(true);
  if (isWeb || state.signedOut) return Promise.resolve(false);
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

// ---------- Accounts (sign in / out) ----------

/** Persisted so a restart while signed out doesn't quietly start a new guest. */
function setSignedOut(value: boolean) {
  set({ signedOut: value });
  saveDoc('signed-out', value);
}

/** Identity to call the sign-in API with (a fresh guest if this phone was signed out). */
async function sessionForSignIn() {
  if (state.identity) return;
  const guest = await ensureIdentity();
  applyIdentity(guest);
}

/** Applies a sign-in: same identity (now an account) or a switch to an existing account. */
async function applySignIn(first: SignInResult) {
  let result = first;
  // Big guest libraries move in rounds.
  while (result.pending && result.resume) result = await api.authContinue(result.resume, deviceLabel());
  const before = state.identity;
  const identity: Identity = { id: result.id, name: result.name, email: result.email, token: result.token ?? before!.token };
  await saveIdentity(identity);
  applyIdentity(identity);
  setSignedOut(false);
  retryFailed(); // e.g. uploads that stopped at the guest storage limit
  if (identity.id !== before?.id) {
    saveRemoteCache([]);
    set({ remote: [], shared: [], trash: [], storage: null });
  }
  void refreshRemote();
  void refreshShared();
  kickSync();
}

export async function sendSignInCode(email: string) {
  await sessionForSignIn();
  await api.authEmailStart(email);
}

export async function signInWithCode(email: string, code: string) {
  await sessionForSignIn();
  await applySignIn(await api.authEmailVerify(email, code, deviceLabel()));
}

export async function signInWithGoogle() {
  await sessionForSignIn();
  const { code, state: oauthState, verifier } = await authorizeInBrowser('google');
  await applySignIn(await api.authGoogle({ code, state: oauthState, codeVerifier: verifier, device: deviceLabel() }));
}

/**
 * Logs this phone out. Only when everything is uploaded: the local copies are
 * then removed (they're safe in the cloud) and the phone starts a fresh guest.
 */
export async function logOut() {
  const waiting = state.entries.filter((e) => !e.uploadedAt).length;
  if (waiting) throw new Error(`${waiting} item${waiting === 1 ? ' is' : 's are'} still uploading. Wait until everything is in the cloud.`);
  await api.revokeSession('current').catch(() => {});
  state.entries.forEach(deleteFileFor);
  setEntries([]);
  await saveIdentity(null);
  applyIdentity(null);
  saveRemoteCache([]);
  set({ remote: [], shared: [], trash: [], storage: null, usage: null });
  setSignedOut(false);
  void ensureCloudIdentity();
}

/**
 * Deletes the account: everything in the cloud (the server finishes in the
 * background) and Lens's own copies on this phone. Afterwards the phone starts
 * as a new, empty guest; the website goes back to the home page.
 */
export async function deleteAccount() {
  await api.deleteAccount();
  if (!isWeb) {
    state.entries.forEach(deleteFileFor);
    setEntries([]);
  }
  await saveIdentity(null);
  applyIdentity(null);
  saveRemoteCache([]);
  set({ remote: [], shared: [], trash: [], storage: null, usage: null });
  if (isWeb) return;
  setSignedOut(false);
  void ensureCloudIdentity();
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
  // Ends the session on the server and clears the HttpOnly cookie.
  await api.signOutThisBrowser().catch(() => undefined);
  await saveIdentity(null);
  applyIdentity(null);
  set({ status: 'needs-link', remote: [], shared: [], trash: [], storage: null, usage: null });
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
      void refreshStorage();
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
  // Previews are made right away unless the phone is hot (then after it cools).
  if (!isHot(state.thermal)) void ensureDerivatives(entry).finally(kickSync);
  guardSpace(); // make room for the next shot if the phone is filling up
  return entry;
}

/** Older captures (before previews existed): make their previews one at a time. */
async function backfillDerivatives() {
  for (const entry of state.entries) {
    if (isHot(state.thermal)) return; // resumes when the phone cools
    if ((entry.thumbFile && entry.previewFile) || entry.offloadedAt || entry.awaitingCopy) continue;
    await ensureDerivatives(entry);
  }
  kickSync();
}

/** Makes thumbnail + preview if missing. Failure is non-fatal: the original still uploads. */
async function ensureDerivatives(entry: LocalEntry): Promise<LocalEntry> {
  if ((entry.thumbFile && entry.previewFile) || entry.offloadedAt || entry.awaitingCopy) return entry;
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
  // Signed out of an account: hold uploads until the user signs back in.
  if (!syncing && !isWeb && !state.signedOut) void syncLoop();
}

/**
 * Android background backup: while originals are uploading, a foreground
 * service ("Backing up 3 of 12") keeps the app running when you leave it or
 * turn the screen off. Started only while the app is visible (Android rule).
 */
const backup = {
  active: false,
  total: 0,
  done: 0,
  lastUpdate: 0,
  begin(pending: number) {
    if (this.active || Platform.OS !== 'android') return;
    this.total = pending;
    this.done = 0;
    this.active = backupService.start(backupText(1, pending));
    if (this.active) void askNotificationPermission();
  },
  progress(fraction: number) {
    if (!this.active || Date.now() - this.lastUpdate < 1000) return;
    this.lastUpdate = Date.now();
    backupService.update(backupText(this.done + 1, this.total), fraction * 100);
  },
  itemDone() {
    this.done += 1;
  },
  end() {
    if (!this.active) return;
    backupService.stop();
    this.active = false;
  },
};

function backupText(n: number, total: number) {
  return total > 1 ? `Backing up ${Math.min(n, total)} of ${total}` : 'Backing up 1 item';
}

/** Android 13+: the backup notification needs permission (asked once). */
async function askNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33 || loadDoc('asked-notifications', false)) return;
  saveDoc('asked-notifications', true);
  await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as never).catch(() => {});
}

async function syncLoop() {
  syncing = true;
  try {
    // Hot phone: stop after the current item; the thermal listener restarts us.
    while (state.online && !isHot(state.thermal)) {
      const now = Date.now();
      // Newest first, so the shot you just took reaches the cloud first.
      const next = state.entries.find((e) => needsWork(e, state, now));
      if (!next) break;
      // Real uploads (not just a small edit push): keep running in the background.
      if (!next.uploadedAt) backup.begin(state.entries.filter((e) => !e.uploadedAt && !e.error).length);
      if (!(await ensureCloudIdentity())) {
        updateEntry(next.id, { nextAttemptAt: Date.now() + BACKOFF_MS[2] });
        break;
      }

      set({ uploadingId: next.id, progress: 0 });
      let lastEmit = 0;
      try {
        if (next.editDirty && next.previewsUploaded && next.thumbFile && next.previewFile) {
          const media = await pushEdit(next.id, next.edit ?? null, {
            thumb: captureFile(next.thumbFile),
            preview: captureFile(next.previewFile),
          });
          updateEntry(next.id, { editDirty: false, attempts: 0, nextAttemptAt: undefined });
          upsertRemote(media);
          continue;
        }
        // Imported from the phone gallery: copy it now (one at a time, only with room to spare).
        if (next.awaitingCopy && !(await copyImport(next))) continue;
        const entry = await ensureDerivatives(state.entries.find((e) => e.id === next.id) ?? next);
        // Their own storage first (if connected, signed in on this phone and healthy), else Lens.
        const location = entry.uploadedAt ? undefined : await chooseDestination(state.storage?.storages, entry);
        const result = await uploadEntry(entry, {
          location,
          uploadExternal: async (loc, source, e, onBytes) => {
            const { connector, auth } = await authForLocation(loc);
            return connector.upload(auth, {
              file: source,
              name: storageFileName(e),
              contentType: e.contentType,
              size: e.size,
              md5Hex: () => {
                const md5 = source.md5;
                if (!md5) throw new Error('Could not checksum the file');
                return md5;
              },
              onProgress: onBytes,
              isCancelled: () => cancelled.has(e.id),
              resume: e.externalUpload?.storageId === loc.storageId ? e.externalUpload.resume : undefined,
              saveResume: (resume) => updateEntry(e.id, { externalUpload: { storageId: loc.storageId, resume } }),
            });
          },
          onProgress: (p) => {
            const t = Date.now();
            if (t - lastEmit > 150 || p >= 1) {
              lastEmit = t;
              set({ progress: p });
            }
            if (entry.size > 0) setTransfer(next.id, Math.round(p * entry.size), entry.size);
            backup.progress(p);
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
          externalUpload: undefined,
        });
        upsertRemote(result.media);
        if (result.originalDone) {
          backup.itemDone();
          // Imports: the original is still in their phone gallery; drop our copy right away.
          if (entry.importUri) offloadOriginals(state.entries.filter((e) => e.id === next.id), 'imported');
          guardSpace(); // this original may now be offloaded
        }
      } catch (error) {
        if (error instanceof UploadCancelled) continue;
        if (error instanceof FileTooLarge) {
          updateEntry(next.id, { forceLens: true, externalUpload: undefined }); // just this file → Lens storage
          continue;
        }
        if (error instanceof StorageFull || error instanceof SignedOut) {
          // Their storage can't take it: mark it, and the next pass sends this item to Lens storage.
          await markStorage(error instanceof StorageFull ? 'full' : 'signed-out');
          continue;
        }
        const attempts = (next.attempts ?? 0) + 1;
        if (error instanceof ApiError && error.permanent) {
          updateEntry(next.id, { attempts, error: error.message, errorCode: error.code });
        } else {
          updateEntry(next.id, {
            attempts,
            nextAttemptAt: Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)],
          });
        }
        if (error instanceof ApiError && error.status === 0) break; // offline; NetInfo will wake us
      } finally {
        set({ uploadingId: null, progress: 0 });
        clearTransfer(next.id);
      }
    }
  } finally {
    syncing = false;
    backup.end();
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
    state.entries.map((e) =>
      e.error && !e.uploadedAt ? { ...e, error: undefined, errorCode: undefined, attempts: 0, nextAttemptAt: undefined } : e,
    ),
  );
  kickSync();
}

// ---------- Edits (non-destructive) ----------

function deleteDerivativeFiles(names: (string | undefined)[], keep: (string | undefined)[]) {
  for (const name of names) {
    if (!name || keep.includes(name)) continue;
    const file = captureFile(name);
    if (file.exists) file.delete();
  }
}

/**
 * Saves a look/edit for an item. The original is untouched: we store the
 * recipe, re-render this device's thumbnail + preview, and push the new look
 * to the cloud (immediately if online, otherwise later via the sync loop).
 */
export async function saveEdit(id: string, recipe: EditRecipe | null): Promise<void> {
  const edit = recipe ? (compact(recipe) ?? undefined) : undefined;
  const entry = state.entries.find((e) => e.id === id);

  if (entry && !entry.offloadedAt) {
    const files = await makeDerivatives({ ...entry, edit });
    deleteDerivativeFiles([entry.thumbFile, entry.previewFile], [files.thumbFile, files.previewFile]);
    updateEntry(id, { ...files, edit, editDirty: !!entry.previewsUploaded });
    kickSync();
    return;
  }
  if (entry?.kind === 'video') {
    throw new Error('Video looks can be changed only while the video is still on this phone.');
  }

  // Cloud-only or offloaded item: render from the cloud original.
  const remote = state.remote.find((r) => r.id === id);
  if (!remote?.url && !remote?.location?.ref) throw new Error('The original is still uploading. Try again when it has finished.');
  const files = await renderCloudDerivatives(remote, edit ?? null);
  let kept = false;
  try {
    const media = await pushEdit(id, edit ?? null, files);
    upsertRemote(media);
    if (entry) {
      // Offloaded: keep this phone's previews in step with the new look.
      const stamp = Date.now().toString(36);
      const thumbFile = `${id}.thumb.${stamp}.jpg`;
      const previewFile = `${id}.preview.${stamp}.jpg`;
      files.thumb.moveSync(captureFile(thumbFile));
      files.preview.moveSync(captureFile(previewFile));
      kept = true;
      deleteDerivativeFiles([entry.thumbFile, entry.previewFile], [thumbFile, previewFile]);
      updateEntry(id, { thumbFile, previewFile, edit, editDirty: false });
    }
  } finally {
    // moveSync re-points the File objects, so only clean up temp renders we didn't keep.
    if (!kept) {
      if (files.thumb.exists) files.thumb.delete();
      if (files.preview.exists) files.preview.delete();
    }
  }
}

export function copyEdit(recipe: EditRecipe | undefined) {
  set({ copiedEdit: recipe ? forPaste(recipe) : null });
}

/** Applies the copied look/adjustments to several items (keeps each one's crop). */
export async function pasteEdit(ids: string[]): Promise<number> {
  const copied = state.copiedEdit;
  if (!copied) return 0;
  let done = 0;
  for (const id of ids) {
    const item = selectGallery(state).find((g) => g.id === id);
    if (!item) continue;
    try {
      await saveEdit(id, { ...copied, crop: item.edit?.crop, portrait: item.edit?.portrait });
      done++;
    } catch {
      // Skip items that can't be edited right now.
    }
  }
  return done;
}

// ---------- Delete / cleanup ----------

/** Items whose original isn't in the cloud yet: deleting them can't be undone. */
export function selectUnsafeToDelete(s: State, ids: string[]): number {
  return ids.filter((id) => {
    const entry = s.entries.find((e) => e.id === id);
    const remote = s.remote.find((r) => r.id === id);
    return !entry?.uploadedAt && !remote?.originalReady;
  }).length;
}

/**
 * Deletes items from this device and moves them to the cloud Trash (30 days,
 * then the Archive). Items whose original never finished uploading are deleted
 * outright. Shared items need a `scope`; without one they're returned in
 * `needsScope` untouched so the UI can ask "for everyone" or "only for me".
 */
export async function deleteItems(
  ids: string[],
  scope?: DeleteScope,
): Promise<{ failed: string[]; needsScope: string[] }> {
  const failed: string[] = [];
  const needsScope: string[] = [];
  for (const id of ids) {
    const entry = state.entries.find((e) => e.id === id);
    const cloud = state.remote.find((r) => r.id === id);
    const inCloud = !!cloud;
    const touchedServer = inCloud || !!entry?.uploadedAt || !!entry?.attempts || state.uploadingId === id;

    if (touchedServer) {
      try {
        await api.deleteMedia(id, scope);
        // Original in their storage: their trash keeps it ~30 days ("only for me" leaves it for recipients).
        if (scope !== 'me') void storageAction(cloud?.location, 'trash').catch(() => {});
      } catch (error) {
        if (error instanceof ApiError && error.code === 'shared') {
          needsScope.push(id);
          continue;
        }
        if (!(error instanceof ApiError && error.status === 404)) {
          failed.push(id);
          continue;
        }
      }
    }
    if (state.uploadingId === id) cancelled.add(id);
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
  if (failed.length + needsScope.length < ids.length) {
    api.me().then((me) => set({ usage: me })).catch(() => {});
    void refreshTrash();
  }
  return { failed, needsScope };
}

// ---------- Import from the phone gallery (Android) ----------

/** Copies need this much free space left over, so the phone never fills up. */
const IMPORT_MARGIN = 500 * 1024 * 1024;
const IMPORT_SPACE_RETRY_MS = 10 * 60 * 1000;

export const canImport = !isWeb && !!mediaPicker;

/**
 * The user picks photos/videos from their gallery (Android's picker: no
 * permission, only what they choose). Nothing is copied now: each item is
 * copied just before its upload and the copy removed once it's in the cloud.
 * Returns how many were added and how many were already in Lens.
 */
export async function importFromGallery(): Promise<{ added: number; skipped: number }> {
  if (!mediaPicker) return { added: 0, skipped: 0 };
  const picked = await mediaPicker.pick(100);
  const known = new Set(state.entries.map((e) => e.importUri).filter(Boolean));
  const fresh = picked.filter((p) => !known.has(p.uri));
  if (fresh.length) {
    const added = fresh.map(importEntry);
    setEntries([...added, ...state.entries].sort((a, b) => b.createdAt - a.createdAt));
    kickSync();
  }
  return { added: fresh.length, skipped: picked.length - fresh.length };
}

/** Copy an imported item into Lens just before upload. False = not now (no room) or failed. */
async function copyImport(entry: LocalEntry): Promise<boolean> {
  if (!mediaPicker || !entry.importUri) {
    updateEntry(entry.id, { error: 'This item can’t be read on this phone', awaitingCopy: false });
    return false;
  }
  const free = freeDiskBytes();
  if (free !== null && free - entry.size < IMPORT_MARGIN) {
    // Room frees up as other items finish uploading (their copies are removed); try again later.
    updateEntry(entry.id, { nextAttemptAt: Date.now() + IMPORT_SPACE_RETRY_MS });
    set({ importWaitingForSpace: true });
    return false;
  }
  set({ importWaitingForSpace: false });
  try {
    const size = await mediaPicker.copy(entry.importUri, captureFile(entry.fileName).uri);
    updateEntry(entry.id, { awaitingCopy: undefined, size });
    return true;
  } catch {
    const gone = !mediaPicker.canRead(entry.importUri);
    updateEntry(entry.id, {
      ...(gone
        ? { error: 'No longer in your phone gallery (deleted, or access ended). Import it again.', errorCode: 'import-gone' }
        : { attempts: (entry.attempts ?? 0) + 1, nextAttemptAt: Date.now() + BACKOFF_MS[1] }),
    });
    return false;
  }
}

/** After a restart: forget gallery links that no longer open (the cloud copy stays). */
function checkImportLinks() {
  if (!mediaPicker) return;
  for (const e of state.entries) {
    if (!e.importUri || e.awaitingCopy || !e.offloadedAt) continue;
    if (!mediaPicker.canRead(e.importUri)) updateEntry(e.id, { importUri: undefined });
  }
}

// ---------- Upload while recording ----------

const liveAllowedNow = (s: State) =>
  s.online && !isHot(s.thermal) && s.settings.liveUpload !== 'off' && (!s.cellular || s.settings.liveUpload === 'all');

/**
 * Starts uploading a video while it records, if allowed: Android, signed-in
 * or guest session present, Lens storage as destination (own storages get the
 * file after recording), network policy and heat permitting.
 */
export function startLiveUpload(id: string): LiveUpload | null {
  if (isWeb || !LiveUpload.supported || !state.identity || state.signedOut || !liveAllowedNow(state)) return null;
  const own = state.storage?.storages[0];
  if (own && own.status !== 'full' && own.status !== 'signed-out') return null;
  return new LiveUpload(id, {
    canSend: () => liveAllowedNow(state),
    onProgress: (sent, total, recording) => setTransfer(id, sent, total, recording),
    onCancel: () => clearTransfer(id),
  });
}

/** Why a recording won't upload while it records (shown in the camera), or null if it will. */
export function liveUploadBlocker(s: State = state): string | null {
  if (isWeb || !LiveUpload.supported) return 'Uploads after you stop';
  if (s.settings.liveUpload === 'off') return 'Uploads after you stop';
  if (!s.online) return 'Offline: uploads later';
  if (isHot(s.thermal)) return 'Phone hot: uploads later';
  if (s.cellular && s.settings.liveUpload !== 'all') return 'Mobile data: uploads after you stop';
  return null;
}

/** Recording saved as `entry`: finish the live upload, or hand over to the regular uploader. */
export async function finishLiveUpload(live: LiveUpload, entry: LocalEntry) {
  const media = await live.finish(captureFile(entry.fileName)).finally(() => clearTransfer(entry.id));
  if (media) {
    updateEntry(entry.id, { liveUploading: false, uploadedAt: Date.now(), attempts: 0, error: undefined });
    upsertRemote(media);
    guardSpace();
  } else {
    updateEntry(entry.id, { liveUploading: false });
  }
  kickSync(); // previews (and the original, if the live upload didn't finish)
}

export function setLiveUpload(policy: LiveUploadPolicy) {
  const settings = { ...state.settings, liveUpload: policy };
  savePrefs(settings);
  set({ settings });
}

// ---------- Storage (Lens + connected) ----------

/** "Lens 2026-10-08 14.30.05 <id>.heic": readable and unique in their storage. */
function storageFileName(e: LocalEntry): string {
  const d = new Date(e.createdAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const ext = e.fileName.split('.').pop() ?? 'bin';
  return `Lens ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())} ${e.id.slice(-8)}.${ext}`;
}

function replaceStorage(updated: ConnectedStorage) {
  if (!state.storage) return;
  set({ storage: { ...state.storage, storages: state.storage.storages.map((s) => (s.id === updated.id ? updated : s)) } });
}

/** Marks the connected storage full / signed out (reported to Lens so other devices see it). */
async function markStorage(status: 'full' | 'signed-out') {
  const own = state.storage?.storages[0];
  if (!own) return;
  replaceStorage({ ...own, status });
  await api
    .putStorage(own.id, { provider: own.provider, label: own.label, account: own.account, status })
    .then(({ storage }) => replaceStorage(storage))
    .catch(() => {});
}

let lastStorageCheck = 0;
const STORAGE_CHECK_MS = 30 * 60 * 1000;

/** Health check of connected storages (space, sign-in); at most every 30 minutes unless forced. */
export async function checkStorages(force = false): Promise<void> {
  if (isWeb || !state.storage?.storages.length) return;
  if (!force && Date.now() - lastStorageCheck < STORAGE_CHECK_MS) return;
  lastStorageCheck = Date.now();
  for (const s of state.storage.storages) {
    const updated = await checkStorage(s).catch(() => null);
    if (updated) replaceStorage(updated);
  }
  kickSync(); // e.g. storage freed up again
}

export function refreshStorage(): Promise<void> {
  if (!state.identity) return Promise.resolve();
  return api
    .storage()
    .then((storage) => {
      set({ storage, usage: { usedBytes: storage.lens.usedBytes, quotaBytes: storage.lens.quotaBytes } });
      void checkStorages();
    })
    .catch(() => {});
}

export async function requestProvider(provider: string, note?: string): Promise<void> {
  await api.requestProvider(provider, note);
}

export type StorageIndicator = {
  /** Where new shots go. */
  target: 'lens' | ProviderId;
  label: string;
  /** ok · low (warning) · attention (full / signed out / error). */
  level: 'ok' | 'low' | 'attention';
  detail: string;
};

let indicatorMemo: { storage: StorageOverview | null; usage: State['usage']; out: StorageIndicator | null } | null = null;

/** What the gallery's storage pill shows. */
export function selectStorageIndicator(s: State): StorageIndicator | null {
  if (indicatorMemo && indicatorMemo.storage === s.storage && indicatorMemo.usage === s.usage) return indicatorMemo.out;
  const out = computeIndicator(s);
  indicatorMemo = { storage: s.storage, usage: s.usage, out };
  return out;
}

function computeIndicator(s: State): StorageIndicator | null {
  const own = s.storage?.storages[0];
  if (own) {
    const level = own.status === 'ok' ? 'ok' : own.status === 'low' ? 'low' : 'attention';
    const detail =
      own.status === 'signed-out'
        ? 'Sign in again'
        : own.status === 'full'
          ? 'Full: using Lens storage'
          : own.status === 'error'
            ? 'Can’t reach it'
            : own.totalBytes
              ? `${formatGB(own.usedBytes ?? 0)} of ${formatGB(own.totalBytes)}`
              : 'Connected';
    return { target: own.provider, label: own.label, level, detail };
  }
  const usage = s.usage;
  if (!usage) return null;
  const ratio = usage.usedBytes / usage.quotaBytes;
  return {
    target: 'lens',
    label: 'Lens',
    level: ratio >= 1 ? 'attention' : ratio >= 0.9 ? 'low' : 'ok',
    detail: `${formatGB(usage.usedBytes)} of ${formatGB(usage.quotaBytes)}`,
  };
}

function formatGB(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 10 || gb === 0 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

// ---------- Trash & Archive ----------

let trashInflight: Promise<void> | null = null;

export function refreshTrash(): Promise<void> {
  if (!state.identity) return Promise.resolve();
  trashInflight ??= (async () => {
    set({ trashLoading: true });
    try {
      const all: TrashItem[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const result = await api.trash(cursor);
        all.push(...result.items);
        cursor = result.cursor;
        if (!cursor) break;
      }
      set({ trash: all });
    } catch {
      // Keep the previous list.
    } finally {
      set({ trashLoading: false });
      trashInflight = null;
    }
  })();
  return trashInflight;
}

/** Trash: back in the library now. Archive: recovery started (~12 hours). */
export async function restoreItem(id: string): Promise<'restored' | 'recovering'> {
  const result = await api.restore(id);
  void storageAction(state.trash.find((t) => t.id === id)?.location, 'untrash').catch(() => {});
  if (result.phase === 'restored') {
    set({ trash: state.trash.filter((t) => t.id !== id) });
    upsertRemote(result.media);
  } else {
    set({ trash: state.trash.map((t) => (t.id === id ? result.item : t)) });
  }
  api.me().then((me) => set({ usage: me })).catch(() => {});
  return result.phase;
}

/** Gone everywhere, every copy. Cannot be undone. */
export async function deleteForever(id: string): Promise<void> {
  await storageAction(state.trash.find((t) => t.id === id)?.location, 'remove').catch(() => {});
  await api.deleteForever(id);
  set({ trash: state.trash.filter((t) => t.id !== id) });
  api.me().then((me) => set({ usage: me })).catch(() => {});
}

export async function removeSharedItem(item: GalleryItem) {
  if (!item.ownerId) return;
  await api.removeShared(item.ownerId, item.id);
  set({ shared: state.shared.filter((s) => !(s.id === item.id && s.ownerId === item.ownerId)) });
}

type Freed = { count: number; bytes: number };

/** Originals that may be removed from this phone: verified in the cloud, still here. */
const offloadable = (e: LocalEntry) => !!e.uploadedAt && !e.offloadedAt;

/**
 * Removes local originals that are confirmed in the cloud, keeping their
 * thumbnail + preview so the gallery still shows them (even offline). Items
 * without local previews are removed entirely; the cloud listing covers them.
 */
function offloadOriginals(drop: LocalEntry[], reason: OffloadReason): Freed {
  drop = drop.filter(offloadable);
  if (!drop.length) return { count: 0, bytes: 0 };
  let bytes = 0;
  const now = Date.now();
  const patched = new Map<string, LocalEntry | null>();
  for (const e of drop) {
    if (e.thumbFile || e.previewFile) {
      bytes += deleteOriginal(e);
      patched.set(e.id, { ...e, offloadedAt: now, offloadReason: reason });
    } else {
      bytes += e.size;
      deleteFileFor(e);
      patched.set(e.id, null);
    }
  }
  setEntries(
    state.entries.flatMap((e) => {
      const p = patched.get(e.id);
      return p === undefined ? [e] : p ? [p] : [];
    }),
  );
  return { count: drop.length, bytes };
}

/** Shots from the last day keep their original unless the phone is nearly full. */
const RECENT_MS = DAY;
/** Below this, recording/capturing could fail: recent originals may go too. */
const CRITICAL_FREE = GB;

/**
 * Storage guardian: if the phone has less free space than the setting, first
 * drop re-downloadable cache files, then offload the oldest originals that are
 * safe in the cloud until there's enough room. Shots from the last 24 h are
 * kept unless the phone is nearly full (under 1 GB). Never touches anything
 * that isn't verified in the cloud. Tells the gallery what it freed.
 */
export function guardSpace(): Freed {
  if (isWeb) return { count: 0, bytes: 0 };
  const free = freeDiskBytes();
  set({ freeBytes: free });
  const target = state.settings.keepFreeGB * GB;
  if (free === null || !target || free >= target) return { count: 0, bytes: 0 };

  let need = target - free;
  const cacheBytes = clearDownloadCache();
  need -= cacheBytes;
  const drop: LocalEntry[] = [];
  if (need > 0) {
    const now = Date.now();
    const oldestFirst = state.entries.filter(offloadable).sort((a, b) => a.createdAt - b.createdAt);
    const older = oldestFirst.filter((e) => now - e.createdAt >= RECENT_MS);
    const recent = oldestFirst.filter((e) => now - e.createdAt < RECENT_MS);
    for (const e of older) {
      if (need <= 0) break;
      drop.push(e);
      need -= e.size;
    }
    // Still short and nearly full: recent shots too (oldest first), only as much as gets back to 1 GB.
    let critical = CRITICAL_FREE - (target - need);
    for (const e of recent) {
      if (critical <= 0) break;
      drop.push(e);
      critical -= e.size;
    }
  }
  const result = offloadOriginals(drop, 'space');
  if (result.count || cacheBytes) set({ freeBytes: freeDiskBytes() });
  if (result.count) {
    set({ spaceFreed: { count: result.count, bytes: result.bytes, keepFreeGB: state.settings.keepFreeGB, at: Date.now() } });
  }
  return { count: result.count, bytes: result.bytes + cacheBytes };
}

export function dismissSpaceFreed() {
  set({ spaceFreed: null });
}

/** Offloads originals older than the retention window, then checks free space. */
export function runCleanup(): Freed {
  const days = state.settings.retentionDays;
  let byAge: Freed = { count: 0, bytes: 0 };
  if (days >= 0) {
    const cutoff = Date.now() - days * DAY;
    byAge = offloadOriginals(state.entries.filter((e) => offloadable(e) && e.uploadedAt! < cutoff), 'age');
  }
  const bySpace = guardSpace();
  return { count: byAge.count + bySpace.count, bytes: byAge.bytes + bySpace.bytes };
}

/** Removes every local original that is already safe in the cloud (previews stay). */
export function freeUpSpace(): Freed {
  const cacheBytes = clearDownloadCache();
  const result = offloadOriginals(state.entries, 'manual');
  set({ freeBytes: freeDiskBytes() });
  return { count: result.count, bytes: result.bytes + cacheBytes };
}

export function setRetention(days: number) {
  const settings = { ...state.settings, retentionDays: days };
  savePrefs(settings);
  set({ settings });
  runCleanup();
}

export function setKeepFree(gb: number) {
  const settings = { ...state.settings, keepFreeGB: gb };
  savePrefs(settings);
  set({ settings });
  guardSpace();
}

export function setCellularUploads(policy: CellularPolicy) {
  const settings = { ...state.settings, cellularUploads: policy };
  savePrefs(settings);
  set({ settings });
  kickSync();
}
