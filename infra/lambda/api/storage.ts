// Where originals are stored: Lens storage (S3, 100 GB free) and the user's
// own connected storages (Google Drive, Dropbox, …). The phone talks to the
// providers directly; this API only keeps what Lens needs to know: which
// storages are connected, their health (as last reported), and requests for
// providers we don't support yet. Free plan: sign-ins never reach the server.
import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, env, HttpError, json, quotaFor, Req, Res } from './lib';

export const PROVIDERS = ['gdrive', 'dropbox', 'onedrive', 'box', 's3', 'webdav', 'icloud'] as const;
export type Provider = (typeof PROVIDERS)[number];
export type StorageStatus = 'ok' | 'low' | 'full' | 'signed-out' | 'error';
const STATUSES: StorageStatus[] = ['ok', 'low', 'full', 'signed-out', 'error'];

/** Free plan: one connected storage. */
const FREE_STORAGE_LIMIT = 1;
/** Lens storage presentation: the newest 20 GB are "Recent", the rest "Saver" (all instant). */
export const RECENT_BYTES = 20 * 1024 ** 3;
const STORAGE_ID = /^[a-z0-9-]{4,40}$/;
const MAX_REQUESTS_PER_IDENTITY = 20;

export type StorageRecord = {
  pk: string;
  sk: string;
  storageId: string;
  provider: Provider;
  /** What the user sees, e.g. "Google Drive" or "My NAS". */
  label: string;
  /** Account shown in settings (email, user name, bucket…). */
  account?: string;
  status: StorageStatus;
  usedBytes?: number;
  totalBytes?: number;
  checkedAt: number;
  createdAt: number;
};

const storageKey = (identityId: string, storageId: string) => ({ pk: `D#${identityId}`, sk: `ST#${storageId}` });

function text(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, 'Invalid text');
  return value.trim();
}

function bytes(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new HttpError(400, 'Invalid size');
  return Math.round(value);
}

export async function listStorages(identityId: string): Promise<StorageRecord[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
      ExpressionAttributeValues: { ':p': `D#${identityId}`, ':s': 'ST#' },
    }),
  );
  return (result.Items ?? []) as StorageRecord[];
}

const toClient = (s: StorageRecord) => ({
  id: s.storageId,
  provider: s.provider,
  label: s.label,
  account: s.account,
  status: s.status,
  usedBytes: s.usedBytes,
  totalBytes: s.totalBytes,
  checkedAt: s.checkedAt,
  createdAt: s.createdAt,
});

/** GET /v1/storage: Lens storage usage + connected storages. */
export async function getStorage(identity: Identity): Promise<Res> {
  const storages = await listStorages(identity.id);
  return json(200, {
    plan: 'free',
    // Guests: 5 GB until they sign in (then signedInQuotaBytes).
    lens: { usedBytes: identity.usedBytes, quotaBytes: quotaFor(identity), recentBytes: RECENT_BYTES, signedInQuotaBytes: env.quotaBytes },
    signedIn: !!identity.email,
    storages: storages.sort((a, b) => a.createdAt - b.createdAt).map(toClient),
    limits: { storages: FREE_STORAGE_LIMIT, routing: false },
  });
}

/**
 * PUT /v1/storages/:id: the phone connected a storage or reports its health
 * (status, space). Free plan: one storage at a time (409 code "plan-limit").
 */
export async function putStorage(identity: Identity, storageId: string, req: Req): Promise<Res> {
  if (!STORAGE_ID.test(storageId)) throw new HttpError(400, 'Invalid storage id');
  const provider = req.body.provider as Provider;
  if (!PROVIDERS.includes(provider)) throw new HttpError(400, 'Unknown provider');
  const status = (req.body.status ?? 'ok') as StorageStatus;
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Invalid status');

  const existing = await listStorages(identity.id);
  const current = existing.find((s) => s.storageId === storageId);
  if (!current && existing.length >= FREE_STORAGE_LIMIT) {
    return json(409, { error: 'The free plan can connect one storage. Disconnect the current one first.', code: 'plan-limit' });
  }
  if (current && current.provider !== provider) throw new HttpError(409, 'Storage id belongs to another provider');

  const now = Date.now();
  const record: StorageRecord = {
    ...storageKey(identity.id, storageId),
    storageId,
    provider,
    label: text(req.body.label, 60) ?? current?.label ?? provider,
    account: text(req.body.account, 200) ?? current?.account,
    status,
    usedBytes: bytes(req.body.usedBytes) ?? current?.usedBytes,
    totalBytes: bytes(req.body.totalBytes) ?? current?.totalBytes,
    checkedAt: now,
    createdAt: current?.createdAt ?? now,
  };
  await ddb.send(new PutCommand({ TableName: env.table, Item: record }));
  return json(current ? 200 : 201, { storage: toClient(record) });
}

/** DELETE /v1/storages/:id: disconnect (files in their storage are untouched). */
export async function deleteStorage(identity: Identity, storageId: string): Promise<Res> {
  if (!STORAGE_ID.test(storageId)) throw new HttpError(400, 'Invalid storage id');
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: storageKey(identity.id, storageId) }));
  return json(200, { disconnected: storageId });
}

/** POST /v1/provider-requests {provider, note?}: "please support my storage". */
export async function requestProvider(identity: Identity, req: Req): Promise<Res> {
  const provider = text(req.body.provider, 80);
  const note = text(req.body.note, 500);
  if (!provider) throw new HttpError(400, 'Tell us which storage you use');

  const mine = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :r)',
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':r': 'RQ#' },
      Select: 'COUNT',
    }),
  );
  if ((mine.Count ?? 0) >= MAX_REQUESTS_PER_IDENTITY) throw new HttpError(429, 'Thanks, we already have your requests');

  const now = Date.now();
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: {
        pk: `D#${identity.id}`,
        sk: `RQ#${now}`,
        provider,
        note,
        name: identity.name,
        createdAt: now,
        // All requests in one index partition, newest last, for our review.
        gsi1pk: 'PROVIDER_REQUEST',
        gsi1sk: `${provider.toLowerCase()}#${now}`,
      },
    }),
  );
  return json(201, { requested: provider });
}
