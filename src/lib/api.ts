import type { EditRecipe } from './edits';
import { DeleteScope, RemoteMedia, SharedMedia, TrashItem } from './types';

export const API_URL = `${process.env.EXPO_PUBLIC_API_URL ?? ''}/v1`;
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine-readable reason from the server (e.g. "shared"). */
    public code?: string,
  ) {
    super(message);
  }
  /** Retrying won't help (bad input, quota, auth). */
  get permanent() {
    return this.status >= 400 && this.status < 500 && ![408, 409, 425, 429].includes(this.status);
  }
}

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuth(token: string | null, unauthorized?: () => void) {
  authToken = token;
  if (unauthorized) onUnauthorized = unauthorized;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && authToken) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  }
  return data as T;
}

export type IdentityResponse = { id: string; name: string; token: string };
type DerivativeUrls = { thumb?: string; preview?: string };
type PlanExtras = { derivativeUrls?: DerivativeUrls; previewReady?: boolean };
export type UploadPlan = PlanExtras &
  (
    | { mode: 'done'; media: RemoteMedia }
    | { mode: 'single'; url: string; contentType: string }
    | { mode: 'multipart'; uploadId: string; partSize: number }
  );
export type Person = { id: string; name: string };
export type Contact = Person & { lastSharedAt: number };
type Page<T> = { items: T[]; cursor: string | null };

const q = (cursor?: string | null) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');

export const api = {
  register: () => request<IdentityResponse>('POST', '/devices'),
  me: () => request<{ id: string; name: string; usedBytes: number; quotaBytes: number }>('GET', '/me'),

  listMedia: (cursor?: string | null) => request<Page<RemoteMedia>>('GET', `/media${q(cursor)}`),
  startUpload: (body: {
    /** Base64 MD5 of the whole file (single-PUT uploads); S3 verifies it. */
    md5?: string;
    /** Look/edit chosen at capture (non-destructive). */
    edit?: EditRecipe;
    /** Thumbnail + preview to upload first (base64 MD5 + bytes). */
    derivatives?: { thumb: { md5: string; size: number }; preview: { md5: string; size: number } };
    id: string;
    kind: string;
    contentType: string;
    size: number;
    width?: number;
    height?: number;
    duration?: number;
    createdAt: number;
  }) => request<UploadPlan>('POST', '/media', body),
  uploadedParts: (id: string) => request<{ parts: { n: number; size: number }[] }>('GET', `/media/${id}/parts`),
  partUrls: (id: string, parts: { n: number; md5: string }[]) =>
    request<{ urls: Record<string, string> }>('POST', `/media/${id}/parts`, { parts }),
  complete: (id: string) => request<{ media: RemoteMedia }>('POST', `/media/${id}/complete`),
  previewsUploaded: (id: string) => request<{ media: RemoteMedia }>('POST', `/media/${id}/previews`),
  startEdit: (
    id: string,
    edit: EditRecipe | null,
    derivatives: { thumb: { md5: string; size: number }; preview: { md5: string; size: number } },
  ) => request<{ version: number; derivativeUrls?: DerivativeUrls }>('POST', `/media/${id}/edit`, { edit, derivatives }),
  commitEdit: (id: string, version: number) =>
    request<{ media: RemoteMedia }>('POST', `/media/${id}/edit/commit`, { version }),
  /** Moves to Trash. Shared items need a scope (ApiError code "shared" without one). */
  deleteMedia: (id: string, scope?: DeleteScope) =>
    request<{ deleted: string; phase: string }>('DELETE', `/media/${id}${scope ? `?scope=${scope}` : ''}`),
  trash: (cursor?: string | null) => request<Page<TrashItem>>('GET', `/trash${q(cursor)}`),
  /** Trash: back instantly. Archive: starts a recovery (~12 hours) unless already possible. */
  restore: (id: string) =>
    request<{ phase: 'restored'; media: RemoteMedia } | { phase: 'recovering'; item: TrashItem }>('POST', `/media/${id}/restore`),
  deleteForever: (id: string) => request<{ deleted: string }>('DELETE', `/media/${id}/forever`),

  searchUsers: (query: string) => request<{ users: Person[] }>('GET', `/users?q=${encodeURIComponent(query)}`),
  contacts: () => request<{ contacts: Contact[] }>('GET', '/contacts'),
  share: (mediaIds: string[], to: string[]) =>
    request<{ shared: number; recipients: string[] }>('POST', '/shares', { mediaIds, to }),
  shared: (cursor?: string | null) => request<Page<SharedMedia>>('GET', `/shared${q(cursor)}`),
  removeShared: (ownerId: string, mediaId: string) => request<unknown>('DELETE', `/shared/${ownerId}/${mediaId}`),

  createPairing: () => request<{ code: string; expiresAt: number }>('POST', '/pairing'),
  claimPairing: (code: string) => request<IdentityResponse>('POST', '/pairing/claim', { code }),
};
