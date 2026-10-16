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
export type FeedbackKind = 'review' | 'issue' | 'idea' | 'other';
export type FeedbackItem = {
  id: string; reference: string; kind: FeedbackKind; rating?: number; message: string; email?: string; accountEmail?: string;
  device?: Record<string, string>; at: number; status: string; emailStatus?: string;
};
export type ContactMessage = { id: string; reference: string; name: string; email: string; topic: string; message: string; at: number; status: string };
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
/** Someone to share with: `account` = signed in (not a guest phone); `sharedBefore` = an accepted share before. */
export type Person = { id: string; name: string; account?: boolean; sharedBefore?: boolean; exact?: boolean; lastSharedAt?: number | null };
/** suggestMe: they let their friends' Lens suggest sharing with them (People). */
export type Contact = Person & { lastSharedAt: number; trusted?: boolean; shares?: number; suggestMe?: boolean };
export type ShareStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'revoked' | 'expired';
export type ShareRequest = {
  shareId: string;
  from: { id: string; name: string; account: boolean };
  to: { id: string; name: string; account: boolean };
  photos: number;
  videos: number;
  count: number;
  status: ShareStatus;
  createdAt: number;
  expiresAt: number;
  respondedAt?: number;
  knownSender?: boolean;
  /** Small thumbnails only (never the preview or original): from known senders, or after "Show previews". */
  thumbs?: { id: string; kind: string; thumbUrl?: string }[];
  /** Set when a whole album is offered. */
  album?: { id: string; name: string };
};
type Page<T> = { items: T[]; cursor: string | null };
export type NotificationPrefs = { shares: boolean; invites: boolean; storage: boolean };
export type Place = { city: string; region: string; country: string };
export type PlaceGroup = Place & { key: string; count: number; first: number; last: number; cover: RemoteMedia };
export type Album = {
  id: string;
  name: string;
  count: number;
  createdAt: number;
  updatedAt: number;
  cover: RemoteMedia | null;
  /** Event album: its join link is on (anyone with it can join and add photos). */
  event?: { code: string; url: string };
};
/** An album someone shared with me (its items are in the Shared list with this albumId). `event`: joined by link, I can add my photos. */
export type SharedAlbum = { id: string; name: string; ownerId: string; ownerName: string; at: number; event?: boolean };
/** A trip or event Lens found (docs/design/switch-features.md §4); `items`/`filmIds` only in the detail. */
export type Recap = {
  key: string;
  kind: 'trip' | 'event';
  title: string;
  start: number;
  end: number;
  count: number;
  photos: number;
  cover: RemoteMedia | null;
  albumId: string | null;
  film: { status: 'none' | 'rendering' | 'failed' } | { status: 'ready'; media: RemoteMedia };
  items?: (RemoteMedia | null)[];
  filmIds?: string[];
};
/** What an event link shows (docs/design/switch-features.md §3). */
export type EventInfo = {
  event: { code: string; url: string; name: string; ownerName: string; count: number; people: number; joined: boolean; isOwner: boolean; albumId: string; ownerId: string };
  items: { id: string; kind: 'photo' | 'video'; width?: number; height?: number; duration?: number; createdAt: number; thumbUrl?: string; previewUrl?: string; mine: boolean }[];
};

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
    /** Where the photo was taken (its own GPS tag), for Places; owner only. */
    gps?: { lat: number; lng: number };
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
  // Albums (docs/design/organise-and-share.md).
  albums: () => request<{ albums: Album[]; shared: SharedAlbum[] }>('GET', '/albums'),
  createAlbum: (name: string, mediaIds: string[] = []) => request<{ album: Album }>('POST', '/albums', { name, mediaIds }),
  album: (id: string) => request<{ album: Album; items: RemoteMedia[]; members: { id: string; name?: string; shareId: string }[] }>('GET', `/albums/${id}`),
  renameAlbum: (id: string, name: string) => request<{ id: string; name: string }>('PUT', `/albums/${id}`, { name }),
  deleteAlbum: (id: string) => request<unknown>('DELETE', `/albums/${id}`),
  editAlbum: (id: string, change: { add?: string[]; remove?: string[] }) => request<{ id: string; count: number }>('POST', `/albums/${id}/items`, change),
  leaveAlbum: (ownerId: string, id: string) => request<unknown>('DELETE', `/shared-albums/${ownerId}/${id}`),
  // Event albums: a join link / QR anyone can use; members add their own photos.
  // Recaps: trips and events found automatically; nothing is saved or shared until you choose.
  recaps: () => request<{ recaps: Recap[] }>('GET', `/recaps?tz=${-new Date().getTimezoneOffset()}`),
  recap: (key: string) => request<{ recap: Recap }>('GET', `/recaps/${key}?tz=${-new Date().getTimezoneOffset()}`),
  recapAlbum: (key: string, ids: string[]) => request<{ albumId: string }>('POST', `/recaps/${key}/album?tz=${-new Date().getTimezoneOffset()}`, { ids }),
  recapFilm: (key: string, ids: string[]) => request<{ status: string }>('POST', `/recaps/${key}/film?tz=${-new Date().getTimezoneOffset()}`, { ids }),
  dismissRecap: (key: string) => request<unknown>('POST', `/recaps/${key}/dismiss`),
  setEvent: (albumId: string, on: boolean) => request<{ event: { code: string; url: string } | null }>('POST', `/albums/${albumId}/event`, { on }),
  eventInfo: (code: string) => request<EventInfo>('GET', `/events/${encodeURIComponent(code)}`),
  joinEvent: (code: string) => request<{ joined: boolean; albumId: string; ownerId: string; name: string }>('POST', `/events/${encodeURIComponent(code)}/join`),
  mySharedAlbumItems: (ownerId: string, albumId: string) => request<{ mine: string[] }>('GET', `/shared-albums/${ownerId}/${albumId}/mine`),
  addToSharedAlbum: (ownerId: string, albumId: string, mediaIds: string[]) =>
    request<{ added: number; count: number }>('POST', `/shared-albums/${ownerId}/${albumId}/items`, { mediaIds }),
  removeFromSharedAlbum: (ownerId: string, albumId: string, mediaId: string) => request<unknown>('DELETE', `/shared-albums/${ownerId}/${albumId}/items/${mediaId}`),
  shareAlbum: (albumId: string, to: string[], includeLocation = false) =>
    request<{ shared: number; recipients: string[]; requests?: { id: string; name: string; shareId: string; status: ShareStatus }[] }>('POST', '/shares', { albumId, to, includeLocation }),
  // Places (step 2): positions for photos uploaded before, then the grouped view.
  setPlaces: (items: { id: string; lat: number; lng: number }[]) => request<{ updated: number }>('POST', '/media/places', { items }),
  places: () => request<{ places: PlaceGroup[] }>('GET', '/places'),
  placeItems: (key: string) => request<{ items: RemoteMedia[] }>('GET', `/places/items?key=${encodeURIComponent(key)}`),
  // Nearby on this Wi-Fi (step 3): opt-in, short-lived codes, names only from the server.
  nearbySettings: () => request<{ visible: boolean }>('GET', '/nearby'),
  peopleSuggest: () => request<{ suggestMe: boolean }>('GET', '/people/suggest'),
  setPeopleSuggest: (suggestMe: boolean) => request<{ suggestMe: boolean }>('PUT', '/people/suggest', { suggestMe }),
  setNearbyVisible: (visible: boolean) => request<{ visible: boolean }>('PUT', '/nearby', { visible }),
  nearbyCode: () => request<{ code: string | null; expiresAt?: number }>('POST', '/nearby/code'),
  nearbyResolve: (codes: string[]) => request<{ people: (Person & { nearby: true })[] }>('POST', '/nearby/resolve', { codes }),
  /** Is this exact file (MD5 base64 + size) already in my Lens? */
  checkDuplicate: (md5: string, size: number) => request<{ duplicate: RemoteMedia | null }>('POST', '/media/check', { md5, size }),
  lookupUser: (id: string) => request<{ user: Person }>('GET', `/users/${encodeURIComponent(id)}`),
  share: (mediaIds: string[], to: string[], includeLocation = false) =>
    request<{ shared: number; recipients: string[]; requests?: { id: string; name: string; shareId: string; status: ShareStatus }[] }>('POST', '/shares', { mediaIds, to, includeLocation }),
  // Share requests: nothing is shared until the recipient accepts (docs/design/sharing-consent.md).
  sharesIn: (cursor?: string | null) => request<{ requests: ShareRequest[]; pending: number; cursor: string | null }>('GET', `/shares/in${q(cursor)}`),
  sharesOut: (cursor?: string | null) => request<{ requests: ShareRequest[]; cursor: string | null }>('GET', `/shares/out${q(cursor)}`),
  shareRequest: (id: string, previews = false) => request<ShareRequest>('GET', `/shares/in/${id}${previews ? '?previews=1' : ''}`),
  acceptShare: (id: string, alwaysAccept = false) => request<{ status: ShareStatus; count: number }>('POST', `/shares/in/${id}/accept`, { alwaysAccept }),
  declineShare: (id: string, block = false) => request<{ status: ShareStatus; blocked: boolean }>('POST', `/shares/in/${id}/decline`, { block }),
  cancelShare: (id: string) => request<{ status: ShareStatus }>('POST', `/shares/out/${id}/cancel`),
  setBlocked: (userId: string, blocked: boolean) => request<{ blocked: boolean }>(blocked ? 'POST' : 'DELETE', `/blocks/${userId}`),
  setTrusted: (userId: string, trusted: boolean) => request<{ trusted: boolean }>('PUT', `/contacts/${userId}`, { trusted }),
  // Push notifications (FCM token per phone) and which kinds the user wants.
  registerPush: (token: string, platform: string) => request<{ ok: boolean }>('PUT', '/push', { token, platform }),
  unregisterPush: (token: string) => request<{ ok: boolean }>('DELETE', '/push', { token }),
  notificationPrefs: () => request<NotificationPrefs>('GET', '/notifications'),
  setNotificationPrefs: (prefs: Partial<NotificationPrefs>) => request<NotificationPrefs>('PUT', '/notifications', prefs),
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
  // Settings → Feedback: stored, then emailed to the team (infra/lambda/api/feedback.ts).
  sendFeedback: (body: { kind: FeedbackKind; rating?: number; message: string; email?: string; includeDevice: boolean; device?: Record<string, string> }) =>
    request<{ received: boolean; reference: string }>('POST', '/feedback', body),
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
    contact: (status: 'new' | 'done') => request<{ messages: ContactMessage[] }>('GET', `/admin/contact?status=${status}`),
    feedback: (status: 'new' | 'done') => request<{ feedback: FeedbackItem[] }>('GET', `/admin/feedback?status=${status}`),
    closeFeedback: (id: string) => request<{ status: string }>('POST', `/admin/feedback/${encodeURIComponent(id)}/done`),
    closeContact: (id: string) => request<{ status: string }>('POST', `/admin/contact/${encodeURIComponent(id)}/done`),
    markPaid: (affiliateId: string, month: string, reference: string) =>
      request<{ status: string }>('POST', `/admin/payouts/${affiliateId}/${month}/paid`, { reference }),
  },
  /** Anonymous camera diagnostics (src/lib/diagnostics.ts). */
  diagnostics: (report: { device: Record<string, unknown>; build: unknown; events: unknown[] }) =>
    request<{ ok: boolean }>('POST', '/diagnostics', report),
  // Camera quality R&D (docs/research/camera-quality.md).
  lab: {
    /** Anonymous camera capability report (no photos, not linked to the account). */
    probe: (report: Record<string, unknown>) => request<{ ok: boolean }>('POST', '/lab/probes', { report }),
    createSet: (files: { name: string; bytes: number; md5: string }[], meta: Record<string, unknown>) =>
      request<{ setId: string; urls: Record<string, string> }>('POST', '/lab/sets', { files, meta }),
  },
  /** Website: end this browser's session (clears the cookie). */
  signOutThisBrowser: () => request<{ signedOut: boolean }>('DELETE', '/web-sessions/current'),
};
