// Google Drive connector. Scope `drive.file`: Lens only sees files it created
// (in a "Lens" folder). Uploads use Drive's resumable protocol in 8 MiB chunks
// and are verified against Drive's MD5 of the stored file.
import { UploadType } from 'expo-file-system';

import { authedFetch, errorText, header, writeChunkAt } from './http';
import { Auth, Connector, Quota, SignedOut, StorageFull, UploadCancelled, UploadJob } from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS = 'id,md5Checksum,size';
/** Must be a multiple of 256 KiB. */
const CHUNK = 8 * 1024 * 1024;

async function fail(res: Response, what: string): Promise<never> {
  const text = await errorText(res);
  if (res.status === 403 && /storageQuotaExceeded|quota/i.test(text)) throw new StorageFull('Your Google Drive is full');
  if (res.status === 401) throw new SignedOut();
  throw new Error(`Google Drive ${what} failed: ${text}`);
}

async function ensureFolder(auth: Auth): Promise<string> {
  if (auth.config.folderId) return auth.config.folderId;
  const q = encodeURIComponent(`name = 'Lens' and mimeType = '${FOLDER_MIME}' and trashed = false`);
  const found = await authedFetch(auth, `${API}/files?q=${q}&fields=files(id)&spaces=drive`);
  if (!found.ok) await fail(found, 'folder lookup');
  let id: string | undefined = (await found.json()).files?.[0]?.id;
  if (!id) {
    const created = await authedFetch(auth, `${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Lens', mimeType: FOLDER_MIME }),
    });
    if (!created.ok) await fail(created, 'folder creation');
    id = (await created.json()).id as string;
  }
  await auth.saveConfig({ folderId: id });
  return id;
}

async function quota(auth: Auth): Promise<Quota & { email?: string }> {
  const res = await authedFetch(auth, `${API}/about?fields=user(emailAddress),storageQuota(limit,usage)`);
  if (!res.ok) await fail(res, 'storage check');
  const data = await res.json();
  return {
    usedBytes: data.storageQuota?.usage ? Number(data.storageQuota.usage) : undefined,
    // No limit = unlimited (some Workspace plans).
    totalBytes: data.storageQuota?.limit ? Number(data.storageQuota.limit) : undefined,
    email: data.user?.emailAddress,
  };
}

type DriveFile = { id: string; md5Checksum?: string; size?: string };

/** Where an interrupted session stands: done (file), next offset, or gone. */
async function sessionStatus(session: string, size: number): Promise<{ file?: DriveFile; offset?: number; expired?: boolean }> {
  const res = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${size}` } });
  if (res.status === 200 || res.status === 201) return { file: (await res.json()) as DriveFile };
  if (res.status === 308) {
    const range = res.headers.get('range');
    return { offset: range ? Number(range.split('-')[1]) + 1 : 0 };
  }
  return { expired: true };
}

async function verify(auth: Auth, job: UploadJob, file: DriveFile) {
  const expected = job.md5Hex().toLowerCase();
  if (!file.md5Checksum || file.md5Checksum.toLowerCase() !== expected || Number(file.size) !== job.size) {
    await authedFetch(auth, `${API}/files/${file.id}`, { method: 'DELETE' }).catch(() => {});
    throw new Error('Google Drive stored a different file than we sent (checksum mismatch). It will be uploaded again.');
  }
  return { ref: file.id, checksum: `md5:${expected}` };
}

export const gdrive: Connector = {
  provider: 'gdrive',

  async account(auth) {
    const q = await quota(auth);
    await ensureFolder(auth);
    return { account: q.email ?? 'Google account', quota: q };
  },

  quota,

  async upload(auth, job) {
    let session = job.resume;
    let offset = 0;
    if (session) {
      const status = await sessionStatus(session, job.size);
      if (status.file) return verify(auth, job, status.file);
      if (status.expired) session = undefined;
      else offset = status.offset ?? 0;
    }
    if (!session) {
      const folderId = await ensureFolder(auth);
      const res = await authedFetch(auth, `${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': job.contentType,
          'X-Upload-Content-Length': String(job.size),
        },
        body: JSON.stringify({ name: job.name, parents: [folderId], mimeType: job.contentType }),
      });
      if (!res.ok) await fail(res, 'upload');
      session = res.headers.get('location') ?? undefined;
      if (!session) throw new Error('Google Drive did not start the upload');
      job.saveResume(session);
      offset = 0;
    }
    job.onProgress(offset);

    while (offset < job.size) {
      if (job.isCancelled()) throw new UploadCancelled();
      const length = Math.min(CHUNK, job.size - offset);
      const chunk = writeChunkAt(job.file, 'gdrive', offset, length);
      const start = offset;
      let result;
      try {
        result = await chunk.upload(session, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers: { 'Content-Range': `bytes ${start}-${start + length - 1}/${job.size}` },
          onProgress: ({ bytesSent }) => job.onProgress(start + bytesSent),
        });
      } finally {
        if (chunk.exists) chunk.delete();
      }
      if (result.status === 308) {
        const range = header(result.headers, 'range');
        offset = range ? Number(range.split('-')[1]) + 1 : start;
        continue;
      }
      if (result.status === 200 || result.status === 201) {
        return verify(auth, job, JSON.parse(result.body) as DriveFile);
      }
      if (result.status === 404 || result.status === 410) {
        job.saveResume(undefined); // session expired: start over next attempt
        throw new Error('Google Drive upload session expired');
      }
      if (result.status === 403 && /storageQuotaExceeded|quota/i.test(result.body)) throw new StorageFull('Your Google Drive is full');
      throw new Error(`Google Drive upload failed (status ${result.status})`);
    }
    // All bytes sent but no final response (e.g. app killed at the last moment): ask Drive.
    const status = await sessionStatus(session, job.size);
    if (status.file) return verify(auth, job, status.file);
    throw new Error('Google Drive upload did not finish');
  },

  async source(auth, ref) {
    return { uri: `${API}/files/${ref}?alt=media`, headers: { Authorization: `Bearer ${await auth.token()}` } };
  },

  async trash(auth, ref) {
    const res = await authedFetch(auth, `${API}/files/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (!res.ok && res.status !== 404) await fail(res, 'move to trash');
  },

  async untrash(auth, ref) {
    const res = await authedFetch(auth, `${API}/files/${ref}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: false }),
    });
    if (!res.ok) await fail(res, 'restore');
  },

  async remove(auth, ref) {
    const res = await authedFetch(auth, `${API}/files/${ref}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) await fail(res, 'delete');
  },
};
