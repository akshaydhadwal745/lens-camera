import type { EditRecipe } from './edits';

export type MediaKind = 'photo' | 'video';

/** Media stored in the cloud, as returned by the API (URLs are signed CloudFront URLs). */
export interface RemoteMedia {
  id: string;
  kind: MediaKind;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: number;
  /** True once the full-quality original is uploaded and verified. */
  originalReady: boolean;
  /** Original (only when originalReady). */
  url?: string;
  /** ~400px JPEG for grids. */
  thumbUrl?: string;
  /** ~2048px JPEG for full-screen viewing (works in every browser, even for HEIC/RAW). */
  previewUrl?: string;
  /** Non-destructive edit (previews already show it). */
  edit?: EditRecipe;
  /** e.g. image/heic; absent on older shares. */
  contentType?: string;
  /** The original lives in the owner's own storage (no `url`); previews are in Lens. */
  location?: StorageLocation;
}

/** An original stored in a connected storage (Google Drive file id, Dropbox path…). */
export interface StorageLocation {
  storageId: string;
  provider: ProviderId;
  ref?: string;
}

/** Where originals can live besides Lens storage. */
export type ProviderId = 'gdrive' | 'dropbox' | 'onedrive' | 'box' | 's3' | 'webdav' | 'icloud';
export type StorageStatus = 'ok' | 'low' | 'full' | 'signed-out' | 'error';

/** A storage the user connected (health as last reported by their phone). */
export interface ConnectedStorage {
  id: string;
  provider: ProviderId;
  label: string;
  account?: string;
  status: StorageStatus;
  usedBytes?: number;
  totalBytes?: number;
  checkedAt: number;
  createdAt: number;
}

export interface StorageOverview {
  plan: 'free';
  /** Lens storage: newest `recentBytes` are "Recent", the rest "Saver" (all instant). Guests: 5 GB. */
  lens: { usedBytes: number; quotaBytes: number; recentBytes: number; signedInQuotaBytes: number };
  signedIn: boolean;
  storages: ConnectedStorage[];
  limits: { storages: number; routing: boolean };
}

/** Deleting a shared item: remove it for everyone, or only hide it from me. */
export type DeleteScope = 'everyone' | 'me';

/**
 * A deleted item. trash: restorable instantly until `trashUntil`. archive:
 * recoverable (takes ~12 hours) until `purgeAt`. recovering: on its way back.
 */
export interface TrashItem extends RemoteMedia {
  phase: 'trash' | 'archive' | 'recovering';
  deletedAt: number;
  trashUntil: number;
  purgeAt: number;
  recoveringSince?: number;
}

export interface SharedMedia extends RemoteMedia {
  ownerId: string;
  ownerName: string;
  sharedAt: number;
}

/** A capture kept on this device (native only). */
export interface LocalEntry {
  id: string;
  kind: MediaKind;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: number;
  width?: number;
  height?: number;
  duration?: number;
  /** Local derivative files (same directory as the original). */
  thumbFile?: string;
  previewFile?: string;
  /** Thumbnail + preview are in the cloud (item visible on other devices). */
  previewsUploaded?: boolean;
  /** Non-destructive edit; the original file is never modified. */
  edit?: EditRecipe;
  /** Edit changed after previews were uploaded: push the new look to the cloud. */
  editDirty?: boolean;
  /** Upload-while-recording is finishing this one; the regular uploader waits. */
  liveUploading?: boolean;
  /** Upload started while recording: existing parts are re-checked against the final file. */
  streamed?: boolean;
  /** Too big for their storage plan (e.g. Box free 250 MB): this one goes to Lens storage. */
  forceLens?: boolean;
  /**
   * Imported from the phone's gallery (Android picker): the content:// link to
   * the user's own file. Lens copies it just before uploading and removes its
   * copy once it's safe in the cloud; the gallery original is never touched.
   */
  importUri?: string;
  /** Imported but not copied yet (waits for its turn, and for free space). */
  awaitingCopy?: boolean;
  /** Resumable upload state in the user's own storage (e.g. a Drive session URL). */
  externalUpload?: { storageId: string; resume?: string };
  /** Set once the cloud copy is confirmed; local copy becomes eligible for cleanup. */
  uploadedAt?: number;
  /**
   * The original was removed from this device to save space (it's verified in
   * the cloud). Thumbnail + preview stay so the gallery still works offline.
   */
  offloadedAt?: number;
  /** Why it was removed: age (retention), space (phone low on space) or manual (Free up space). */
  offloadReason?: OffloadReason;
  attempts?: number;
  nextAttemptAt?: number;
  /** Permanent failure (won't retry automatically). */
  error?: string;
  /** Why, for the app: e.g. "guest-quota" (sign in to get more storage). */
  errorCode?: string;
}

export type OffloadReason = 'age' | 'space' | 'manual' | 'imported';

/**
 * queued: nothing in the cloud yet · uploading: transfer in progress ·
 * partial: thumbnail/preview in the cloud, original still on its way ·
 * synced: original verified in the cloud · failed: needs attention.
 */
export type SyncState = 'queued' | 'uploading' | 'partial' | 'synced' | 'failed';

/** What the gallery renders: the union of local and cloud copies. */
export interface GalleryItem {
  id: string;
  kind: MediaKind;
  createdAt: number;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  /** Local original (this device). */
  localUri?: string;
  /** Cloud original (only once verified). */
  remoteUrl?: string;
  /** This phone's original was removed (and why); it plays/opens from the cloud. */
  offloadReason?: OffloadReason;
  thumbUri?: string;
  previewUri?: string;
  sync: SyncState;
  error?: string;
  edit?: EditRecipe;
  /** Original in the user's own storage (opened through their provider). */
  location?: StorageLocation;
  contentType?: string;
  /** Present for items shared with me. */
  ownerId?: string;
  ownerName?: string;
}

export interface NewCapture {
  kind: MediaKind;
  sourceUri: string;
  /** Pre-assigned id (a video that started uploading while recording). */
  id?: string;
  /** Upload-while-recording is handling the original. */
  live?: boolean;
  /** Look chosen in the camera (non-destructive). */
  edit?: EditRecipe;
  width?: number;
  height?: number;
  duration?: number;
}

/** Small image for grids and thumbnails. */
export function displayUri(item: GalleryItem): string | undefined {
  return item.thumbUri ?? item.previewUri ?? (item.kind === 'photo' ? (item.localUri ?? item.remoteUrl) : undefined);
}

/** Screen-sized image: the local original if this device has it, else the preview. */
export function viewUri(item: GalleryItem): string | undefined {
  if (item.kind === 'photo' && item.localUri) return item.localUri;
  return item.previewUri ?? item.thumbUri ?? item.remoteUrl;
}

/** Time-sortable id: 8 base36 chars of the timestamp + random suffix. */
export function newId(): string {
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `${Date.now().toString(36).padStart(8, '0')}-${random}`;
}
