import { BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, env, HttpError, json, randomId, rateLimit, Req, Res } from './lib';
import { MediaRecord, mediaKey, toClient } from './media';

// Albums (docs/design/organise-and-share.md). A photo can be in several albums;
// deleting an album never deletes photos. Records:
//   D#<owner>  AL#<albumId>              album { name, count, coverId, … }
//   D#<owner>  AI#<albumId>#<mediaId>    membership (media ids sort by time)
//   D#<owner>  AM#<albumId>#<memberId>   a person who accepted the shared album
//   D#<member> SA#<albumId>#<ownerId>    the shared album in the member's Albums view
// A shared album is a share request carrying the album (shares.ts): access stays
// per item (S# records with albumId), written on accept and when items are added.

const ALBUM_ID = /^[0-9a-z]{8,10}-[A-Za-z0-9_-]{6}$/;
const MEDIA_ID = /^[0-9a-z]{8}-[0-9a-z]{4,12}$/;
const MAX_ALBUMS = 500;
export const MAX_ALBUM_ITEMS = 2000;
const MAX_CHANGE = 200;

export type Album = { pk: string; sk: string; albumId: string; name: string; createdAt: number; updatedAt: number; count: number; coverId?: string };

function checkId(id: string) {
  if (!ALBUM_ID.test(id)) throw new HttpError(400, 'Invalid album');
}

function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 60) throw new HttpError(400, 'Album names are 1–60 characters');
  return name;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === 'string' && MEDIA_ID.test(v)))].slice(0, MAX_CHANGE);
}

async function queryAll(pk: string, prefix: string, limit = 5000): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  let key: Record<string, any> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
        ExpressionAttributeValues: { ':p': pk, ':s': prefix },
        ExclusiveStartKey: key,
      }),
    );
    out.push(...(page.Items ?? []));
    key = page.LastEvaluatedKey;
  } while (key && out.length < limit);
  return out;
}

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

async function batchWrite(requests: Record<string, any>[]) {
  for (let i = 0; i < requests.length; i += 25) {
    let request: Record<string, any> | undefined = { [env.table]: requests.slice(i, i + 25) };
    while (request && Object.keys(request).length) {
      const result: any = await ddb.send(new BatchWriteCommand({ RequestItems: request }));
      request = result.UnprocessedItems;
    }
  }
}

/** Removes a member's access to items, but only access this album gave (a direct share of the same photo stays). */
async function revokeAlbumAccess(memberId: string, ownerId: string, albumId: string, mediaIds: string[]) {
  for (let i = 0; i < mediaIds.length; i += 25) {
    await Promise.all(
      mediaIds.slice(i, i + 25).map((id) =>
        ddb
          .send(
            new DeleteCommand({
              TableName: env.table,
              Key: { pk: `D#${memberId}`, sk: `S#${id}#${ownerId}` },
              ConditionExpression: 'albumId = :a',
              ExpressionAttributeValues: { ':a': albumId },
            }),
          )
          .catch((e) => {
            if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
          }),
      ),
    );
  }
}

export async function getAlbum(ownerId: string, albumId: string): Promise<Album | undefined> {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${ownerId}`, sk: `AL#${albumId}` } }))).Item as Album | undefined;
}

/** Media ids in an album, newest first. */
export async function albumMediaIds(ownerId: string, albumId: string): Promise<string[]> {
  return (await queryAll(`D#${ownerId}`, `AI#${albumId}#`)).map((i) => i.mediaId as string).reverse();
}

/** People who accepted this shared album: [{ memberId, shareId }]. */
export async function albumMembers(ownerId: string, albumId: string): Promise<{ memberId: string; name?: string; shareId: string; withLocation?: boolean }[]> {
  return (await queryAll(`D#${ownerId}`, `AM#${albumId}#`)).map((i) => ({ memberId: i.memberId as string, name: i.name as string | undefined, shareId: i.shareId as string, withLocation: i.withLocation === true }));
}

async function view(owner: Identity, album: Album) {
  const cover = album.coverId ? ((await ddb.send(new GetCommand({ TableName: env.table, Key: mediaKey(owner.id, album.coverId) }))).Item as MediaRecord | undefined) : undefined;
  const usable = cover && !cover.deletedAt ? cover : undefined;
  return {
    id: album.albumId,
    name: album.name,
    count: album.count,
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
    cover: usable ? await toClient(usable) : null,
  };
}

/** Recounts and picks the newest item as the cover. */
async function refresh(ownerId: string, albumId: string) {
  const items = await albumMediaIds(ownerId, albumId);
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `D#${ownerId}`, sk: `AL#${albumId}` },
      UpdateExpression: items.length ? 'SET #c = :c, coverId = :cover, updatedAt = :now' : 'SET #c = :c, updatedAt = :now REMOVE coverId',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#c': 'count' },
      ExpressionAttributeValues: { ':c': items.length, ':now': Date.now(), ...(items.length ? { ':cover': items[0] } : {}) },
    }),
  );
  return items.length;
}

/** GET /v1/albums: my albums (newest change first) and albums shared with me. */
export async function listAlbums(identity: Identity): Promise<Res> {
  const [mine, shared] = await Promise.all([queryAll(`D#${identity.id}`, 'AL#'), queryAll(`D#${identity.id}`, 'SA#')]);
  const albums = await Promise.all((mine as Album[]).sort((a, b) => b.updatedAt - a.updatedAt).map((a) => view(identity, a)));
  return json(200, {
    albums,
    shared: shared
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .map((s) => ({ id: s.albumId as string, name: s.name as string, ownerId: s.ownerId as string, ownerName: s.ownerName as string, at: s.at as number })),
  });
}

/** POST /v1/albums {name, mediaIds?}. */
export async function createAlbum(identity: Identity, req: Req): Promise<Res> {
  await rateLimit(`albums#${identity.id}`, 200);
  const name = cleanName(req.body?.name);
  if ((await queryAll(`D#${identity.id}`, 'AL#', MAX_ALBUMS + 1)).length >= MAX_ALBUMS) throw new HttpError(400, `You can have up to ${MAX_ALBUMS} albums`);
  const albumId = `${Date.now().toString(36).padStart(9, '0')}-${randomId(6).slice(0, 6)}`;
  const now = Date.now();
  const album: Album = { pk: `D#${identity.id}`, sk: `AL#${albumId}`, albumId, name, createdAt: now, updatedAt: now, count: 0 };
  await ddb.send(new PutCommand({ TableName: env.table, Item: album }));
  const add = ids(req.body?.mediaIds);
  if (add.length) await changeItems(identity, albumId, add, []);
  return json(200, { album: await view(identity, (await getAlbum(identity.id, albumId))!) });
}

/** PUT /v1/albums/:id {name}. */
export async function renameAlbum(identity: Identity, albumId: string, req: Req): Promise<Res> {
  checkId(albumId);
  const name = cleanName(req.body?.name);
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `D#${identity.id}`, sk: `AL#${albumId}` },
        UpdateExpression: 'SET #n = :n, updatedAt = :now',
        ConditionExpression: 'attribute_exists(pk)',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: { ':n': name, ':now': Date.now() },
      }),
    );
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') throw new HttpError(404, 'Album not found');
    throw e;
  }
  // The name members see follows.
  const members = await albumMembers(identity.id, albumId);
  await Promise.all(
    members.map((m) =>
      ddb.send(
        new UpdateCommand({
          TableName: env.table,
          Key: { pk: `D#${m.memberId}`, sk: `SA#${albumId}#${identity.id}` },
          UpdateExpression: 'SET #n = :n',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeNames: { '#n': 'name' },
          ExpressionAttributeValues: { ':n': name },
        }),
      ).catch(() => {}),
    ),
  );
  return json(200, { id: albumId, name });
}

/** Access records for members of a shared album (the same shape shares.ts writes). */
function memberAccess(owner: Identity, memberId: string, shareId: string, albumId: string, m: MediaRecord, now: number, withLocation = false) {
  return {
    pk: `D#${memberId}`,
    sk: `S#${m.id}#${owner.id}`,
    ownerId: owner.id,
    ownerName: owner.name,
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
    shareId,
    albumId,
    ...(withLocation ? { withLocation: true } : {}),
    gsi1pk: `SM#${owner.id}#${m.id}`,
    gsi1sk: `D#${memberId}`,
  };
}

/** Adds/removes items; members of a shared album gain/lose access to them. */
async function changeItems(identity: Identity, albumId: string, add: string[], remove: string[]): Promise<number> {
  const album = await getAlbum(identity.id, albumId);
  if (!album) throw new HttpError(404, 'Album not found');
  const now = Date.now();
  const media = add.length ? ((await batchGet(add.map((id) => mediaKey(identity.id, id)))) as MediaRecord[]).filter((m) => !m.deletedAt && !m.ownerHidden) : [];
  if (album.count + media.length > MAX_ALBUM_ITEMS) throw new HttpError(400, `An album holds up to ${MAX_ALBUM_ITEMS} items`);
  const members = add.length || remove.length ? await albumMembers(identity.id, albumId) : [];
  const ready = media.filter((m) => m.status === 'ready');
  await batchWrite([
    ...media.map((m) => ({ PutRequest: { Item: { pk: `D#${identity.id}`, sk: `AI#${albumId}#${m.id}`, mediaId: m.id, addedAt: now } } })),
    ...remove.map((id) => ({ DeleteRequest: { Key: { pk: `D#${identity.id}`, sk: `AI#${albumId}#${id}` } } })),
    ...members.flatMap((mem) => ready.map((m) => ({ PutRequest: { Item: memberAccess(identity, mem.memberId, mem.shareId, albumId, m, now, mem.withLocation) } }))),
  ]);
  if (remove.length) await Promise.all(members.map((mem) => revokeAlbumAccess(mem.memberId, identity.id, albumId, remove)));
  return refresh(identity.id, albumId);
}

/** POST /v1/albums/:id/items {add?, remove?}. */
export async function editAlbumItems(identity: Identity, albumId: string, req: Req): Promise<Res> {
  checkId(albumId);
  const add = ids(req.body?.add);
  const remove = ids(req.body?.remove);
  if (!add.length && !remove.length) throw new HttpError(400, 'Nothing to add or remove');
  return json(200, { id: albumId, count: await changeItems(identity, albumId, add, remove) });
}

/** GET /v1/albums/:id: the album, its items (newest first) and who it's shared with. */
export async function albumDetail(identity: Identity, albumId: string): Promise<Res> {
  checkId(albumId);
  const album = await getAlbum(identity.id, albumId);
  if (!album) throw new HttpError(404, 'Album not found');
  const mediaIds = await albumMediaIds(identity.id, albumId);
  const media = ((await batchGet(mediaIds.map((id) => mediaKey(identity.id, id)))) as MediaRecord[]).filter((m) => !m.deletedAt && !m.ownerHidden);
  const byId = new Map(media.map((m) => [m.id, m]));
  const items = await Promise.all(mediaIds.filter((id) => byId.has(id)).map((id) => toClient(byId.get(id)!)));
  const members = await albumMembers(identity.id, albumId);
  return json(200, { album: await view(identity, album), items, members: members.map((m) => ({ id: m.memberId, name: m.name, shareId: m.shareId })) });
}

/** DELETE /v1/albums/:id: the album goes, the photos stay; members lose the album's items. */
export async function deleteAlbum(identity: Identity, albumId: string): Promise<Res> {
  checkId(albumId);
  const album = await getAlbum(identity.id, albumId);
  if (!album) throw new HttpError(404, 'Album not found');
  const [mediaIds, members] = await Promise.all([albumMediaIds(identity.id, albumId), albumMembers(identity.id, albumId)]);
  await batchWrite([
    ...mediaIds.map((id) => ({ DeleteRequest: { Key: { pk: `D#${identity.id}`, sk: `AI#${albumId}#${id}` } } })),
    ...members.flatMap((m) => [
      { DeleteRequest: { Key: { pk: `D#${identity.id}`, sk: `AM#${albumId}#${m.memberId}` } } },
      { DeleteRequest: { Key: { pk: `D#${m.memberId}`, sk: `SA#${albumId}#${identity.id}` } } },
    ]),
  ]);
  await Promise.all(members.map((m) => revokeAlbumAccess(m.memberId, identity.id, albumId, mediaIds)));
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `AL#${albumId}` } }));
  return json(200, { deleted: albumId });
}

/** A member accepted the shared album (called by shares.ts). */
export async function addMember(owner: { id: string; name: string }, albumId: string, albumName: string, member: { id: string; name: string }, shareId: string, withLocation = false) {
  const now = Date.now();
  await batchWrite([
    { PutRequest: { Item: { pk: `D#${owner.id}`, sk: `AM#${albumId}#${member.id}`, memberId: member.id, name: member.name, shareId, at: now, ...(withLocation ? { withLocation: true } : {}) } } },
    { PutRequest: { Item: { pk: `D#${member.id}`, sk: `SA#${albumId}#${owner.id}`, albumId, name: albumName, ownerId: owner.id, ownerName: owner.name, shareId, at: now } } },
  ]);
}

/** The owner revoked the album from a member (called by shares.ts): membership and its items go. */
export async function removeMember(ownerId: string, albumId: string, memberId: string) {
  const mediaIds = await albumMediaIds(ownerId, albumId);
  await batchWrite([
    { DeleteRequest: { Key: { pk: `D#${ownerId}`, sk: `AM#${albumId}#${memberId}` } } },
    { DeleteRequest: { Key: { pk: `D#${memberId}`, sk: `SA#${albumId}#${ownerId}` } } },
  ]);
  await revokeAlbumAccess(memberId, ownerId, albumId, mediaIds);
}

/** DELETE /v1/shared-albums/:ownerId/:albumId: a member leaves a shared album. */
export async function leaveAlbum(identity: Identity, ownerId: string, albumId: string): Promise<Res> {
  checkId(albumId);
  await removeMember(ownerId, albumId, identity.id);
  return json(200, { left: albumId });
}
