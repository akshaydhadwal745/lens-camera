// S3-compatible connector: Backblaze B2, Wasabi, Cloudflare R2, MinIO, AWS S3…
// Same integrity model as Lens storage: every PUT/part carries Content-MD5,
// so the storage rejects anything altered. Big files use multipart (resumable).
// No trash: deleting in Lens keeps the file until "Delete forever".
import * as Crypto from 'expo-crypto';
import { File, UploadType } from 'expo-file-system';

import { md5HexToBase64 } from '../uploader';
import { writeChunkAt } from './http';
import { Creds, presignUrl, signRequest } from './sigv4';
import { Auth, Connector, UploadCancelled } from './types';

const SINGLE_MAX = 16 * 1024 * 1024;
const PART = 8 * 1024 * 1024;

export type S3Config = { endpoint: string; region: string; bucket: string; prefix: string; pathStyle: string };

const sha256 = async (data: Uint8Array) =>
  new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data as Uint8Array<ArrayBuffer>));

function setup(auth: Auth) {
  const config = auth.config as S3Config;
  const creds = JSON.parse(auth.secret ?? '{}') as Creds;
  if (!creds.accessKeyId || !creds.secretAccessKey) throw new Error('Missing S3 keys');
  const endpoint = new URL(config.endpoint);
  const objectUrl = (key: string) => {
    const path = `${config.prefix ?? ''}${key}`.split('/').map(encodeURIComponent).join('/');
    return config.pathStyle === 'false'
      ? new URL(`${endpoint.protocol}//${config.bucket}.${endpoint.host}/${path}`)
      : new URL(`${endpoint.origin}/${config.bucket}/${path}`);
  };
  const bucketUrl = () =>
    config.pathStyle === 'false' ? new URL(`${endpoint.protocol}//${config.bucket}.${endpoint.host}/`) : new URL(`${endpoint.origin}/${config.bucket}`);
  const region = config.region || 'us-east-1';
  const send = async (method: string, url: URL, headers: Record<string, string> = {}, body?: string) =>
    fetch(url.toString(), { method, headers: await signRequest(sha256, creds, region, method, url, headers), body });
  const sign = (method: string, url: URL, headers: Record<string, string> = {}) => signRequest(sha256, creds, region, method, url, headers);
  return { config, creds, region, objectUrl, bucketUrl, send, sign };
}

function xmlValue(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];
}

async function failText(res: Response, what: string): Promise<never> {
  const text = await res.text().catch(() => '');
  const code = xmlValue(text, 'Code') ?? `status ${res.status}`;
  throw new Error(`Storage ${what} failed: ${code}${xmlValue(text, 'Message') ? ` (${xmlValue(text, 'Message')})` : ''}`);
}

async function putFile(
  s: ReturnType<typeof setup>,
  file: File,
  url: URL,
  headers: Record<string, string>,
  onBytes: (sent: number) => void,
): Promise<string> {
  const result = await file.upload(url.toString(), {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: await s.sign('PUT', url, headers),
    onProgress: ({ bytesSent }) => onBytes(bytesSent),
  });
  if (result.status !== 200) {
    const reason = /BadDigest|InvalidDigest/.test(result.body) ? 'checksum mismatch' : `status ${result.status}`;
    throw new Error(`Storage rejected the upload (${reason})`);
  }
  return Object.entries(result.headers ?? {}).find(([k]) => k.toLowerCase() === 'etag')?.[1] ?? '';
}

type Resume = { uploadId: string; parts: Record<number, string> };

export const s3: Connector = {
  provider: 's3',

  async account(auth) {
    const s = setup(auth);
    // A one-item listing proves the keys, bucket and endpoint work.
    const url = s.bucketUrl();
    url.searchParams.set('list-type', '2');
    url.searchParams.set('max-keys', '1');
    if (s.config.prefix) url.searchParams.set('prefix', s.config.prefix);
    const res = await s.send('GET', url);
    if (!res.ok) await failText(res, 'connection test');
    return { account: `${s.config.bucket} · ${new URL(s.config.endpoint).host}`, quota: {} };
  },

  async quota() {
    return {}; // S3 buckets have no fixed size
  },

  async upload(auth, job) {
    const s = setup(auth);
    const url = s.objectUrl(job.name);

    if (job.size <= SINGLE_MAX) {
      const md5 = md5HexToBase64(job.md5Hex());
      await putFile(s, job.file, url, { 'content-type': job.contentType, 'content-md5': md5 }, job.onProgress);
    } else {
      let resume: Resume | undefined = job.resume ? JSON.parse(job.resume) : undefined;
      if (!resume) {
        const create = new URL(url);
        create.searchParams.set('uploads', '');
        const res = await s.send('POST', create, { 'content-type': job.contentType });
        if (!res.ok) await failText(res, 'upload');
        const uploadId = xmlValue(await res.text(), 'UploadId');
        if (!uploadId) throw new Error('Storage did not start the upload');
        resume = { uploadId, parts: {} };
        job.saveResume(JSON.stringify(resume));
      }
      const total = Math.ceil(job.size / PART);
      const partSize = (n: number) => Math.min(PART, job.size - (n - 1) * PART);
      let done = Object.keys(resume.parts).reduce((sum, n) => sum + partSize(Number(n)), 0);
      job.onProgress(done);
      for (let n = 1; n <= total; n++) {
        if (resume.parts[n]) continue;
        if (job.isCancelled()) throw new UploadCancelled();
        const chunk = writeChunkAt(job.file, 's3', (n - 1) * PART, partSize(n));
        try {
          const md5 = chunk.md5;
          if (!md5) throw new Error('Could not checksum the file');
          const partUrl = new URL(url);
          partUrl.searchParams.set('partNumber', String(n));
          partUrl.searchParams.set('uploadId', resume.uploadId);
          const before = done;
          resume.parts[n] = await putFile(s, chunk, partUrl, { 'content-md5': md5HexToBase64(md5) }, (sent) =>
            job.onProgress(before + sent),
          );
        } catch (error) {
          if (/NoSuchUpload/.test(String(error))) job.saveResume(undefined);
          throw error;
        } finally {
          if (chunk.exists) chunk.delete();
        }
        done += partSize(n);
        job.saveResume(JSON.stringify(resume));
      }
      const complete = new URL(url);
      complete.searchParams.set('uploadId', resume.uploadId);
      const xml = `<CompleteMultipartUpload>${Object.entries(resume.parts)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([n, etag]) => `<Part><PartNumber>${n}</PartNumber><ETag>${etag}</ETag></Part>`)
        .join('')}</CompleteMultipartUpload>`;
      const res = await s.send('POST', complete, { 'content-type': 'application/xml' }, xml);
      const text = await res.text();
      if (!res.ok || /<Error>/.test(text)) throw new Error(`Storage could not finish the upload: ${xmlValue(text, 'Code') ?? res.status}`);
    }

    // Every byte was MD5-checked on arrival; confirm the stored size too.
    const head = await s.send('HEAD', url);
    if (!head.ok || Number(head.headers.get('content-length')) !== job.size) {
      throw new Error('The storage reports a different file size. It will be uploaded again.');
    }
    return { ref: job.name, checksum: `md5:${job.md5Hex()}` };
  },

  async source(auth, ref) {
    const s = setup(auth);
    return { uri: await presignUrl(sha256, s.creds, s.region, 'GET', s.objectUrl(ref), 6 * 3600) };
  },

  async trash() {
    // No trash in S3: the file stays until "Delete forever".
  },

  async untrash() {},

  async remove(auth, ref) {
    const s = setup(auth);
    const res = await s.send('DELETE', s.objectUrl(ref));
    if (!res.ok && res.status !== 404) await failText(res, 'delete');
  },
};
