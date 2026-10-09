import type { EditRecipe } from './edits';
import {
  ConnectedStorage,
  DeleteScope,
  ProviderId,
  RemoteMedia,
  SharedMedia,
  StorageLocation,
  StorageOverview,
  TrashItem,
} from './types';

import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';
/**
 * Phones call the API directly with a bearer token. The website calls it on
 * its own domain (/api, via CloudFront) and is signed in by an HttpOnly cookie
 * that scripts can't read, so the web app never holds a token.
 */
export const API_URL = isWeb ? '/api/v1' : `${process.env.EXPO_PUBLIC_API_URL ?? ''}/v1`;
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
        // Website: cookie session + the header the API requires for changes (CSRF guard).
        ...(isWeb ? { 'x-lens-web': '1' } : {}),
      },
      ...(isWeb ? { credentials: 'same-origin' as const } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'You appear to be offline');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && (authToken || isWeb)) onUnauthorized?.();
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  }
  return data as T;
}

export type IdentityResponse = { id: string; name: string; token: string; email?: string };
/** Sign-in outcome. `token` is set when this phone switched to an existing account. */
export type SignInResult = {
  id: string;
  name: string;
  email?: string;
  token?: string;
  moved: number;
  pending: boolean;
  resume?: string;
};
export type Referrals = {
  code: string;
  link: string;
  rewardBytes: number;
  friendBonusBytes: number;
  earnedBytes: number;
  bonusBytes: number;
  friends: { name: string; state: 'joined' | 'signed-in' | 'rewarded' | 'not-eligible'; bytes: number; at: number }[];
  canClaim: boolean;
};
export type AffiliateLink = { code: string; campaign: string; url: string; clicks: number; signups: number; payers: number; netPaise: number; commissionPaise: number };
export type AffiliateDashboard = {
  status: 'none' | 'applied' | 'approved' | 'rejected' | 'suspended';
  name?: string;
  rateBps: number;
  holdDays?: number;
  minPayoutPaise?: number;
  panMasked?: string;
  upiMasked?: string;
  note?: string;
  links?: AffiliateLink[];
  pendingPaise?: number;
  approvedPaise?: number;
  inPayoutPaise?: number;
  paidPaise?: number;
  commissions?: { id: string; at: number; amountPaise: number; status: string; paid: boolean }[];
  payouts?: { month: string; grossPaise: number; tdsPaise: number; netPaise: number; status: string; reference?: string }[];
};
export type AdminAffiliate = { id: string; status: string; name: string; email: string; channels: string; audience?: string; appliedAt: number; panMasked?: string; upiMasked?: string };
export type AdminPayout = { affiliateId: string; name?: string; email?: string; upi?: string; pan?: string; grossPaise: number; tdsPaise: number; netPaise: number; status: string; reference?: string };
export type Session = { id: string; label: string; kind: string; createdAt: number; lastUsedAt: number; current: boolean };
type DerivativeUrls = { thumb?: string; preview?: string };
type PlanExtras = { derivativeUrls?: DerivativeUrls; previewReady?: boolean };
export type UploadPlan = PlanExtras &
  (
    | { mode: 'done'; media: RemoteMedia }
    | { mode: 'single'; url: string; contentType: string }
    | { mode: 'multipart'; uploadId: string; partSize: number }
    | { mode: 'external'; location: StorageLocation }
  );
export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt: number; accountId?: string };
export type Person = { id: string; name: string };
export type Contact = Person & { lastSharedAt: number };
type Page<T> = { items: T[]; cursor: string | null };

const q = (cursor?: string | null) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');

export const api = {
  /** Guest for this phone; `fingerprint` (hash) gets a reinstalled phone its guest back. */
  register: (device?: string, fingerprint?: string, extra?: { ref?: string; emulator?: boolean }) =>
    request<IdentityResponse & { restored?: boolean }>('POST', '/devices', { device, fingerprint, ...extra }),
  me: () =>
    request<{ id: string; name: string; email?: string; usedBytes: number; quotaBytes: number; bonusBytes?: number; admin?: boolean }>(
      'GET',
      '/me',
    ),

  // Accounts (guest → signed in)
  authEmailStart: (email: string) => request<{ sent: boolean }>('POST', '/auth/email/start', { email }),
  authEmailVerify: (email: string, code: string, device?: string) =>
    request<SignInResult>('POST', '/auth/email/verify', { email, code, device }),
  authGoogle: (body: { code: string; state: string; codeVerifier: string; device?: string }) =>
    request<SignInResult>('POST', '/auth/google', body),
  authContinue: (resume: string, device?: string) => request<SignInResult>('POST', '/auth/continue', { resume, device }),
  sessions: () => request<{ sessions: Session[] }>('GET', '/sessions'),
  revokeSession: (id: string) => request<unknown>('DELETE', `/sessions/${id}`),
  revokeOtherSessions: () => request<{ revoked: number }>('DELETE', '/sessions'),

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
    /** Original goes to this connected storage instead of Lens. */
    location?: Pick<StorageLocation, 'storageId' | 'provider'>;
    /** Video still recording: size unknown until /complete. */
    streaming?: boolean;
  }) => request<UploadPlan>('POST', '/media', body),
  completeExternal: (id: string, ref: string, checksum: string) =>
    request<{ media: RemoteMedia }>('POST', `/media/${id}/external`, { ref, checksum }),
  uploadedParts: (id: string) =>
    request<{ parts: { n: number; size: number; etag?: string }[] }>('GET', `/media/${id}/parts`),
  partUrls: (id: string, parts: { n: number; md5: string }[]) =>
    request<{ urls: Record<string, string> }>('POST', `/media/${id}/parts`, { parts }),
  /** `size` is required for uploads that started while recording. */
  complete: (id: string, size?: number) => request<{ media: RemoteMedia }>('POST', `/media/${id}/complete`, size ? { size } : undefined),
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

  /** How to play a video here: adaptive HLS (ready), original while converting (preparing), or original. */
  stream: (mediaId: string, ownerId?: string) =>
    request<{ status: 'ready' | 'preparing' | 'original'; url?: string }>('POST', '/stream', { mediaId, ownerId }),
  storage: () => request<StorageOverview>('GET', '/storage'),
  /** Connect or report health. Free plan allows one (ApiError code "plan-limit"). */
  putStorage: (id: string, body: Omit<ConnectedStorage, 'id' | 'checkedAt' | 'createdAt'>) =>
    request<{ storage: ConnectedStorage }>('PUT', `/storages/${id}`, body),
  deleteStorage: (id: string) => request<unknown>('DELETE', `/storages/${id}`),
  requestProvider: (provider: string, note?: string) => request<unknown>('POST', '/provider-requests', { provider, note }),
  oauthProviders: () => request<{ providers: Partial<Record<ProviderId, boolean>> }>('GET', '/oauth/providers'),
  oauthStart: (provider: ProviderId | 'google', codeChallenge: string) =>
    request<{ url: string; state: string; redirect: string }>('POST', `/oauth/${provider}/start`, { codeChallenge }),
  oauthToken: (provider: ProviderId, body: { code: string; state: string; codeVerifier: string }) =>
    request<OAuthTokens>('POST', `/oauth/${provider}/token`, body),
  oauthRefresh: (provider: ProviderId, refreshToken: string) =>
    request<OAuthTokens>('POST', `/oauth/${provider}/refresh`, { refreshToken }),

  searchUsers: (query: string) => request<{ users: Person[] }>('GET', `/users?q=${encodeURIComponent(query)}`),
  contacts: () => request<{ contacts: Contact[] }>('GET', '/contacts'),
  share: (mediaIds: string[], to: string[]) =>
    request<{ shared: number; recipients: string[] }>('POST', '/shares', { mediaIds, to }),
  shared: (cursor?: string | null) => request<Page<SharedMedia>>('GET', `/shared${q(cursor)}`),
  removeShared: (ownerId: string, mediaId: string) => request<unknown>('DELETE', `/shared/${ownerId}/${mediaId}`),

  createPairing: () => request<{ code: string; expiresAt: number }>('POST', '/pairing'),
  claimPairing: (code: string) => request<IdentityResponse>('POST', '/pairing/claim', { code }),
  // QR sign-in for the website: the phone approves or denies a browser.
  loginSessionInfo: (id: string) => request<{ browser: string; city?: string; status: string }>('GET', `/login-sessions/${id}/info`),
  approveLoginSession: (id: string) => request<{ approved: boolean }>('POST', `/login-sessions/${id}/approve`),
  denyLoginSession: (id: string) => request<{ denied: boolean }>('POST', `/login-sessions/${id}/deny`),
  webSessions: () => request<{ sessions: { id: string; browser: string; createdAt: number }[] }>('GET', '/web-sessions'),
  signOutAllBrowsers: () => request<{ revoked: number }>('DELETE', '/web-sessions'),
  /** Deletes the account and all its data (cloud). Irreversible. */
  deleteAccount: () => request<{ deleting: boolean }>('DELETE', '/account', { confirm: 'DELETE' }),

  // Invite friends (+storage) and the affiliate program.
  referrals: () => request<Referrals>('GET', '/referrals'),
  claimReferral: (code: string) => request<{ program: string; state: string }>('POST', '/referrals/claim', { code }),
  affiliate: () => request<AffiliateDashboard>('GET', '/affiliates/me'),
  applyAffiliate: (body: { name: string; channels: string; audience?: string; pan?: string; upi?: string; agree: boolean }) =>
    request<{ status: string }>('POST', '/affiliates/apply', body),
  affiliatePayoutDetails: (body: { pan?: string; upi?: string }) =>
    request<{ panMasked?: string; upiMasked?: string }>('PUT', '/affiliates/payout-details', body),
  createAffiliateLink: (campaign: string) => request<{ code: string; url: string }>('POST', '/affiliates/links', { campaign }),

  // Admin (allow-listed accounts).
  admin: {
    affiliates: (status: string) => request<{ affiliates: AdminAffiliate[] }>('GET', `/admin/affiliates?status=${status}`),
    decideAffiliate: (id: string, action: string, note?: string) =>
      request<{ status: string }>('POST', `/admin/affiliates/${id}`, { action, note }),
    heldReferrals: () =>
      request<{ held: { inviterId: string; friendId: string; friendName: string; reason: string; at: number }[] }>('GET', '/admin/referrals/held'),
    decideReferral: (friendId: string, action: 'release' | 'reject') =>
      request<{ state: string }>('POST', `/admin/referrals/${friendId}`, { action }),
    runPayouts: (month: string) => request<{ payouts: { affiliateId: string; grossPaise: number }[] }>('POST', '/admin/payouts/run', { month }),
    payouts: (month: string) => request<{ payouts: AdminPayout[] }>('GET', `/admin/payouts?month=${month}`),
    markPaid: (affiliateId: string, month: string, reference: string) =>
      request<{ status: string }>('POST', `/admin/payouts/${affiliateId}/${month}/paid`, { reference }),
  },
  /** Website: end this browser's session (clears the cookie). */
  signOutThisBrowser: () => request<{ signedOut: boolean }>('DELETE', '/web-sessions/current'),
};
