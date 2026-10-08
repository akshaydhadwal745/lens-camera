// Box connector (files go into a "Lens" folder). Small files (<20 MB) upload
// in one request; bigger ones use Box's chunked upload session. Box checks the
// SHA-1 of every part and of the whole file, so altered bytes are rejected.
// Free Box plans cap files at 250 MB: those originals go to Lens storage.
import * as Crypto from 'expo-crypto';
import { UploadType } from 'expo-file-system';

import { base64, Sha1, toHex } from './hashes';
import { authedFetch, errorText, readBytesAt, writeChunkAt } from './http';
import { Auth, Connector, FileTooLarge, SignedOut, StorageFull, UploadCancelled, UploadJob } from './types';

const API = 'https://api.box.com/2.0';
const UPLOAD = 'https://upload.box.com/api/2.0';
const CHUNKED_MIN = 20 * 1024 * 1024;
const HASH_BLOCK = 4 * 1024 * 1024;

type BoxFile = { id: string; sha1: string; size: number };
type Part = { part_id: string; offset: number; size: number; sha1: string };
type Resume = { sessionId: string; partSize: number; parts: Part[] };

async function fail(res: Response, what: string): Promise<never> {
  const text = await errorText(res);
  if (/storage_limit_exceeded|insufficient/i.test(text)) throw new StorageFull('Your Box storage is full');
  if (/file_size_limit_exceeded/i.test(text)) throw new FileTooLarge('This file is bigger than your Box plan allows');
  if (res.status === 401) throw new SignedOut();
  throw new Error(`Box ${what} failed: ${text}`);
}

async function ensureFolder(auth: Auth): Promise<string> {
  if (auth.config.folderId) return auth.config.folderId;
  const res = await authedFetch(auth, `${API}/folders?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Lens', parent: { id: '0' } }),
  });
  let id: string | undefined;
  if (res.status === 201) id = (await res.json()).id;
  else if (res.status === 409) {
    // Already exists: Box tells us its id.
    const conflicts = (await res.json()).context_info?.conflicts;
    id = (Array.isArray(conflicts) ? conflicts[0] : conflicts)?.id;
  } else await fail(res, 'folder setup');
  if (!id) throw new Error('Box did not create the Lens folder');
  await auth.saveConfig({ folderId: id });
  return id;
}

async function me(auth: Auth) {
  const res = await authedFetch(auth, `${API}/users/me?fields=login,space_amount,space_used,max_upload_size`);
  if (!res.ok) await fail(res, 'account check');
  return (await res.json()) as { login: string; space_amount: number; space_used: number; max_upload_size: number };
}

const sha1Base64 = async (bytes: Uint8Array) =>
  base64(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA1, bytes as Uint8Array<ArrayBuffer>)));

/** Whole-file SHA-1, read in 4 MiB blocks. */
function fileSha1(job: UploadJob): Uint8Array {
  const hash = new Sha1();
  for (let offset = 0; offset < job.size; offset += HASH_BLOCK) {
    hash.update(readBytesAt(job.file, offset, Math.min(HASH_BLOCK, job.size - offset)));
  }
  return hash.digest();
}

async function verified(auth: Auth, job: UploadJob, file: BoxFile, sha1Hex: string) {
  if (file.sha1?.toLowerCase() !== sha1Hex || Number(file.size) !== job.size) {
    await authedFetch(auth, `${API}/files/${file.id}`, { method: 'DELETE' }).catch(() => {});
    throw new Error('Box stored a different file than we sent (checksum mismatch). It will be uploaded again.');
  }
  return { ref: file.id, checksum: `sha1:${sha1Hex}` };
}

async function uploadSmall(auth: Auth, job: UploadJob, folderId: string) {
  const sha1Hex = toHex(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA1, readBytesAt(job.file, 0, job.size) as Uint8Array<ArrayBuffer>)));
  const send = async (token: string) =>
    job.file.upload(`${UPLOAD}/files/content?fields=id,sha1,size`, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      parameters: { attributes: JSON.stringify({ name: job.name, parent: { id: folderId } }) },
      // Box uses Content-MD5 for the file's SHA-1 and rejects mismatches.
      headers: { Authorization: `Bearer ${token}`, 'Content-MD5': sha1Hex },
      onProgress: ({ bytesSent }) => job.onProgress(Math.min(bytesSent, job.size)),
    });
  let result = await send(await auth.token());
  if (result.status === 401) result = await send(await auth.refresh());
  if (result.status !== 201) {
    await fail(new Response(result.body, { status: result.status }), 'upload');
  }
  return verified(auth, job, JSON.parse(result.body).entries[0] as BoxFile, sha1Hex);
}

async function uploadChunked(auth: Auth, job: UploadJob, folderId: string) {
  let resume: Resume | undefined = job.resume ? JSON.parse(job.resume) : undefined;
  if (!resume) {
    const res = await authedFetch(auth, `${UPLOAD}/files/upload_sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folderId, file_size: job.size, file_name: job.name }),
    });
    if (!res.ok) await fail(res, 'upload');
    const session = (await res.json()) as { id: string; part_size: number };
    resume = { sessionId: session.id, partSize: session.part_size, parts: [] };
    job.saveResume(JSON.stringify(resume));
  }
  const { sessionId, partSize } = resume;
  let offset = resume.parts.reduce((sum, p) => sum + p.size, 0);
  job.onProgress(offset);

  while (offset < job.size) {
    if (job.isCancelled()) throw new UploadCancelled();
    const length = Math.min(partSize, job.size - offset);
    const digest = await sha1Base64(readBytesAt(job.file, offset, length));
    const chunk = writeChunkAt(job.file, 'box', offset, length);
    const start = offset;
    let result;
    try {
      const send = async (token: string) =>
        chunk.upload(`${UPLOAD}/files/upload_sessions/${sessionId}`, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            'Content-Range': `bytes ${start}-${start + length - 1}/${job.size}`,
            Digest: `sha=${digest}`,
          },
          onProgress: ({ bytesSent }) => job.onProgress(start + bytesSent),
        });
      result = await send(await auth.token());
      if (result.status === 401) result = await send(await auth.refresh());
    } finally {
      if (chunk.exists) chunk.delete();
    }
    if (result.status === 404) {
      job.saveResume(undefined); // session expired (7 days)
      throw new Error('Box upload session expired');
    }
    if (result.status !== 200) await fail(new Response(result.body, { status: result.status }), 'upload');
    resume.parts.push((JSON.parse(result.body) as { part: Part }).part);
    job.saveResume(JSON.stringify(resume));
    offset += length;
  }

  const whole = fileSha1(job);
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await authedFetch(auth, `${UPLOAD}/files/upload_sessions/${sessionId}/commit?fields=id,sha1,size`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Digest: `sha=${base64(whole)}` },
      body: JSON.stringify({ parts: resume.parts }),
    });
    if (res.status === 201) return verified(auth, job, (await res.json()).entries[0] as BoxFile, toHex(whole));
    if (res.status !== 202) await fail(res, 'upload');
    // Box is still assembling the parts.
    await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after') ?? 2) * 1000));
  }
  throw new Error('Box is still processing the upload; it will be checked again');
}

export const box: Connector = {
  provider: 'box',

  async account(auth) {
    const user = await me(auth);
    await ensureFolder(auth);
    return { account: user.login, quota: { usedBytes: user.space_used, totalBytes: user.space_amount } };
  },

  async quota(auth) {
    const user = await me(auth);
    return { usedBytes: user.space_used, totalBytes: user.space_amount };
  },

  async upload(auth, job) {
    const user = await me(auth);
    if (user.max_upload_size && job.size > user.max_upload_size) {
      throw new FileTooLarge(`Your Box plan allows files up to ${Math.round(user.max_upload_size / 1024 ** 2)} MB`);
    }
    const folderId = await ensureFolder(auth);
    return job.size < CHUNKED_MIN ? uploadSmall(auth, job, folderId) : uploadChunked(auth, job, folderId);
  },

  async source(auth, ref) {
    // Box answers with a redirect to a short-lived download URL.
    return { uri: `${API}/files/${ref}/content`, headers: { Authorization: `Bearer ${await auth.token()}` } };
  },

  async trash(auth, ref) {
    const res = await authedFetch(auth, `${API}/files/${ref}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) await fail(res, 'move to trash');
  },

  async untrash(auth, ref) {
    const res = await authedFetch(auth, `${API}/files/${ref}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) await fail(res, 'restore');
  },

  async remove(auth, ref) {
    await this.trash(auth, ref);
    const res = await authedFetch(auth, `${API}/files/${ref}/trash`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) await fail(res, 'delete');
  },
};
