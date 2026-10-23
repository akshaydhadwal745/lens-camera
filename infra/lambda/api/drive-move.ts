// "Move to my Google Drive": Lens copies originals from Lens storage to the person's Google Drive
// (their "Lens" folder), checks each copy's MD5, then frees the Lens space. Lens keeps the previews,
// so the gallery stays the same. Runs on our side (Maintenance Lambda, continues itself), so the
// phone can be off. docs/features/move-to-drive.md.
//
// Price (owner decision 2026-10-23: "moving takes our internet bandwidth, charge after some GB"):
// the first MOVE_FREE_BYTES per account are free, then PRICE_PER_GB_PAISE per GB, paid once with a
// Razorpay payment link. AWS charges ~₹9.6/GB for data leaving Mumbai; the price covers it plus GST
// and Razorpay's fee. Paid but unused GB stay as credit (PROFILE.moveCreditBytes).
//
// Not moved (stay in Lens): items shared with people (they keep the full-quality original), videos
// without a streaming copy yet, deleted items, recap films, files over MAX_FILE.
//
// Records: D#<id>/MOVE = the job; RZPL#<payment link id>/LINK → { accountId }.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { audit } from './audit';
import { Identity } from './identity';
import { ddb, derivedKey, env, HttpError, json, Req, Res, s3 } from './lib';
import { MediaRecord } from './media';
import { serverAccessToken } from './oauth';
import { notify } from './push';
import { razorpayConfigured, rzp } from './razorpay';
import { notify as email } from './referrals';

const GB = 1024 ** 3;
export const MOVE_FREE_BYTES = 10 * GB;
export const PRICE_PER_GB_PAISE = 1_500;
/** One file must fit in one 10-minute run (~20 MB/s S3 → Drive leaves a wide margin). */
const MAX_FILE = 4 * GB;
const CHUNK = 16 * 1024 * 1024; // multiple of 256 KiB (Drive resumable upload)
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const lambda = new LambdaClient({});

export type MoveJob = {
  pk: string;
  sk: 'MOVE';
  status: 'awaiting-payment' | 'running' | 'done' | 'paused' | 'cancelled';
  storageId: string;
  folderId?: string;
  /** AES-GCM sealed Google refresh token; removed when the job stops. */
  token?: string;
  /** Bytes this job may move (free allowance left + credit + paid). */
  allowanceBytes: number;
  freeBytes: number;
  paidBytes: number;
  pricePaise: number;
  linkId?: string;
  payUrl?: string;
  totalItems: number;
  totalBytes: number;
  movedItems: number;
  movedBytes: number;
  failed: string[];
  reason?: 'drive-full' | 'signed-out' | 'allowance' | 'error';
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
};

const jobKey = (id: string) => ({ pk: `D#${id}`, sk: 'MOVE' });

async function seal(text: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', await derivedKey('drive-move'), iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

async function unseal(sealed: string) {
  const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', await derivedKey('drive-move'), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

async function getJob(id: string) {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: jobKey(id) }))).Item as MoveJob | undefined;
}

async function patchJob(id: string, patch: Partial<MoveJob>, remove: (keyof MoveJob)[] = []) {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries({ ...patch, updatedAt: Date.now() }).map(([k, v]) => {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    return `#${k} = :${k}`;
  });
  for (const k of remove) names[`#${k}`] = k;
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: jobKey(id),
      UpdateExpression: `SET ${sets.join(', ')}${remove.length ? ` REMOVE ${remove.map((k) => `#${k}`).join(', ')}` : ''}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** Is this media item shared with someone (they'd lose the full-quality original)? */
async function isShared(ownerId: string, mediaId: string) {
  const r = await ddb.send(
    new QueryCommand({ TableName: env.table, IndexName: 'gsi1', KeyConditionExpression: 'gsi1pk = :p', ExpressionAttributeValues: { ':p': `SM#${ownerId}#${mediaId}` }, Limit: 1 }),
  );
  return (r.Items?.length ?? 0) > 0;
}

const movable = (m: MediaRecord & { recap?: unknown }) =>
  m.status === 'ready' && !m.location && !m.deletedAt && !m.archived && !m.recap && !m.streaming && m.size > 0 && m.size <= MAX_FILE &&
  (m.kind !== 'video' || m.streamStatus === 'ready');

/** Everything in Lens storage that can move, oldest first (shared items checked when moving). */
async function candidates(id: string): Promise<MediaRecord[]> {
  const out: MediaRecord[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)', ExpressionAttributeValues: { ':p': `D#${id}`, ':m': 'M#' }, ExclusiveStartKey: start }),
    );
    for (const m of (r.Items ?? []) as MediaRecord[]) if (movable(m)) out.push(m);
    start = r.LastEvaluatedKey;
  } while (start);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

async function profileCredit(id: string) {
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' }, ProjectionExpression: 'moveFreeUsedBytes, moveCreditBytes' }))).Item ?? {};
  return { freeLeft: Math.max(0, MOVE_FREE_BYTES - (p.moveFreeUsedBytes ?? 0)), credit: p.moveCreditBytes ?? 0 };
}

function priceFor(bytes: number, freeLeft: number, credit: number) {
  const payBytes = Math.max(0, bytes - freeLeft - credit);
  const gbs = Math.ceil(payBytes / GB);
  return { payGb: gbs, pricePaise: gbs * PRICE_PER_GB_PAISE };
}

function jobForClient(j: MoveJob | undefined) {
  if (!j) return undefined;
  const { pk: _p, sk: _s, token: _t, linkId: _l, ...rest } = j;
  return rest;
}

/** GET /v1/move: what moving would cost now, and the current/last job. */
export async function getMove(identity: Identity): Promise<Res> {
  if (!identity.email) throw new HttpError(403, 'Sign in to move photos to your Google Drive', 'sign-in');
  const [items, credit, job] = await Promise.all([candidates(identity.id), profileCredit(identity.id), getJob(identity.id)]);
  const bytes = items.reduce((s, m) => s + m.size, 0);
  return json(200, {
    quote: { items: items.length, bytes, freeLeftBytes: credit.freeLeft, creditBytes: credit.credit, ...priceFor(bytes, credit.freeLeft, credit.credit), pricePerGbPaise: PRICE_PER_GB_PAISE, freeBytes: MOVE_FREE_BYTES },
    job: jobForClient(job),
  });
}

/**
 * POST /v1/move {storageId, refreshToken, folderId?}: start moving. The phone hands over its Google
 * Drive sign-in for this job only (sealed, deleted when the job stops). Over the free allowance →
 * a Razorpay payment link first ({ payUrl }); the move starts when it's paid.
 */
export async function startMove(identity: Identity, req: Req): Promise<Res> {
  if (!identity.email) throw new HttpError(403, 'Sign in to move photos to your Google Drive', 'sign-in');
  const { storageId, refreshToken, folderId } = req.body ?? {};
  if (typeof storageId !== 'string' || !/^[a-z0-9-]{4,40}$/.test(storageId)) throw new HttpError(400, 'Invalid storage');
  if (typeof refreshToken !== 'string' || refreshToken.length < 10 || refreshToken.length > 2000) throw new HttpError(400, 'Sign in to Google Drive again', 'signed-out');
  if (folderId !== undefined && (typeof folderId !== 'string' || !/^[\w-]{5,100}$/.test(folderId))) throw new HttpError(400, 'Invalid folder');
  const storage = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `ST#${storageId}` } }))).Item;
  if (storage?.provider !== 'gdrive') throw new HttpError(400, 'Connect your Google Drive first', 'no-drive');
  let existing = await getJob(identity.id);
  // An older payment link still open: count it if it was paid, otherwise close it (paying it later
  // must never be lost).
  if (existing?.status === 'awaiting-payment' && existing.linkId) {
    await settleLink(existing.linkId);
    existing = await getJob(identity.id);
    if (existing?.status === 'awaiting-payment') await rzp('POST', `/payment_links/${existing.linkId}/cancel`).catch(() => {});
  }
  if (existing?.status === 'running') throw new HttpError(409, 'Already moving', 'running');
  // Check the sign-in works before anyone pays.
  await serverAccessToken('gdrive', refreshToken);

  const items = await candidates(identity.id);
  if (!items.length) throw new HttpError(400, 'Nothing to move: everything is already in your own storage or stays in Lens.', 'nothing');
  const bytes = items.reduce((s, m) => s + m.size, 0);
  const { freeLeft, credit } = await profileCredit(identity.id);
  const { payGb, pricePaise } = priceFor(bytes, freeLeft, credit);
  const now = Date.now();
  const job: MoveJob = {
    ...jobKey(identity.id),
    sk: 'MOVE',
    status: pricePaise > 0 ? 'awaiting-payment' : 'running',
    storageId,
    folderId,
    token: await seal(refreshToken),
    allowanceBytes: Math.min(bytes, freeLeft + credit) + payGb * GB,
    freeBytes: Math.min(bytes, freeLeft),
    paidBytes: payGb * GB,
    pricePaise,
    totalItems: items.length,
    totalBytes: bytes,
    movedItems: 0,
    movedBytes: 0,
    failed: [],
    startedAt: now,
    updatedAt: now,
  };
  if (pricePaise > 0) {
    if (!(await razorpayConfigured())) throw new HttpError(503, 'Payments aren’t available yet', 'payments-off');
    const link = await rzp<{ id: string; short_url: string }>('POST', '/payment_links', {
      amount: pricePaise,
      currency: 'INR',
      accept_partial: false,
      description: `Lens: move ${payGb} GB to your Google Drive`,
      customer: { email: identity.email },
      notify: { email: true, sms: false },
      reminder_enable: false,
      expire_by: Math.floor(now / 1000) + 3 * 86400,
      reference_id: `move-${identity.id.slice(0, 20)}-${now}`,
      notes: { app: 'lens', account: identity.id, kind: 'drive-move', gb: String(payGb) },
      ...(env.webOrigin ? { callback_url: `${env.webOrigin}/paid/`, callback_method: 'get' } : {}),
    });
    job.linkId = link.id;
    job.payUrl = link.short_url;
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `RZPL#${link.id}`, sk: 'LINK', accountId: identity.id, createdAt: now } }));
  }
  await ddb.send(new PutCommand({ TableName: env.table, Item: job }));
  await audit({ entity: `account:${identity.id}`, action: 'move.started', actor: identity.id, data: { items: items.length, bytes, pricePaise } });
  if (job.status === 'running') await kick(identity.id);
  return json(200, { job: jobForClient(job) });
}

/** A paid payment link starts its move (webhook, the app coming back, or the 15-minute tick). */
export async function settleLink(linkId: string) {
  const row = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `RZPL#${linkId}`, sk: 'LINK' } }))).Item;
  if (!row?.accountId) return;
  const id = row.accountId as string;
  const job = await getJob(id);
  if (job?.status !== 'awaiting-payment' || job.linkId !== linkId) return;
  const link = await rzp<{ status: string; amount_paid: number; payments?: { payment_id: string }[] }>('GET', `/payment_links/${linkId}`);
  if (link.status !== 'paid') return;
  await patchJob(id, { status: 'running' }, ['payUrl']);
  await audit({ entity: `account:${id}`, action: 'move.paid', actor: 'razorpay', data: { linkId, paise: link.amount_paid } });
  await kick(id);
}

/** POST /v1/move/refresh: back from the payment page. */
export async function refreshMove(identity: Identity): Promise<Res> {
  const job = await getJob(identity.id);
  if (job?.status === 'awaiting-payment' && job.linkId) await settleLink(job.linkId);
  return getMove(identity);
}

/** POST /v1/move/cancel: stops after the current file; paid GB not used stay as credit. */
export async function cancelMove(identity: Identity): Promise<Res> {
  const job = await getJob(identity.id);
  if (job && (job.status === 'running' || job.status === 'awaiting-payment' || job.status === 'paused')) {
    if (job.status === 'awaiting-payment' && job.linkId) await rzp('POST', `/payment_links/${job.linkId}/cancel`).catch(() => {});
    await finish(identity.id, job, 'cancelled');
  }
  return getMove(identity);
}

export async function kick(id: string) {
  if (!env.maintenanceFunction) return;
  await lambda.send(new InvokeCommand({ FunctionName: env.maintenanceFunction, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify({ driveMove: id })) }));
}

/** Stop: forget the sign-in; free allowance used and paid GB left over go on the profile. */
async function finish(id: string, job: MoveJob, status: MoveJob['status'], reason?: MoveJob['reason']) {
  // Allowance = free part, then earlier credit, then what was paid for this job (used in that order).
  const paid = job.status !== 'awaiting-payment' ? job.paidBytes : 0;
  const creditPart = Math.max(0, job.allowanceBytes - job.freeBytes - job.paidBytes);
  const freeUsed = Math.min(job.freeBytes, job.movedBytes);
  const creditUsed = Math.min(creditPart, Math.max(0, job.movedBytes - job.freeBytes));
  const paidUsed = Math.max(0, job.movedBytes - job.freeBytes - creditPart);
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `D#${id}`, sk: 'PROFILE' },
      UpdateExpression: 'ADD moveFreeUsedBytes :f, moveCreditBytes :c',
      ExpressionAttributeValues: { ':f': freeUsed, ':c': Math.max(0, paid - paidUsed) - creditUsed },
    }),
  );
  await patchJob(id, { status, finishedAt: Date.now(), ...(reason ? { reason } : {}) }, ['token', 'payUrl']);
}

// ---------- the worker (Maintenance: { driveMove: <accountId> }) ----------

class DriveFull extends Error {}

async function driveFetch(token: () => Promise<string>, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await token()}` } });
  if (res.status === 403) {
    const text = await res.clone().text();
    if (/storageQuotaExceeded|quota/i.test(text)) throw new DriveFull();
  }
  return res;
}

async function ensureFolder(token: () => Promise<string>, known?: string): Promise<string> {
  if (known) {
    const r = await driveFetch(token, `${DRIVE}/files/${known}?fields=id,trashed`);
    if (r.ok && !((await r.json()) as { trashed?: boolean }).trashed) return known;
  }
  const q = encodeURIComponent(`name = 'Lens' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const found = await driveFetch(token, `${DRIVE}/files?q=${q}&fields=files(id)&spaces=drive`);
  const id = found.ok ? ((await found.json()) as { files?: { id: string }[] }).files?.[0]?.id : undefined;
  if (id) return id;
  const created = await driveFetch(token, `${DRIVE}/files?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Lens', mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!created.ok) throw new Error(`Drive folder: ${created.status}`);
  return ((await created.json()) as { id: string }).id;
}

function fileName(m: MediaRecord) {
  const d = new Date(m.createdAt);
  const p = (n: number) => String(n).padStart(2, '0');
  const ext = m.key.split('.').pop()?.slice(0, 5) || (m.kind === 'video' ? 'mp4' : 'jpg');
  return `Lens ${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}.${p(d.getUTCMinutes())}.${p(d.getUTCSeconds())} ${m.id.slice(-8)}.${ext}`;
}

/** S3 original → Drive (resumable, 16 MiB chunks) with our own MD5 checked against Drive's. */
async function copyOne(token: () => Promise<string>, folderId: string, m: MediaRecord): Promise<{ ref: string; md5: string }> {
  const start = await driveFetch(token, `${UPLOAD}/files?uploadType=resumable&fields=id,md5Checksum,size`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': m.contentType, 'x-upload-content-length': String(m.size) },
    body: JSON.stringify({ name: fileName(m), parents: [folderId], mimeType: m.contentType }),
  });
  if (!start.ok) throw new Error(`Drive upload start: ${start.status}`);
  const session = start.headers.get('location');
  if (!session) throw new Error('Drive gave no upload session');

  const obj = await s3.send(new GetObjectCommand({ Bucket: env.bucket, Key: m.key }));
  const md5 = createHash('md5');
  let offset = 0;
  let pending: Buffer[] = [];
  let pendingLen = 0;
  let file: { id: string; md5Checksum?: string; size?: string } | undefined;
  const send = async (last: boolean) => {
    const body = Buffer.concat(pending, pendingLen);
    pending = [];
    pendingLen = 0;
    const end = offset + body.length - 1;
    const res = await fetch(session, { method: 'PUT', headers: { 'content-range': `bytes ${offset}-${end}/${m.size}` }, body });
    if (res.status === 308) {
      offset = end + 1;
      return;
    }
    if ((res.status === 200 || res.status === 201) && last) {
      file = (await res.json()) as typeof file;
      offset = end + 1;
      return;
    }
    const text = await res.text().catch(() => '');
    if (res.status === 403 && /storageQuotaExceeded|quota/i.test(text)) throw new DriveFull();
    throw new Error(`Drive upload: ${res.status} ${text.slice(0, 120)}`);
  };
  for await (const chunk of obj.Body as Readable) {
    const b = chunk as Buffer;
    md5.update(b);
    pending.push(b);
    pendingLen += b.length;
    while (pendingLen >= CHUNK && offset + pendingLen < m.size) {
      // Send exactly CHUNK bytes, keep the rest.
      const all = Buffer.concat(pending, pendingLen);
      pending = [all.subarray(0, CHUNK)];
      pendingLen = CHUNK;
      const rest = all.subarray(CHUNK);
      await send(false);
      pending = [rest];
      pendingLen = rest.length;
    }
  }
  await send(true);
  const hex = md5.digest('hex');
  if (!file || file.md5Checksum !== hex || Number(file.size) !== m.size) {
    if (file?.id) await driveFetch(token, `${DRIVE}/files/${file.id}`, { method: 'DELETE' }).catch(() => {});
    throw new Error('Drive stored a different file (checksum mismatch)');
  }
  return { ref: file.id, md5: hex };
}

/** Moves files until done or the deadline; returns true when the job stopped (done/paused). */
export async function runMove(id: string, deadline: number): Promise<boolean> {
  const job = await getJob(id);
  if (!job || job.status !== 'running' || !job.token) return true;
  const storage = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: `ST#${job.storageId}` } }))).Item;
  if (storage?.provider !== 'gdrive') {
    await finish(id, job, 'paused', 'signed-out');
    return true;
  }
  let refresh = await unseal(job.token);
  let access: { token: string; until: number } | undefined;
  const token = async () => {
    if (!access || access.until < Date.now()) {
      const t = await serverAccessToken('gdrive', refresh);
      if (t.refreshToken && t.refreshToken !== refresh) {
        refresh = t.refreshToken;
        await patchJob(id, { token: await seal(refresh) });
      }
      access = { token: t.accessToken, until: t.expiresAt };
    }
    return access.token;
  };

  let folderId: string;
  try {
    folderId = await ensureFolder(token, job.folderId);
  } catch (e: any) {
    const signedOut = e instanceof HttpError && e.code === 'signed-out';
    await finish(id, job, 'paused', signedOut ? 'signed-out' : 'error');
    await tell(id, job, signedOut ? 'signed-out' : 'error');
    return true;
  }
  if (folderId !== job.folderId) await patchJob(id, { folderId });

  const failed = new Set(job.failed);
  let { movedItems, movedBytes } = job;
  for (const m of await candidates(id)) {
    if (failed.has(m.id)) continue;
    if (movedBytes + m.size > job.allowanceBytes) {
      // Paid for less than there is now (new photos since): stop here, the rest stays in Lens.
      await finish(id, { ...job, movedItems, movedBytes }, 'done', 'allowance');
      await tell(id, { ...job, movedItems, movedBytes }, 'done');
      return true;
    }
    // Leave time for this file (≥ 20 MB/s) and the bookkeeping.
    if (Date.now() + 30_000 + (m.size / (20 * 1024 * 1024)) * 1000 > deadline) return false;
    if (await isShared(id, m.id)) continue;
    try {
      const { ref, md5 } = await copyOne(token, folderId, m);
      try {
        await ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: env.table,
                  Key: { pk: m.pk, sk: m.sk },
                  UpdateExpression: 'SET #loc = :loc, movedAt = :now',
                  ConditionExpression: '#s = :ready AND attribute_not_exists(#loc) AND attribute_not_exists(deletedAt)',
                  ExpressionAttributeNames: { '#loc': 'location', '#s': 'status' },
                  ExpressionAttributeValues: { ':loc': { storageId: job.storageId, provider: 'gdrive', ref, checksum: `md5:${md5}` }, ':ready': 'ready', ':now': Date.now() },
                },
              },
              { Update: { TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' }, UpdateExpression: 'ADD usedBytes :neg', ExpressionAttributeValues: { ':neg': -m.size } } },
            ],
          }),
        );
      } catch (e: any) {
        // Deleted or changed meanwhile: take the copy back out of their Drive.
        await driveFetch(token, `${DRIVE}/files/${ref}`, { method: 'DELETE' }).catch(() => {});
        if (e?.name === 'TransactionCanceledException') continue;
        throw e;
      }
      // The bucket is versioned: the original stays recoverable for 30 days, then it's gone.
      await s3.send(new DeleteObjectCommand({ Bucket: env.bucket, Key: m.key }));
      movedItems++;
      movedBytes += m.size;
      await patchJob(id, { movedItems, movedBytes });
    } catch (e: any) {
      if (e instanceof DriveFull) {
        await finish(id, { ...job, movedItems, movedBytes }, 'paused', 'drive-full');
        await tell(id, { ...job, movedItems, movedBytes }, 'drive-full');
        return true;
      }
      if (e instanceof HttpError && e.code === 'signed-out') {
        await finish(id, { ...job, movedItems, movedBytes }, 'paused', 'signed-out');
        await tell(id, { ...job, movedItems, movedBytes }, 'signed-out');
        return true;
      }
      console.error('move', id, m.id, e);
      failed.add(m.id);
      await patchJob(id, { failed: [...failed].slice(-500) });
    }
  }
  await finish(id, { ...job, movedItems, movedBytes }, 'done');
  await tell(id, { ...job, movedItems, movedBytes }, 'done');
  await audit({ entity: `account:${id}`, action: 'move.done', actor: 'system', data: { movedItems, movedBytes, failed: failed.size } });
  return true;
}

const gbText = (b: number) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

async function tell(id: string, job: MoveJob, what: 'done' | 'drive-full' | 'signed-out' | 'error') {
  const msg =
    what === 'done'
      ? { title: 'Moved to your Google Drive', body: `${job.movedItems} photos and videos (${gbText(job.movedBytes)}) are now in the Lens folder of your Google Drive. Your gallery looks the same.` }
      : what === 'drive-full'
        ? { title: 'Your Google Drive is full', body: `${job.movedItems} items moved. Free up space in Google Drive, then tap Continue in Settings → Storage.` }
        : what === 'signed-out'
          ? { title: 'Google Drive needs you to sign in again', body: `${job.movedItems} items moved. Sign in to Google Drive in Settings → Storage, then tap Continue.` }
          : { title: 'Moving to Google Drive stopped', body: `${job.movedItems} items moved. Tap Continue in Settings → Storage to try again.` };
  await notify(id, 'storage', { ...msg, route: '/storage' }).catch(() => {});
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' }, ProjectionExpression: 'email' }))).Item;
  if (p?.email) await email(p.email, msg.title, `${msg.body}\n\n— Lens`).catch(() => {});
}

/** Maintenance tick: running jobs that stopped hearing from their worker (crash, timeout). */
export async function resumeStalled(rows: { pk: string; sk: string; status?: string; updatedAt?: number }[], now = Date.now()) {
  let n = 0;
  for (const r of rows) {
    if (r.sk !== 'MOVE' || r.status !== 'running' || (r.updatedAt ?? 0) > now - 20 * 60_000) continue;
    await kick(String(r.pk).slice(2));
    n++;
  }
  return n;
}

/** Maintenance tick: payment links paid while no webhook arrived. */
export async function settleAwaiting(rows: { pk: string; sk: string; status?: string; linkId?: string; updatedAt?: number }[], now = Date.now()) {
  for (const r of rows) {
    if (r.sk !== 'MOVE' || r.status !== 'awaiting-payment' || !r.linkId || (r.updatedAt ?? 0) < now - 4 * 86_400_000) continue;
    await settleLink(r.linkId).catch((e) => console.error('settle', e));
  }
}
