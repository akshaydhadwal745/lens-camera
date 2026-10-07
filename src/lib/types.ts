export type MediaKind = 'photo' | 'video';

/** Media stored in the cloud, as returned by the API (url is a signed CloudFront URL). */
export interface RemoteMedia {
  id: string;
  kind: MediaKind;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  createdAt: number;
  url: string;
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
  /** Set once the cloud copy is confirmed; local copy becomes eligible for cleanup. */
  uploadedAt?: number;
  attempts?: number;
  nextAttemptAt?: number;
  /** Permanent failure (won't retry automatically). */
  error?: string;
}

export type SyncState = 'queued' | 'uploading' | 'synced' | 'failed';

/** What the gallery renders: the union of local and cloud copies. */
export interface GalleryItem {
  id: string;
  kind: MediaKind;
  createdAt: number;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  localUri?: string;
  remoteUrl?: string;
  sync: SyncState;
  error?: string;
  /** Present for items shared with me. */
  ownerId?: string;
  ownerName?: string;
}

export interface NewCapture {
  kind: MediaKind;
  sourceUri: string;
  width?: number;
  height?: number;
  duration?: number;
}

export function displayUri(item: GalleryItem): string | undefined {
  return item.localUri ?? item.remoteUrl;
}

/** Time-sortable id: 8 base36 chars of the timestamp + random suffix. */
export function newId(): string {
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `${Date.now().toString(36).padStart(8, '0')}-${random}`;
}
