// Delete → Trash (30 days, free instant restore) → Archive (1 year, recover in
// ~12 hours) → purged. Deleting is logical: the original stays in S3 until the
// archive year ends or the user picks "Delete forever".
//
// Archive = S3 Intelligent-Tiering's opt-in Deep Archive Access tier, applied
// only to objects tagged `lens-archive=1` (bucket config in lens-stack.ts).
// The tag is added when the Trash period ends, never earlier, so items in the
// Trash stay instantly restorable. No transition fees, no retrieval fees.
//
// Quota: an item counts while it's ready, visible to its owner and not
// archived. Trash still counts; "only for me" and archived items don't.
import {
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
  DeleteObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectTaggingCommand,
  RestoreObjectCommand,
} from '@aws-sdk/client-s3';
import { BatchWriteCommand, DeleteCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, decodeCursor, encodeCursor, env, HttpError, json, Req, Res, s3 } from './lib';
import { derivativeKey, getMedia, mediaKey, MediaRecord, requireMedia, toClient } from './media';
import { streamPrefix } from './stream';

const DAY = 24 * 3600 * 1000;
export const TRASH_DAYS = 30;
export const ARCHIVE_DAYS = 365;
const TRASH_GSI = 'TRASH';
export const ARCHIVE_TAG = { Key: 'lens-archive', Value: '1' };

export type Phase = 'trash' | 'archive' | 'recovering';

const ownerOf = (item: MediaRecord) => item.pk.slice(2);
const profileKey = (ownerId: string) => ({ pk: `D#${ownerId}`, sk: 'PROFILE' });
const trashSortKey = (deletedAt: number, ownerId: string, id: string) =>
  `${String(deletedAt).padStart(15, '0')}#${ownerId}#${id}`;

/** Bytes this item currently adds to its owner's quota. */
function countedBytes(item: MediaRecord): number {
  if (item.location) return 0; // original is in the user's own storage
  return item.status === 'ready' && !item.ownerHidden && !item.archived ? item.size : 0;
}

function phaseOf(item: MediaRecord): Phase {
  if (item.recoveringSince) return 'recovering';
  return item.archived ? 'archive' : 'trash';
}

async function hasShares(ownerId: string, id: string): Promise<boolean> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :g',
      ExpressionAttributeValues: { ':g': `SM#${ownerId}#${id}` },
      Limit: 1,
    }),
  );
  return !!result.Items?.length;
}

async function deleteShares(ownerId: string, id: string) {
  const shares = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      IndexName: 'gsi1',
      KeyConditionExpression: 'gsi1pk = :g',
      ExpressionAttributeValues: { ':g': `SM#${ownerId}#${id}` },
      ProjectionExpression: 'pk, sk',
    }),
  );
  const keys = (shares.Items ?? []).map((s) => ({ DeleteRequest: { Key: { pk: s.pk, sk: s.sk } } }));
  for (let i = 0; i < keys.length; i += 25) {
    await ddb.send(new BatchWriteCommand({ RequestItems: { [env.table]: keys.slice(i, i + 25) } }));
  }
}

/** Deletes every S3 version (and delete marker) under a prefix. */
async function deleteAllVersions(prefix: string) {
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectVersionsCommand({ Bucket: env.bucket, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionMarker }),
    );
    const objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map((v) => ({ Key: v.Key!, VersionId: v.VersionId }));
    if (objects.length) {
      await s3.send(new DeleteObjectsCommand({ Bucket: env.bucket, Delete: { Objects: objects, Quiet: true } }));
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);
}

/** Permanently removes an item: all object versions, derivatives, record and shares. */
async function destroy(item: MediaRecord) {
  const ownerId = ownerOf(item);
  if (item.uploadId) {
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: env.bucket, Key: item.key, UploadId: item.uploadId }))
      .catch(() => {});
  }
  await deleteAllVersions(item.key);
  await deleteAllVersions(streamPrefix(item.key)); // HLS streaming copies, if any
  await deleteAllVersions(derivativeKey(item.key, 'thumb').replace(/thumb\.jpg$/, ''));
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: mediaKey(ownerId, item.id) }));
  const bytes = countedBytes(item);
  if (bytes) {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: profileKey(ownerId),
        UpdateExpression: 'ADD usedBytes :neg',
        ExpressionAttributeValues: { ':neg': -bytes },
      }),
    );
  }
  await deleteShares(ownerId, item.id);
}

/** Updates the media record and the owner's quota together (or neither). */
async function updateWithQuota(
  item: MediaRecord,
  update: { expression: string; condition: string; names?: Record<string, string>; values?: Record<string, unknown> },
  quotaDelta: number,
) {
  const ownerId = ownerOf(item);
  const mediaUpdate = {
    Update: {
      TableName: env.table,
      Key: mediaKey(ownerId, item.id),
      UpdateExpression: update.expression,
      ConditionExpression: update.condition,
      ExpressionAttributeNames: update.names,
      ExpressionAttributeValues: update.values,
    },
  };
  try {
    if (!quotaDelta) {
      await ddb.send(new UpdateCommand(mediaUpdate.Update));
      return true;
    }
    await ddb.send(
      new TransactWriteCommand({
        TransactItems: [
          mediaUpdate,
          {
            Update: {
              TableName: env.table,
              Key: profileKey(ownerId),
              UpdateExpression: 'ADD usedBytes :d',
              ExpressionAttributeValues: { ':d': quotaDelta },
            },
          },
        ],
      }),
    );
    return true;
  } catch (error: any) {
    // Another request changed the item first; nothing to do.
    if (error?.name === 'ConditionalCheckFailedException' || error?.name === 'TransactionCanceledException') return false;
    throw error;
  }
}

function checkQuota(identity: Identity, bytes: number) {
  if (bytes > 0 && identity.usedBytes + bytes > env.quotaBytes) {
    throw new HttpError(413, 'Not enough cloud storage to bring this back. Free up some space first.');
  }
}

/**
 * DELETE /v1/media/:id?scope=everyone|me
 * Shared items need a scope (409 code "shared" without one):
 * - everyone: to Trash; people it was shared with stop seeing it.
 * - me: hidden from the owner and off their quota; recipients keep it. When
 *   the last recipient removes it, it goes straight to the Archive.
 * Unfinished uploads are deleted outright (there's no original to keep).
 */
export async function deleteMedia(identity: Identity, id: string, req: Req): Promise<Res> {
  const item = await requireMedia(identity, id);
  const scope = req.query.scope;
  if (scope !== undefined && scope !== 'everyone' && scope !== 'me') throw new HttpError(400, 'Invalid scope');
  if (item.deletedAt) return json(200, { deleted: id, phase: phaseOf(item) });

  if (item.status !== 'ready') {
    await destroy(item);
    return json(200, { deleted: id, phase: 'gone' });
  }

  const shared = await hasShares(identity.id, id);
  if (shared && !scope) return json(409, { error: 'This item is shared', code: 'shared' });

  if (shared && scope === 'me') {
    if (!item.ownerHidden) {
      await updateWithQuota(
        item,
        { expression: 'SET ownerHidden = :t', condition: 'attribute_not_exists(ownerHidden)', values: { ':t': true } },
        -countedBytes(item),
      );
    }
    return json(200, { deleted: id, phase: 'hidden' });
  }

  const now = Date.now();
  await updateWithQuota(
    item,
    {
      expression: 'SET deletedAt = :now, gsi1pk = :g, gsi1sk = :s',
      condition: 'attribute_not_exists(deletedAt)',
      values: { ':now': now, ':g': TRASH_GSI, ':s': trashSortKey(now, identity.id, id) },
    },
    0, // Trash still counts toward the quota.
  );
  return json(200, { deleted: id, phase: 'trash' });
}

/** Called after a recipient removes a share: an "only for me" item nobody has left goes to the Archive. */
export async function archiveIfOrphaned(ownerId: string, mediaId: string) {
  const item = await getMedia(ownerId, mediaId);
  if (!item?.ownerHidden || item.deletedAt) return;
  if (await hasShares(ownerId, mediaId)) return;
  // Backdate past the Trash period: the owner already chose to delete it.
  const deletedAt = Date.now() - TRASH_DAYS * DAY;
  await updateWithQuota(
    item,
    {
      expression: 'SET deletedAt = :d, gsi1pk = :g, gsi1sk = :s',
      condition: 'attribute_not_exists(deletedAt)',
      values: { ':d': deletedAt, ':g': TRASH_GSI, ':s': trashSortKey(deletedAt, ownerId, mediaId) },
    },
    0,
  );
}

async function toTrashClient(item: MediaRecord) {
  const phase = phaseOf(item);
  const base = await toClient({ ...item, status: phase === 'trash' ? item.status : 'pending' }); // no original URL once archived
  return {
    ...base,
    phase,
    deletedAt: item.deletedAt!,
    trashUntil: item.deletedAt! + TRASH_DAYS * DAY,
    purgeAt: item.deletedAt! + (TRASH_DAYS + ARCHIVE_DAYS) * DAY,
    recoveringSince: item.recoveringSince,
  };
}

/** GET /v1/trash?cursor=: deleted items (Trash, Archive, recovering), newest first. */
export async function listTrash(identity: Identity, req: Req): Promise<Res> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :m)',
      FilterExpression: 'attribute_exists(deletedAt)',
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':m': 'M#' },
      ScanIndexForward: false,
      Limit: 200,
      ExclusiveStartKey: decodeCursor(req.query.cursor),
    }),
  );
  const items: MediaRecord[] = [];
  for (const item of result.Items as MediaRecord[]) {
    // Finished recoveries are back in the library.
    if (item.recoveringSince && (await finishRecoveryIfReady(item))) continue;
    items.push(item);
  }
  return json(200, { items: await Promise.all(items.map(toTrashClient)), cursor: encodeCursor(result.LastEvaluatedKey) });
}

/** Puts an item back in the library (and on its owner's quota). */
async function undelete(item: MediaRecord): Promise<boolean> {
  const restored = await updateWithQuota(
    item,
    {
      expression: 'REMOVE deletedAt, gsi1pk, gsi1sk, ownerHidden, archived, recoveringSince',
      condition: 'attribute_exists(deletedAt)',
    },
    item.status === 'ready' ? item.size - countedBytes(item) : 0,
  );
  if (restored && item.archived) {
    await s3.send(new DeleteObjectTaggingCommand({ Bucket: env.bucket, Key: item.key })).catch(() => {});
  }
  return restored;
}

/** True once the original is readable again (restore finished, or it never left the instant tiers). */
async function originalReadable(item: MediaRecord): Promise<boolean> {
  const head = await s3.send(new HeadObjectCommand({ Bucket: env.bucket, Key: item.key }));
  return !head.ArchiveStatus || /ongoing-request="false"/.test(head.Restore ?? '');
}

async function finishRecoveryIfReady(item: MediaRecord): Promise<boolean> {
  if (!(await originalReadable(item))) return false;
  await undelete(item);
  return true;
}

/**
 * POST /v1/media/:id/restore
 * Trash: back instantly, free. Archive: starts a recovery (~12 hours) unless
 * S3 hasn't actually moved the object to the archive tier yet.
 * Payment for archive recovery comes later; free while testing.
 */
export async function restoreMedia(identity: Identity, id: string): Promise<Res> {
  const item = await requireMedia(identity, id);
  if (!item.deletedAt) return json(200, { phase: 'restored', media: await toClient(item) });

  const regained = item.status === 'ready' ? item.size - countedBytes(item) : 0;
  if (!item.recoveringSince) checkQuota(identity, regained);

  if (!item.archived) {
    await undelete(item);
    return json(200, { phase: 'restored', media: await toClient(item) });
  }

  if (await finishRecoveryIfReady(item)) {
    return json(200, { phase: 'restored', media: await toClient(item) });
  }
  if (!item.recoveringSince) {
    try {
      // Intelligent-Tiering archive objects: no Days; restore is free.
      await s3.send(
        new RestoreObjectCommand({
          Bucket: env.bucket,
          Key: item.key,
          RestoreRequest: { GlacierJobParameters: { Tier: 'Standard' } },
        }),
      );
    } catch (error: any) {
      if (error?.name !== 'RestoreAlreadyInProgress') throw error;
    }
    item.recoveringSince = Date.now();
    await updateWithQuota(
      item,
      { expression: 'SET recoveringSince = :n', condition: 'attribute_exists(deletedAt)', values: { ':n': item.recoveringSince } },
      0,
    );
  }
  return json(202, { phase: 'recovering', item: await toTrashClient(item) });
}

/** DELETE /v1/media/:id/forever: gone everywhere, all versions. Cannot be undone. */
export async function deleteForever(identity: Identity, id: string): Promise<Res> {
  const item = await requireMedia(identity, id);
  await destroy(item);
  return json(200, { deleted: id, phase: 'gone' });
}

/**
 * Daily job: move expired Trash items to the Archive, finish recoveries, and
 * purge items whose archive year is over.
 */
export async function runMaintenance(now = Date.now(), onlyOwner?: string) {
  const stats = { archived: 0, recovered: 0, purged: 0, errors: 0 };
  const archiveBefore = now - TRASH_DAYS * DAY;
  const purgeBefore = now - (TRASH_DAYS + ARCHIVE_DAYS) * DAY;
  let cursor: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        IndexName: 'gsi1',
        KeyConditionExpression: 'gsi1pk = :g AND gsi1sk < :s',
        ExpressionAttributeValues: { ':g': TRASH_GSI, ':s': trashSortKey(archiveBefore, '~', '') },
        ExclusiveStartKey: cursor,
      }),
    );
    for (const indexed of (page.Items ?? []) as MediaRecord[]) {
      try {
        if (onlyOwner && ownerOf(indexed) !== onlyOwner) continue; // test runs touch only their own identity
        // Re-read: the index can lag behind restores.
        const item = await getMedia(ownerOf(indexed), indexed.id);
        if (!item?.deletedAt) continue;
        if (item.recoveringSince) {
          if (await finishRecoveryIfReady(item)) stats.recovered++;
        } else if (item.deletedAt < purgeBefore) {
          await destroy(item);
          stats.purged++;
        } else if (item.location && item.deletedAt < archiveBefore) {
          // Their storage keeps its own trash; we don't hold the bytes to archive.
          await destroy(item);
          stats.purged++;
        } else if (!item.archived && item.deletedAt < archiveBefore) {
          await s3.send(new PutObjectTaggingCommand({ Bucket: env.bucket, Key: item.key, Tagging: { TagSet: [ARCHIVE_TAG] } }));
          await updateWithQuota(
            item,
            { expression: 'SET archived = :t', condition: 'attribute_not_exists(archived)', values: { ':t': true } },
            -countedBytes(item),
          );
          stats.archived++;
        }
      } catch (error) {
        stats.errors++;
        console.error('maintenance', indexed.pk, indexed.id, error);
      }
    }
    cursor = page.LastEvaluatedKey;
  } while (cursor);
  return stats;
}
