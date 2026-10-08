// Dropbox connector (App folder: /Apps/Lens). Uploads use an upload session
// in 8 MiB chunks (resumable for 7 days) and are verified against Dropbox's
// content_hash. Originals open through short-lived direct links.
import { UploadType } from 'expo-file-system';

import { dropboxContentHash } from './hashes';
import { authedFetch, writeChunkAt } from './http';
import { Auth, Connector, SignedOut, StorageFull, UploadCancelled, UploadJob } from './types';

const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';
/** A multiple of 4 MiB (Dropbox's hash block size). */
const CHUNK = 8 * 1024 * 1024;

/** What we store as `ref`: id for opening, path + rev for restoring after delete. */
type Ref = { id: string; path: string; rev: string };

async function rpc<T>(auth: Auth, endpoint: string, args: unknown = null): Promise<T> {
  const res = await authedFetch(auth, `${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) fail(res.status, text, endpoint);
  return (text ? JSON.parse(text) : null) as T;
}

function fail(status: number, body: string, what: string): never {
  if (/insufficient_space/.test(body)) throw new StorageFull('Your Dropbox is full');
  if (status === 401) throw new SignedOut();
  throw new Error(`Dropbox ${what} failed: ${body.slice(0, 200) || status}`);
}

/** Uploads one chunk to a content endpoint (Dropbox-API-Arg header carries the args). */
async function sendChunk(
  auth: Auth,
  endpoint: string,
  args: unknown,
  job: UploadJob,
  offset: number,
  length: number,
): Promise<{ status: number; body: string }> {
  const chunk = length > 0 ? writeChunkAt(job.file, 'dropbox', offset, length) : null;
  const attempt = async (token: string) => {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify(args),
    };
    if (!chunk) {
      const res = await fetch(`${CONTENT}${endpoint}`, { method: 'POST', headers, body: '' });
      return { status: res.status, body: await res.text() };
    }
    return chunk.upload(`${CONTENT}${endpoint}`, {
      httpMethod: 'POST',
      uploadType: UploadType.BINARY_CONTENT,
      headers,
      onProgress: ({ bytesSent }) => job.onProgress(offset + bytesSent),
    });
  };
  try {
    let result = await attempt(await auth.token());
    if (result.status === 401) result = await attempt(await auth.refresh());
    return result;
  } finally {
    if (chunk?.exists) chunk.delete();
  }
}

function parseRef(ref: string): Ref {
  try {
    return JSON.parse(ref) as Ref;
  } catch {
    return { id: ref, path: ref, rev: '' };
  }
}

export const dropbox: Connector = {
  provider: 'dropbox',

  async account(auth) {
    const me = await rpc<{ email?: string; name?: { display_name?: string } }>(auth, '/users/get_current_account');
    return { account: me.email ?? me.name?.display_name ?? 'Dropbox account', quota: await this.quota(auth) };
  },

  async quota(auth) {
    const usage = await rpc<{ used: number; allocation: { allocated?: number } }>(auth, '/users/get_space_usage');
    return { usedBytes: usage.used, totalBytes: usage.allocation?.allocated };
  },

  async upload(auth, job) {
    let session: { id: string; offset: number } | undefined = job.resume ? JSON.parse(job.resume) : undefined;
    if (!session) {
      const start = await sendChunk(auth, '/files/upload_session/start', { close: false }, job, 0, 0);
      if (start.status !== 200) fail(start.status, start.body, 'upload');
      session = { id: JSON.parse(start.body).session_id as string, offset: 0 };
      job.saveResume(JSON.stringify(session));
    }
    job.onProgress(session.offset);

    while (session.offset < job.size) {
      if (job.isCancelled()) throw new UploadCancelled();
      const length = Math.min(CHUNK, job.size - session.offset);
      const result = await sendChunk(
        auth,
        '/files/upload_session/append_v2',
        { cursor: { session_id: session.id, offset: session.offset }, close: false },
        job,
        session.offset,
        length,
      );
      if (result.status === 200) {
        session.offset += length;
      } else if (/incorrect_offset/.test(result.body)) {
        // Dropbox already has more (or less) than we thought: continue from its offset.
        session.offset = JSON.parse(result.body).error?.correct_offset ?? session.offset;
      } else if (/not_found|closed/.test(result.body)) {
        job.saveResume(undefined); // session expired (7 days): start again next attempt
        throw new Error('Dropbox upload session expired');
      } else {
        fail(result.status, result.body, 'upload');
      }
      job.saveResume(JSON.stringify(session));
    }

    const finish = await sendChunk(
      auth,
      '/files/upload_session/finish',
      {
        cursor: { session_id: session.id, offset: session.offset },
        commit: { path: `/${job.name}`, mode: 'add', autorename: true, mute: true },
      },
      job,
      session.offset,
      0,
    );
    if (finish.status !== 200) fail(finish.status, finish.body, 'upload');
    const meta = JSON.parse(finish.body) as { id: string; path_lower: string; rev: string; size: number; content_hash: string };

    const expected = await dropboxContentHash(job.file, job.size);
    if (meta.content_hash !== expected || meta.size !== job.size) {
      await rpc(auth, '/files/delete_v2', { path: meta.id }).catch(() => {});
      throw new Error('Dropbox stored a different file than we sent (checksum mismatch). It will be uploaded again.');
    }
    const ref: Ref = { id: meta.id, path: meta.path_lower, rev: meta.rev };
    return { ref: JSON.stringify(ref), checksum: `dropbox:${expected}` };
  },

  async source(auth, ref) {
    // Direct link valid for 4 hours; no auth header needed.
    const { link } = await rpc<{ link: string }>(auth, '/files/get_temporary_link', { path: parseRef(ref).id });
    return { uri: link };
  },

  async trash(auth, ref) {
    // Dropbox keeps deleted files restorable (30 days on Basic plans).
    await rpc(auth, '/files/delete_v2', { path: parseRef(ref).id }).catch((e: Error) => {
      if (!/not_found/.test(e.message)) throw e;
    });
  },

  async untrash(auth, ref) {
    const r = parseRef(ref);
    await rpc(auth, '/files/restore', { path: r.path, rev: r.rev });
  },

  async remove(auth, ref) {
    // Permanent delete is only available on team accounts; Dropbox purges its trash itself.
    await this.trash(auth, ref);
  },
};
