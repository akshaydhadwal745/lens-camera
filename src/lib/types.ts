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
  /** Set once the cloud copy is confirmed; local copy becomes eligible for cleanup. */
  uploadedAt?: number;
  /**
   * The original was removed from this device to save space (it's verified in
   * the cloud). Thumbnail + preview stay so the gallery still works offline.
   */
  offloadedAt?: number;
  attempts?: number;
  nextAttemptAt?: number;
  /** Permanent failure (won't retry automatically). */
  error?: string;
}

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
  thumbUri?: string;
  previewUri?: string;
  sync: SyncState;
  error?: string;
  edit?: EditRecipe;
  /** Present for items shared with me. */
  ownerId?: string;
  ownerName?: string;
}

export interface NewCapture {
  kind: MediaKind;
  sourceUri: string;
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
