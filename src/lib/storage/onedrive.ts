// OneDrive connector (Microsoft Graph, App folder: /Apps/Lens). Uploads use
// an upload session in ~8 MB chunks (multiples of 320 KiB) and are verified
// against OneDrive's QuickXorHash. Originals open through short-lived
// pre-authenticated download URLs.
import { UploadType } from 'expo-file-system';

import { quickXorHash } from './hashes';
import { authedFetch, errorText, header, writeChunkAt } from './http';
import { Auth, Connector, SignedOut, StorageFull, UploadCancelled, UploadJob } from './types';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const APPROOT = `${GRAPH}/me/drive/special/approot`;
/** Must be a multiple of 320 KiB and ≤ 60 MiB. */
const CHUNK = 320 * 1024 * 25;

type DriveItem = { id: string; size: number; file?: { hashes?: { quickXorHash?: string } } };

async function fail(res: Response, what: string): Promise<never> {
  const text = await errorText(res);
  if (res.status === 507 || /quotaLimitReached|insufficientStorage/i.test(text)) throw new StorageFull('Your OneDrive is full');
  if (res.status === 401) throw new SignedOut();
  throw new Error(`OneDrive ${what} failed: ${text}`);
}

async function get<T>(auth: Auth, url: string, what: string): Promise<T> {
  const res = await authedFetch(auth, url);
  if (!res.ok) await fail(res, what);
  return (await res.json()) as T;
}

/** Next byte OneDrive expects for an upload session, or null if the session is gone. */
async function nextOffset(uploadUrl: string): Promise<number | null> {
  const res = await fetch(uploadUrl);
  if (!res.ok) return null;
  const data = (await res.json()) as { nextExpectedRanges?: string[] };
  const first = data.nextExpectedRanges?.[0];
  return first ? Number(first.split('-')[0]) : null;
}

async function verify(auth: Auth, job: UploadJob, item: DriveItem) {
  const expected = quickXorHash(job.file, job.size);
  const actual = item.file?.hashes?.quickXorHash;
  if (!actual || actual !== expected || item.size !== job.size) {
    await authedFetch(auth, `${GRAPH}/me/drive/items/${item.id}`, { method: 'DELETE' }).catch(() => {});
    throw new Error('OneDrive stored a different file than we sent (checksum mismatch). It will be uploaded again.');
  }
  return { ref: item.id, checksum: `quickxor:${expected}` };
}

export const onedrive: Connector = {
  provider: 'onedrive',

  async account(auth) {
    const me = await get<{ mail?: string; userPrincipalName?: string; displayName?: string }>(
      auth,
      `${GRAPH}/me?$select=mail,userPrincipalName,displayName`,
      'account check',
    );
    // Touch the app folder so it exists.
    await get(auth, `${APPROOT}?$select=id`, 'folder setup');
    return { account: me.mail ?? me.userPrincipalName ?? me.displayName ?? 'Microsoft account', quota: await this.quota(auth) };
  },

  async quota(auth) {
    const drive = await get<{ quota?: { used?: number; total?: number } }>(auth, `${GRAPH}/me/drive?$select=quota`, 'storage check');
    return { usedBytes: drive.quota?.used, totalBytes: drive.quota?.total };
  },

  async upload(auth, job) {
    let uploadUrl = job.resume;
    let offset = 0;
    if (uploadUrl) {
      const next = await nextOffset(uploadUrl);
      if (next === null) uploadUrl = undefined;
      else offset = next;
    }
    if (!uploadUrl) {
      const res = await authedFetch(auth, `${APPROOT}:/${encodeURIComponent(job.name)}:/createUploadSession`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename' } }),
      });
      if (!res.ok) await fail(res, 'upload');
      uploadUrl = ((await res.json()) as { uploadUrl: string }).uploadUrl;
      job.saveResume(uploadUrl);
      offset = 0;
    }
    job.onProgress(offset);

    while (offset < job.size) {
      if (job.isCancelled()) throw new UploadCancelled();
      const length = Math.min(CHUNK, job.size - offset);
      const start = offset;
      const chunk = writeChunkAt(job.file, 'onedrive', start, length);
      let result;
      try {
        // The upload URL is pre-authenticated: no Authorization header (Graph rejects it).
        result = await chunk.upload(uploadUrl, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers: { 'Content-Range': `bytes ${start}-${start + length - 1}/${job.size}` },
          onProgress: ({ bytesSent }) => job.onProgress(start + bytesSent),
        });
      } finally {
        if (chunk.exists) chunk.delete();
      }
      if (result.status === 202) {
        const ranges = JSON.parse(result.body || '{}').nextExpectedRanges as string[] | undefined;
        offset = ranges?.[0] ? Number(ranges[0].split('-')[0]) : start + length;
        continue;
      }
      if (result.status === 200 || result.status === 201) return verify(auth, job, JSON.parse(result.body) as DriveItem);
      if (result.status === 404 || result.status === 410) {
        job.saveResume(undefined);
        throw new Error('OneDrive upload session expired');
      }
      if (result.status === 507 || /quotaLimitReached/i.test(result.body)) throw new StorageFull('Your OneDrive is full');
      const retryAfter = header(result.headers, 'retry-after');
      throw new Error(`OneDrive upload failed (status ${result.status}${retryAfter ? `, retry after ${retryAfter}s` : ''})`);
    }
    throw new Error('OneDrive upload did not finish');
  },

  async source(auth, ref) {
    const item = await get<Record<string, string>>(
      auth,
      `${GRAPH}/me/drive/items/${ref}?$select=id,@microsoft.graph.downloadUrl`,
      'open',
    );
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url) throw new Error('OneDrive did not return a download link');
    return { uri: url };
  },

  async trash(auth, ref) {
    // Goes to the OneDrive recycle bin (kept ~30 days).
    const res = await authedFetch(auth, `${GRAPH}/me/drive/items/${ref}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) await fail(res, 'move to recycle bin');
  },

  async untrash(auth, ref) {
    // Supported on personal OneDrive; work accounts restore from the recycle bin in OneDrive itself.
    const res = await authedFetch(auth, `${GRAPH}/me/drive/items/${ref}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) await fail(res, 'restore');
  },

  async remove(auth, ref) {
    await this.trash(auth, ref); // the recycle bin empties itself
  },
};
