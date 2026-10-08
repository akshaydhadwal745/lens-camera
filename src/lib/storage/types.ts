// The contract every storage provider implements (Google Drive, Dropbox, …).
// Connectors run on the phone and talk to the provider directly; Lens only
// learns where the file ended up (`ref`) and that its checksum matched.
import type { File } from 'expo-file-system';

import type { ProviderId } from '../types';

/** The user deleted the item (or the upload was otherwise cancelled) mid-transfer. */
export class UploadCancelled extends Error {}

/** Their storage has no room left (new shots fall back to Lens storage). */
export class StorageFull extends Error {
  constructor(message = 'Your storage is full') {
    super(message);
  }
}

/** This one file is too big for their plan (e.g. Box free: 250 MB): it goes to Lens storage instead. */
export class FileTooLarge extends Error {}

/** Access was revoked or expired: the user has to sign in again. */
export class SignedOut extends Error {
  constructor(message = 'Signed out of your storage') {
    super(message);
  }
}

/** Space in their storage; totalBytes undefined = unlimited / unknown. */
export type Quota = { usedBytes?: number; totalBytes?: number };

/** How to fetch an original: a URL plus headers (e.g. Authorization). */
export type MediaSource = { uri: string; headers?: Record<string, string> };

/** Fresh access token + per-storage settings (e.g. the Lens folder id). */
export interface Auth {
  /** Key/password storages (S3, WebDAV): the saved credentials as JSON. */
  secret?: string;
  token(): Promise<string>;
  /** Forces a refresh (after a 401). */
  refresh(): Promise<string>;
  config: Record<string, string>;
  saveConfig(patch: Record<string, string>): Promise<void>;
}

export interface UploadJob {
  file: File;
  /** File name in their storage. */
  name: string;
  contentType: string;
  size: number;
  /** Lowercase hex MD5 of the whole file (native). */
  md5Hex: () => string;
  onProgress: (sentBytes: number) => void;
  isCancelled: () => boolean;
  /** Provider resume state from an earlier attempt (e.g. an upload session URL). */
  resume?: string;
  saveResume: (resume: string | undefined) => void;
}

export interface Connector {
  provider: ProviderId;
  /** Account shown in settings + current space. */
  account(auth: Auth): Promise<{ account: string; quota: Quota }>;
  quota(auth: Auth): Promise<Quota>;
  /** Uploads (resumably) and verifies the provider's checksum. */
  upload(auth: Auth, job: UploadJob): Promise<{ ref: string; checksum: string }>;
  source(auth: Auth, ref: string): Promise<MediaSource>;
  trash(auth: Auth, ref: string): Promise<void>;
  untrash(auth: Auth, ref: string): Promise<void>;
  remove(auth: Auth, ref: string): Promise<void>;
}

/** Below this much free space we warn ("almost full"). */
export const LOW_SPACE_BYTES = 1024 ** 3;

export function statusForQuota(q: Quota, upcomingBytes = 0): 'ok' | 'low' | 'full' {
  if (q.totalBytes === undefined || q.usedBytes === undefined) return 'ok';
  const free = q.totalBytes - q.usedBytes;
  if (free <= upcomingBytes || free <= 0) return 'full';
  return free < LOW_SPACE_BYTES ? 'low' : 'ok';
}
