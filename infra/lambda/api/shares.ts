import { BatchGetCommand, BatchWriteCommand, DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, decodeCursor, encodeCursor, env, HttpError, json, Req, Res } from './lib';
import { MediaRecord, mediaKey, toClient } from './media';
import { archiveIfOrphaned } from './trash';

const MAX_MEDIA = 50;
const MAX_RECIPIENTS = 20;

async function batchGet(keys: { pk: string; sk: string }[]): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    let request: Record<string, any> | undefined = { [env.table]: { Keys: keys.slice(i, i + 100) } };
    while (request && Object.keys(request).length) {
      const result: any = await ddb.send(new BatchGetCommand({ RequestItems: request }));
      out.push(...(result.Responses?.[env.table] ?? []));
      request = result.UnprocessedKeys;
    }
  }
  return out;
}

async function batchWrite(items: Record<string, any>[]) {
  for (let i = 0; i < items.length; i += 25) {
    let request: Record<string, any> | undefined = {
      [env.table]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })),
    };
    while (request && Object.keys(request).length) {
      const result: any = await ddb.send(new BatchWriteCommand({ RequestItems: request }));
      request = result.UnprocessedItems;
    }
  }
}

/** POST /v1/shares {mediaIds, to}: share own media with other identities. */
export async function share(identity: Identity, req: Req): Promise<Res> {
  const mediaIds = unique(req.body.mediaIds).slice(0, MAX_MEDIA);
  const to = unique(req.body.to).filter((id) => id !== identity.id).slice(0, MAX_RECIPIENTS);
  if (!mediaIds.length || !to.length) throw new HttpError(400, 'Choose media and at least one person');

  const media = (await batchGet(mediaIds.map((id) => mediaKey(identity.id, id)))) as MediaRecord[];
  const ready = media.filter((m) => m.status === 'ready' && !m.deletedAt && !m.ownerHidden);
  if (!ready.length) throw new HttpError(404, 'Nothing to share yet: items must finish uploading first');

  const recipients = await batchGet(to.map((id) => ({ pk: `D#${id}`, sk: 'PROFILE' })));
  if (!recipients.length) throw new HttpError(404, 'Recipient not found');

  const now = Date.now();
  const writes: Record<string, any>[] = [];
  for (const r of recipients) {
    const rid = (r.pk as string).slice(2);
    for (const m of ready) {
      writes.push({
        pk: `D#${rid}`,
        sk: `S#${m.id}#${identity.id}`, // media ids are time-sortable
        ownerId: identity.id,
        ownerName: identity.name,
        mediaId: m.id,
        key: m.key,
        kind: m.kind,
        size: m.size,
        width: m.width,
        height: m.height,
        duration: m.duration,
        createdAt: m.createdAt,
        previewReady: !!m.previewReady,
        sharedAt: now,
        gsi1pk: `SM#${identity.id}#${m.id}`,
        gsi1sk: `D#${rid}`,
      });
    }
    // Share history in both directions, so either side can pick the other from "recent".
    writes.push({ pk: `D#${identity.id}`, sk: `C#${rid}`, name: r.name, lastAt: now });
    writes.push({ pk: `D#${rid}`, sk: `C#${identity.id}`, name: identity.name, lastAt: now });
  }
  await batchWrite(writes);

  return json(200, { shared: ready.length, recipients: recipients.map((r) => r.name) });
}

/** GET /v1/shared?cursor=: media others have shared with this identity. */
export async function sharedWithMe(identity: Identity, req: Req): Promise<Res> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':s': 'S#' },
      ScanIndexForward: false,
      Limit: 100,
      ExclusiveStartKey: decodeCursor(req.query.cursor),
    }),
  );
  // Shares follow the owner's current look (edits re-render previews).
  const owners = await batchGet((result.Items ?? []).map((s) => mediaKey(s.ownerId, s.mediaId)));
  const current = new Map(owners.map((m) => [`${(m.pk as string).slice(2)}#${m.id}`, m as MediaRecord]));
  // Items the owner deleted for everyone (Trash/Archive) disappear for recipients too.
  const shareItems = (result.Items ?? []).filter((s) => {
    const m = current.get(`${s.ownerId}#${s.mediaId}`);
    return m && !m.deletedAt;
  });
  const items = await Promise.all(
    shareItems.map(async (s) => ({
      ...(await toClient({
        ...(s as any),
        id: s.mediaId,
        status: 'ready',
        derivVersion: current.get(`${s.ownerId}#${s.mediaId}`)?.derivVersion,
        edit: current.get(`${s.ownerId}#${s.mediaId}`)?.edit,
      })),
      ownerId: s.ownerId,
      ownerName: s.ownerName,
      sharedAt: s.sharedAt,
    })),
  );
  return json(200, { items, cursor: encodeCursor(result.LastEvaluatedKey) });
}

/** DELETE /v1/shared/:ownerId/:mediaId: hide a shared item from my list. */
export async function removeShared(identity: Identity, ownerId: string, mediaId: string): Promise<Res> {
  await ddb.send(
    new DeleteCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `S#${mediaId}#${ownerId}` } }),
  );
  await archiveIfOrphaned(ownerId, mediaId); // owner deleted it "only for me" and nobody else has it now
  return json(200, { removed: mediaId });
}

function unique(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length < 64))];
}

