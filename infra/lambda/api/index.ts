import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { authenticate, claimPairing, contacts, createPairing, me, register, searchUsers } from './identity';
import { HttpError, json, parseEvent, Res } from './lib';
import { completeUpload, deleteMedia, listMedia, partUrls, previewsUploaded, startUpload, uploadedParts } from './media';
import { commitEdit, startEdit } from './edits';
import { removeShared, share, sharedWithMe } from './shares';

export async function handler(event: APIGatewayProxyEventV2): Promise<Res> {
  try {
    const req = parseEvent(event);
    const { method, path } = req;
    const seg = path.split('/').filter(Boolean); // ['v1', ...]
    if (seg[0] !== 'v1') throw new HttpError(404, 'Not found');
    const route = `${method} /${seg.slice(1).join('/')}`;

    // Public routes
    if (route === 'POST /devices') return await register();
    if (route === 'POST /pairing/claim') return await claimPairing(req);
    if (route === 'GET /health') return json(200, { ok: true });

    const identity = await authenticate(req);

    if (route === 'GET /me') return me(identity);
    if (route === 'GET /users') return await searchUsers(identity, req);
    if (route === 'GET /contacts') return await contacts(identity);
    if (route === 'POST /pairing') return await createPairing(identity);

    if (route === 'GET /media') return await listMedia(identity, req);
    if (route === 'POST /media') return await startUpload(identity, req);
    if (seg[1] === 'media' && seg.length === 3 && method === 'DELETE') return await deleteMedia(identity, seg[2]);
    if (seg[1] === 'media' && seg.length === 4) {
      const id = seg[2];
      if (seg[3] === 'parts' && method === 'GET') return await uploadedParts(identity, id);
      if (seg[3] === 'parts' && method === 'POST') return await partUrls(identity, id, req);
      if (seg[3] === 'complete' && method === 'POST') return await completeUpload(identity, id);
      if (seg[3] === 'previews' && method === 'POST') return await previewsUploaded(identity, id);
      if (seg[3] === 'edit' && method === 'POST') return await startEdit(identity, id, req);
    }
    if (seg[1] === 'media' && seg.length === 5 && seg[3] === 'edit' && seg[4] === 'commit' && method === 'POST') {
      return await commitEdit(identity, seg[2], req);
    }

    if (route === 'POST /shares') return await share(identity, req);
    if (route === 'GET /shared') return await sharedWithMe(identity, req);
    if (seg[1] === 'shared' && seg.length === 4 && method === 'DELETE') return await removeShared(identity, seg[2], seg[3]);

    throw new HttpError(404, 'Not found');
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { error: error.message });
    console.error(error);
    return json(500, { error: 'Internal error' });
  }
}
