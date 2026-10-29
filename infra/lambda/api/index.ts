import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import {
  approveLoginSession,
  authenticate,
  claimPairing,
  contacts,
  createLoginSession,
  createPairing,
  denyLoginSession,
  listWebSessions,
  loginSessionInfo,
  me,
  pollLoginSession,
  register,
  revokeWebSessions,
  searchUsers,
  lookupUser,
  signOutCurrent,
  webGuest,
} from './identity';
import { HttpError, json, parseEvent, Res } from './lib';
import { createSet, saveDiagnostics, saveProbe } from './lab';
import { checkDuplicate, completeExternal, completeUpload, listMedia, partUrls, previewsUploaded, startUpload, uploadedParts } from './media';
import { commitEdit, startEdit } from './edits';
import { setRealName } from './real-names';
import { accept, cancel, decline, inbox, listBlocked, removeShared, request as shareRequest, sent, setBlocked, setTrusted, share, sharedWithMe } from './shares';
import { notificationOpened, notificationPrefs, registerPush, unregisterPush } from './push';
import { listPlaces, placeItems, setPlaces } from './places';
import { nearbyCode, nearbyResolve, nearbySettings } from './nearby';
import { suggestSettings } from './people';
import { albumDetail, createAlbum, deleteAlbum, editAlbumItems, leaveAlbum, listAlbums, renameAlbum } from './albums';
import { dismissRecap, listRecaps, recapAlbum, recapDetail, recapFilm } from './recaps';
import { addEventItems, addSharedAlbumItems, eventInfo, joinEvent, leaveEvent, mySharedAlbumItems, removeEventItem, setEvent } from './events';
import { deleteForever, deleteMedia, listTrash, restoreMedia } from './trash';
import { deleteStorage, getStorage, putStorage, requestProvider } from './storage';
import { requestStream } from './stream';
import { requestAccountDeletion } from './account';
import { followLink } from './attribution';
import { submitContact } from './contact';
import { attachmentUpload, submitFeedback } from './feedback';
import { saveUsage } from './usage';
import { webEvent } from './web-events';
import { claimCode, myReferrals } from './referrals';
import {
  apply as applyAffiliate,
  createLink,
  dashboard as affiliateDashboard,
  updatePayoutDetails,
} from './affiliates';
import { updateManifest } from './updates';
import { exchangeOAuth, oauthCallback, oauthProviders, refreshOAuth, startOAuth, webStartGoogle } from './oauth';
import {
  continueSignIn,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  startEmail,
  verifyEmail,
  verifyGoogle,
  webVerifyEmail,
  webVerifyGoogle,
} from './auth';
import { cancelPlus, checkout as plusCheckout, getPlus, refreshPlus, webhook as razorpayWebhook } from './payments';
import { cancelMove, getMove, refreshMove, startMove } from './drive-move';
import { getExport, startExport } from './export';
import { getExtra, setExtra } from './extra-storage';
import { getPlay, postPurchase as playPurchase, rtdn as playRtdn } from './play-billing';
import { createLink as createShareLink, linkInfo, linkPage, listLinks, openLink, revokeLink } from './links';

export async function handler(event: APIGatewayProxyEventV2): Promise<Res> {
  try {
    const req = parseEvent(event);
    const { method, path } = req;
    const seg = path.split('/').filter(Boolean); // ['v1', ...]
    if (seg[0] !== 'v1') throw new HttpError(404, 'Not found');
    const route = `${method} /${seg.slice(1).join('/')}`;

    // Public routes
    if (route === 'POST /devices') return await register(req);
    if (route === 'POST /pairing/claim') return await claimPairing(req);
    if (route === 'GET /health') return json(200, { ok: true });
    if (route === 'GET /updates') return await updateManifest(req);
    if (route === 'POST /contact') return await submitContact(req);
    if (route === 'POST /web-events') return await webEvent(req);
    if (route === 'GET /oauth/callback') return await oauthCallback(req);
    // Razorpay → Lens (signed with the dashboard webhook secret; payments.ts).
    if (route === 'POST /razorpay/webhook') return await razorpayWebhook(req);
    // Google Play → Lens (Pub/Sub push, Google-signed OIDC token; play-billing.ts).
    if (route === 'POST /play/rtdn') return await playRtdn(req);
    // Invite (/r/<code>) and affiliate (/go/<code>) links on the website.
    if (seg[1] === 'r' && seg.length === 3 && method === 'GET') return await followLink(req, 'referral', seg[2]);
    if (seg[1] === 'go' && seg.length === 3 && method === 'GET') return await followLink(req, 'affiliate', seg[2]);

    // Website sign-in (public): QR from a phone, email code, or Google. The
    // session comes back as an HttpOnly cookie through the /api proxy.
    if (route === 'POST /login-sessions') return await createLoginSession(req);
    if (seg[1] === 'login-sessions' && seg.length === 3 && method === 'GET') return await pollLoginSession(req, seg[2]);
    if (route === 'POST /web/auth/email/start') return await startEmail(null, req);
    if (route === 'POST /web/auth/email/verify') return await webVerifyEmail(req);
    if (route === 'POST /web/auth/google/start') return await webStartGoogle(req);
    if (route === 'POST /web/auth/google') return await webVerifyGoogle(req);
    if (route === 'DELETE /web-sessions/current') return await signOutCurrent(req);
    if (route === 'POST /web/guest') return await webGuest(req);

    // Share links (lens.instagrowapp.com/s/<token>): anyone with the link can look (links.ts).
    if (seg[1] === 'links' && seg.length === 3 && method === 'GET') return await linkInfo(seg[2], req);
    // The share-link web page with a real preview (CloudFront /s/* → here).
    if (seg[1] === 's-page' && seg.length <= 3 && method === 'GET') return await linkPage(seg[2] ?? '', req);

    // Event album links (lens.instagrowapp.com/e/<code>): anyone with the link can look; signed-in
    // (or guest) people also learn whether they're already in.
    if (seg[1] === 'events' && seg.length === 3 && method === 'GET') {
      const viewer = await authenticate(req).catch(() => null);
      return await eventInfo(seg[2], viewer, req);
    }

    const identity = await authenticate(req);

    if (route === 'GET /me') return me(identity);
    if (route === 'PUT /me') return await setRealName(identity, req);
    if (route === 'DELETE /account') return await requestAccountDeletion(identity, req);
    if (route === 'POST /auth/email/start') return await startEmail(identity, req);
    if (route === 'POST /auth/email/verify') return await verifyEmail(identity, req);
    if (route === 'POST /auth/google') return await verifyGoogle(identity, req);
    if (route === 'POST /auth/continue') return await continueSignIn(identity, req);
    if (route === 'GET /sessions') return await listSessions(identity);
    if (route === 'DELETE /sessions') return await revokeOtherSessions(identity);
    if (seg[1] === 'sessions' && seg.length === 3 && method === 'DELETE') return await revokeSession(identity, seg[2]);
    if (route === 'GET /users') return await searchUsers(identity, req);
    if (seg[1] === 'users' && seg.length === 3 && method === 'GET') return await lookupUser(identity, seg[2]);
    if (route === 'GET /contacts') return await contacts(identity);
    if (route === 'POST /feedback/attachments') return await attachmentUpload(identity, req);
    if (route === 'POST /feedback') return await submitFeedback(identity, req);
    if (route === 'POST /pairing') return await createPairing(identity);
    // Phone side of QR sign-in, and the phone's list of signed-in browsers.
    if (seg[1] === 'login-sessions' && seg.length === 4 && seg[3] === 'info' && method === 'GET') return await loginSessionInfo(seg[2]);
    if (seg[1] === 'login-sessions' && seg.length === 4 && seg[3] === 'approve' && method === 'POST') {
      return await approveLoginSession(identity, seg[2]);
    }
    if (seg[1] === 'login-sessions' && seg.length === 4 && seg[3] === 'deny' && method === 'POST') return await denyLoginSession(identity, seg[2]);
    if (route === 'GET /web-sessions') return await listWebSessions(identity);
    if (route === 'DELETE /web-sessions') return await revokeWebSessions(identity);

    // User referrals (+storage) and the affiliate program (commission).
    if (route === 'GET /referrals') return await myReferrals(identity);
    if (route === 'POST /referrals/claim') return await claimCode(identity, req);
    if (route === 'GET /affiliates/me') return await affiliateDashboard(identity);
    if (route === 'POST /affiliates/apply') return await applyAffiliate(identity, req);
    if (route === 'PUT /affiliates/payout-details') return await updatePayoutDetails(identity, req);
    if (route === 'POST /affiliates/links') return await createLink(identity, req);

    // Admin moved to the Lens Console (infra/lambda/console): its own sign-in and API.


    if (route === 'POST /usage') return await saveUsage(identity, req);
    if (route === 'POST /diagnostics') return await saveDiagnostics(identity, req);
    // Camera quality R&D: capability reports + Quality Lab sets.
    if (route === 'POST /lab/probes') return await saveProbe(identity, req);
    if (route === 'POST /lab/sets') return await createSet(identity, req);

    if (route === 'GET /media') return await listMedia(identity, req);
    if (route === 'POST /media') return await startUpload(identity, req);
    if (route === 'POST /media/check') return await checkDuplicate(identity, req);
    // Places (step 2).
    if (route === 'POST /media/places') return await setPlaces(identity, req);
    if (route === 'GET /places') return await listPlaces(identity);
    if (route === 'GET /places/items') return await placeItems(identity, req);
    // Nearby on this Wi-Fi (step 3).
    if (route === 'GET /nearby' || route === 'PUT /nearby') return await nearbySettings(identity, req);
    if (route === 'POST /nearby/code') return await nearbyCode(identity);
    if (route === 'POST /nearby/resolve') return await nearbyResolve(identity, req);
    if (route === 'GET /people/suggest' || route === 'PUT /people/suggest') return await suggestSettings(identity, req);
    // Albums (docs/design/organise-and-share.md).
    if (route === 'GET /albums') return await listAlbums(identity);
    if (route === 'POST /albums') return await createAlbum(identity, req);
    if (seg[1] === 'albums' && seg.length === 3 && method === 'GET') return await albumDetail(identity, seg[2]);
    if (seg[1] === 'albums' && seg.length === 3 && method === 'PUT') return await renameAlbum(identity, seg[2], req);
    if (seg[1] === 'albums' && seg.length === 3 && method === 'DELETE') return await deleteAlbum(identity, seg[2]);
    if (seg[1] === 'albums' && seg.length === 4 && seg[3] === 'items' && method === 'POST') return await editAlbumItems(identity, seg[2], req);
    if (seg[1] === 'shared-albums' && seg.length === 4 && method === 'DELETE') return await leaveAlbum(identity, seg[2], seg[3]);
    // Trip and event recaps (docs/design/switch-features.md §4).
    if (route === 'GET /recaps') return await listRecaps(identity, req);
    if (seg[1] === 'recaps' && seg.length === 3 && method === 'GET') return await recapDetail(identity, seg[2], req);
    if (seg[1] === 'recaps' && seg.length === 4 && seg[3] === 'album' && method === 'POST') return await recapAlbum(identity, seg[2], req);
    if (seg[1] === 'recaps' && seg.length === 4 && seg[3] === 'film' && method === 'POST') return await recapFilm(identity, seg[2], req);
    if (seg[1] === 'recaps' && seg.length === 4 && seg[3] === 'dismiss' && method === 'POST') return await dismissRecap(identity, seg[2]);
    // Event albums (docs/design/switch-features.md §3).
    if (seg[1] === 'albums' && seg.length === 4 && seg[3] === 'event' && method === 'POST') return await setEvent(identity, seg[2], req);
    if (seg[1] === 'events' && seg.length === 4 && seg[3] === 'join' && method === 'POST') return await joinEvent(identity, seg[2]);
    if (seg[1] === 'events' && seg.length === 4 && seg[3] === 'items' && method === 'POST') return await addEventItems(identity, seg[2], req);
    if (seg[1] === 'events' && seg.length === 5 && seg[3] === 'members' && seg[4] === 'me' && method === 'DELETE') return await leaveEvent(identity, seg[2]);
    if (seg[1] === 'shared-albums' && seg.length === 5 && seg[4] === 'mine' && method === 'GET') return await mySharedAlbumItems(identity, seg[2], seg[3]);
    if (seg[1] === 'shared-albums' && seg.length === 5 && seg[4] === 'items' && method === 'POST') return await addSharedAlbumItems(identity, seg[2], seg[3], req);
    if (seg[1] === 'shared-albums' && seg.length === 6 && seg[4] === 'items' && method === 'DELETE') return await removeEventItem(identity, seg[2], seg[3], seg[5]);
    if (seg[1] === 'media' && seg.length === 3 && method === 'DELETE') return await deleteMedia(identity, seg[2], req);
    if (route === 'GET /trash') return await listTrash(identity, req);
    if (seg[1] === 'media' && seg.length === 4) {
      const id = seg[2];
      if (seg[3] === 'parts' && method === 'GET') return await uploadedParts(identity, id);
      if (seg[3] === 'parts' && method === 'POST') return await partUrls(identity, id, req);
      if (seg[3] === 'complete' && method === 'POST') return await completeUpload(identity, id, req);
      if (seg[3] === 'external' && method === 'POST') return await completeExternal(identity, id, req);
      if (seg[3] === 'previews' && method === 'POST') return await previewsUploaded(identity, id);
      if (seg[3] === 'edit' && method === 'POST') return await startEdit(identity, id, req);
      if (seg[3] === 'restore' && method === 'POST') return await restoreMedia(identity, id);
      if (seg[3] === 'forever' && method === 'DELETE') return await deleteForever(identity, id);
    }
    if (seg[1] === 'media' && seg.length === 5 && seg[3] === 'edit' && seg[4] === 'commit' && method === 'POST') {
      return await commitEdit(identity, seg[2], req);
    }

    // Lens Plus (Razorpay subscriptions), moving originals to Google Drive, download everything.
    if (route === 'GET /plus') return await getPlus(identity);
    if (route === 'POST /plus/checkout') return await plusCheckout(identity, req);
    if (route === 'POST /plus/refresh') return await refreshPlus(identity);
    if (route === 'POST /plus/cancel') return await cancelPlus(identity);
    if (route === 'GET /play') return await getPlay(identity);
    if (route === 'POST /play/purchase') return await playPurchase(identity, req);
    if (route === 'GET /extra') return await getExtra(identity);
    if (route === 'POST /extra') return await setExtra(identity, req);
    if (route === 'GET /move') return await getMove(identity);
    if (route === 'POST /move') return await startMove(identity, req);
    if (route === 'POST /move/refresh') return await refreshMove(identity);
    if (route === 'POST /move/cancel') return await cancelMove(identity);
    if (route === 'GET /export') return await getExport(identity);
    if (route === 'POST /export') return await startExport(identity);

    if (route === 'POST /stream') return await requestStream(identity, req);
    if (route === 'GET /storage') return await getStorage(identity);
    if (seg[1] === 'storages' && seg.length === 3 && method === 'PUT') return await putStorage(identity, seg[2], req);
    if (seg[1] === 'storages' && seg.length === 3 && method === 'DELETE') return await deleteStorage(identity, seg[2]);
    if (route === 'POST /provider-requests') return await requestProvider(identity, req);
    if (route === 'GET /oauth/providers') return await oauthProviders();
    if (seg[1] === 'oauth' && seg.length === 4 && method === 'POST') {
      if (seg[3] === 'start') return await startOAuth(identity, seg[2], req);
      if (seg[3] === 'token') return await exchangeOAuth(identity, seg[2], req);
      if (seg[3] === 'refresh') return await refreshOAuth(identity, seg[2], req);
    }

    if (route === 'POST /shares') return await share(identity, req);
    // Share requests (docs/design/sharing-consent.md).
    if (route === 'GET /shares/in') return await inbox(identity, req);
    if (route === 'GET /shares/out') return await sent(identity, req);
    if (seg[1] === 'shares' && seg[2] === 'in' && seg.length === 4 && method === 'GET') return await shareRequest(identity, seg[3], req);
    if (seg[1] === 'shares' && seg[2] === 'in' && seg.length === 5 && method === 'POST' && seg[4] === 'accept') return await accept(identity, seg[3], req);
    if (seg[1] === 'shares' && seg[2] === 'in' && seg.length === 5 && method === 'POST' && seg[4] === 'decline') return await decline(identity, seg[3], req);
    if (seg[1] === 'shares' && seg[2] === 'out' && seg.length === 5 && method === 'POST' && seg[4] === 'cancel') return await cancel(identity, seg[3]);
    if (route === 'GET /blocks') return await listBlocked(identity);
    if (route === 'POST /links') return await createShareLink(identity, req);
    if (route === 'GET /links') return await listLinks(identity);
    if (seg[1] === 'links' && seg.length === 4 && method === 'POST' && seg[3] === 'open') return await openLink(identity, seg[2]);
    if (seg[1] === 'links' && seg.length === 4 && method === 'POST' && seg[3] === 'revoke') return await revokeLink(identity, seg[2]);
    if (seg[1] === 'blocks' && seg.length === 3 && (method === 'POST' || method === 'DELETE')) return await setBlocked(identity, seg[2], method === 'POST');
    if (seg[1] === 'contacts' && seg.length === 3 && method === 'PUT') return await setTrusted(identity, seg[2], req);
    if (route === 'PUT /push') return await registerPush(identity, req);
    if (route === 'DELETE /push') return await unregisterPush(identity, req);
    if (route === 'GET /notifications' || route === 'PUT /notifications') return await notificationPrefs(identity, req);
    if (route === 'POST /notifications/opened') return await notificationOpened(identity, req);
    if (route === 'GET /shared') return await sharedWithMe(identity, req);
    if (seg[1] === 'shared' && seg.length === 4 && method === 'DELETE') return await removeShared(identity, seg[2], seg[3]);

    throw new HttpError(404, 'Not found');
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message, code: error.code });
    console.error(error);
    return json(500, { error: 'Internal error' });
  }
}
