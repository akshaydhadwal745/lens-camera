import { createHash } from 'node:crypto';

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';

import { Identity } from './identity';
import { env, HttpError, json, randomId, rateLimit, Req, Res, s3 } from './lib';

/**
 * Camera quality R&D (docs/research/camera-quality.md).
 *
 * - Capability reports: what a phone's cameras can do (no photos, no account
 *   link), so we know how many phones each photo pipeline can reach.
 * - Quality Lab sets: the same scene captured with every pipeline a phone
 *   supports, uploaded as-is for offline comparison.
 *
 * Everything lands under `lab/` in the media bucket; analysis reads it there.
 */

const MAX_REPORT_BYTES = 64 * 1024;
const MAX_SET_FILES = 80;
const MAX_SET_BYTES = 800 * 1024 ** 2;
const PRESIGN_SECONDS = 6 * 3600;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const MD5 = /^[A-Za-z0-9+/]{22}==$/;
const TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  dng: 'image/x-adobe-dng',
  heic: 'image/heic',
  json: 'application/json',
};

/** POST /lab/probes { report } — anonymous; identical reports are stored once. */
export async function saveProbe(identity: Identity, req: Req): Promise<Res> {
  await rateLimit(`lab-probe#${identity.id}`, 20);
  const report = req.body?.report;
  if (!report || typeof report !== 'object') throw new HttpError(400, 'report required');
  const body = JSON.stringify(report);
  if (body.length > MAX_REPORT_BYTES) throw new HttpError(413, 'report too large');
  const device = (report as { device?: { manufacturer?: unknown; model?: unknown } }).device ?? {};
  const model = `${String(device.manufacturer ?? 'unknown')}_${String(device.model ?? 'unknown')}`
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 80);
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 16);
  await s3.send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: `lab/probes/${model}/${hash}.json`,
      Body: body,
      ContentType: 'application/json',
    }),
  );
  return json(200, { ok: true });
}

type SetFile = { name: string; bytes: number; md5: string };

/**
 * POST /lab/sets { files: [{ name, bytes, md5 }], meta } → { setId, urls }.
 * The phone PUTs each file to its URL (Content-MD5 checked by S3).
 */
export async function createSet(identity: Identity, req: Req): Promise<Res> {
  await rateLimit(`lab-set#${identity.id}`, 15);
  const files = req.body?.files as SetFile[] | undefined;
  const meta = req.body?.meta;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_SET_FILES) {
    throw new HttpError(400, `1–${MAX_SET_FILES} files required`);
  }
  if (!meta || typeof meta !== 'object') throw new HttpError(400, 'meta required');
  const metaBody = JSON.stringify({ ...meta, identity: identity.id, receivedAt: new Date().toISOString() });
  if (metaBody.length > MAX_REPORT_BYTES * 4) throw new HttpError(413, 'meta too large');
  let total = 0;
  const names = new Set<string>();
  for (const f of files) {
    if (!f || typeof f.name !== 'string' || !NAME.test(f.name) || names.has(f.name)) {
      throw new HttpError(400, 'bad file name');
    }
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!TYPES[ext]) throw new HttpError(400, `unsupported file type: ${f.name}`);
    if (!Number.isInteger(f.bytes) || f.bytes <= 0) throw new HttpError(400, 'bad file size');
    if (typeof f.md5 !== 'string' || !MD5.test(f.md5)) throw new HttpError(400, 'bad checksum');
    names.add(f.name);
    total += f.bytes;
  }
  if (total > MAX_SET_BYTES) throw new HttpError(413, 'set too large');

  const setId = `${new Date().toISOString().slice(0, 10)}-${randomId(6)}`;
  const prefix = `lab/sets/${setId}`;
  await s3.send(
    new PutObjectCommand({ Bucket: env.bucket, Key: `${prefix}/meta.json`, Body: metaBody, ContentType: 'application/json' }),
  );
  const urls: Record<string, string> = {};
  for (const f of files) {
    const ext = f.name.split('.').pop()!.toLowerCase();
    urls[f.name] = await presign(
      s3,
      new PutObjectCommand({
        Bucket: env.bucket,
        Key: `${prefix}/${f.name}`,
        ContentType: TYPES[ext],
        ContentMD5: f.md5,
        ContentLength: f.bytes,
      }),
      { expiresIn: PRESIGN_SECONDS },
    );
  }
  return json(200, { setId, urls });
}

const MAX_DIAGNOSTICS_BYTES = 32 * 1024;

/**
 * POST /diagnostics { device, build, events } — anonymous camera diagnostics
 * (how the camera started on this phone; no photos, no account link).
 * Stored as `diag/<day>/<maker_model>/<time>-<random>.json`.
 */
export async function saveDiagnostics(identity: Identity, req: Req): Promise<Res> {
  await rateLimit(`diag#${identity.id}`, 60);
  const { device, build, events } = req.body ?? {};
  if (!device || typeof device !== 'object' || !Array.isArray(events) || events.length === 0 || events.length > 20) {
    throw new HttpError(400, 'device and 1–20 events required');
  }
  const body = JSON.stringify({ device, build, events, receivedAt: new Date().toISOString() });
  if (body.length > MAX_DIAGNOSTICS_BYTES) throw new HttpError(413, 'too large');
  const d = device as { manufacturer?: unknown; model?: unknown };
  const model = `${String(d.manufacturer ?? 'unknown')}_${String(d.model ?? 'unknown')}`.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80);
  const now = new Date();
  await s3.send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: `diag/${now.toISOString().slice(0, 10)}/${model}/${now.getTime()}-${randomId(4)}.json`,
      Body: body,
      ContentType: 'application/json',
    }),
  );
  return json(200, { ok: true });
}
