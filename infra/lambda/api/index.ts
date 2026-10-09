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
  signOutCurrent,
} from './identity';
import { HttpError, json, parseEvent, Res } from './lib';
import { completeExternal, completeUpload, listMedia, partUrls, previewsUploaded, startUpload, uploadedParts } from './media';
import { commitEdit, startEdit } from './edits';
import { removeShared, share, sharedWithMe } from './shares';
import { deleteForever, deleteMedia, listTrash, restoreMedia } from './trash';
import { deleteStorage, getStorage, putStorage, requestProvider } from './storage';
import { requestStream } from './stream';
import { requestAccountDeletion } from './account';
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
    if (route === 'GET /oauth/callback') return await oauthCallback(req);

    // Website sign-in (public): QR from a phone, email code, or Google. The
    // session comes back as an HttpOnly cookie through the /api proxy.
    if (route === 'POST /login-sessions') return await createLoginSession(req);
    if (seg[1] === 'login-sessions' && seg.length === 3 && method === 'GET') return await pollLoginSession(req, seg[2]);
    if (route === 'POST /web/auth/email/start') return await startEmail(null, req);
    if (route === 'POST /web/auth/email/verify') return await webVerifyEmail(req);
    if (route === 'POST /web/auth/google/start') return await webStartGoogle(req);
    if (route === 'POST /web/auth/google') return await webVerifyGoogle(req);
    if (route === 'DELETE /web-sessions/current') return await signOutCurrent(req);

    const identity = await authenticate(req);

    if (route === 'GET /me') return me(identity);
    if (route === 'DELETE /account') return await requestAccountDeletion(identity, req);
    if (route === 'POST /auth/email/start') return await startEmail(identity, req);
    if (route === 'POST /auth/email/verify') return await verifyEmail(identity, req);
    if (route === 'POST /auth/google') return await verifyGoogle(identity, req);
    if (route === 'POST /auth/continue') return await continueSignIn(identity, req);
    if (route === 'GET /sessions') return await listSessions(identity);
    if (route === 'DELETE /sessions') return await revokeOtherSessions(identity);
    if (seg[1] === 'sessions' && seg.length === 3 && method === 'DELETE') return await revokeSession(identity, seg[2]);
    if (route === 'GET /users') return await searchUsers(identity, req);
    if (route === 'GET /contacts') return await contacts(identity);
    if (route === 'POST /pairing') return await createPairing(identity);
    // Phone side of QR sign-in, and the phone's list of signed-in browsers.
    if (seg[1] === 'login-sessions' && seg.length === 4 && seg[3] === 'info' && method === 'GET') return await loginSessionInfo(seg[2]);
    if (seg[1] === 'login-sessions' && seg.length === 4 && seg[3] === 'approve' && method === 'POST') {
      return await approveLoginSession(identity, seg[2]);
    }
    if (seg[1] === 'login-sessions' && seg.length === 4 && seg[3] === 'deny' && method === 'POST') return await denyLoginSession(identity, seg[2]);
    if (route === 'GET /web-sessions') return await listWebSessions(identity);
    if (route === 'DELETE /web-sessions') return await revokeWebSessions(identity);

    if (route === 'GET /media') return await listMedia(identity, req);
    if (route === 'POST /media') return await startUpload(identity, req);
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
    if (route === 'GET /shared') return await sharedWithMe(identity, req);
    if (seg[1] === 'shared' && seg.length === 4 && method === 'DELETE') return await removeShared(identity, seg[2], seg[3]);

    throw new HttpError(404, 'Not found');
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message, code: error.code });
    console.error(error);
    return json(500, { error: 'Internal error' });
  }
}
