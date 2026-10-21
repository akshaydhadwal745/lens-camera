// Over the storage limit (owner decisions 2026-10-21; docs/business/payments.md):
//  - Nothing is blocked or deleted at first: everything stays viewable, downloadable and shareable;
//    only NEW backups to Lens pause (lib.ts checkQuota). New photos wait on the phone.
//  - PROFILE.overLimitSince records when it started; it clears as soon as they're under the limit
//    again (paid, invited friends, deleted things, moved to their own storage).
//  - After 5 months over the limit, what's above it is deleted: first what's already in their Trash,
//    then their most recent backups (what they added while paying), until they're within the limit.
//    Notices before: 90, 30, 7 and 1 days (push + email; lifecycle.ts), plus monthly reminders.
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { audit } from './audit';
import { ddb, env, quotaFor } from './lib';
import { destroyMedia } from './trash';
import type { MediaRecord } from './media';
import { deletionAt } from './plans';

export { deletionAt };

const MAX_DELETE_PER_RUN = 2000;


type Profile = Record<string, any>;

/** Starts or clears the over-limit clock for one account. Returns its state after. */
export async function trackOverLimit(id: string, p: Profile, now = Date.now()): Promise<'over' | 'ok'> {
  if (!p.email) return 'ok';
  const over = (p.usedBytes ?? 0) > quotaFor(p, now);
  if (over && !p.overLimitSince) {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${id}`, sk: 'PROFILE' },
        UpdateExpression: 'SET overLimitSince = if_not_exists(overLimitSince, :n)',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeValues: { ':n': now },
      }),
    );
    p.overLimitSince = now;
    await audit({ entity: `account:${id}`, action: 'storage.over-limit', actor: 'system', data: { used: p.usedBytes, quota: quotaFor(p, now) } });
  } else if (!over && p.overLimitSince) {
    await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' }, UpdateExpression: 'REMOVE overLimitSince' }));
    p.overLimitSince = undefined;
  }
  return over ? 'over' : 'ok';
}

async function mediaOf(id: string): Promise<MediaRecord[]> {
  const out: MediaRecord[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)', ExpressionAttributeValues: { ':p': `D#${id}`, ':m': 'M#' }, ExclusiveStartKey: start }),
    );
    out.push(...((r.Items ?? []) as MediaRecord[]));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/**
 * The deletion day came and they're still over: delete what's above the limit. Re-reads the profile
 * first (a payment may have just arrived) and stops the moment they're within it.
 */
export async function deleteAboveLimit(id: string, now = Date.now()): Promise<{ deleted: number; bytes: number }> {
  const fresh = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' } }))).Item;
  if (!fresh?.email || !fresh.overLimitSince || now < deletionAt(fresh.overLimitSince)) return { deleted: 0, bytes: 0 };
  const quota = quotaFor(fresh, now);
  let used = fresh.usedBytes ?? 0;
  if (used <= quota) return { deleted: 0, bytes: 0 };
  const items = (await mediaOf(id)).filter((m) => !m.location && !m.archived && !m.ownerHidden && !(m as { recap?: string }).recap);
  // Trash first (they chose to delete those), then the most recent backups.
  const order = [
    ...items.filter((m) => m.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    ...items.filter((m) => !m.deletedAt && m.status === 'ready').sort((a, b) => (b.uploadedAt ?? b.createdAt ?? 0) - (a.uploadedAt ?? a.createdAt ?? 0)),
  ];
  let deleted = 0;
  let bytes = 0;
  for (const m of order) {
    if (used <= quota || deleted >= MAX_DELETE_PER_RUN) break;
    await destroyMedia(m);
    used -= m.size ?? 0;
    bytes += m.size ?? 0;
    deleted++;
  }
  await audit({ entity: `account:${id}`, action: 'storage.deleted-above-limit', actor: 'system', data: { deleted, bytes, quota, overLimitSince: fresh.overLimitSince } });
  return { deleted, bytes };
}
