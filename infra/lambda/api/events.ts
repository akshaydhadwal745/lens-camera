import { BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { addMember, Album, albumItems, albumMembers, eventUrl, getAlbum, MAX_ALBUM_ITEMS, memberAccess, refresh, removeMember, revokeAlbumAccess } from './albums';
import { Identity } from './identity';
import { ddb, env, HttpError, json, randomId, rateLimit, Req, Res } from './lib';
import { MediaRecord, mediaKey, toClient } from './media';
import { notify } from './push';

// Event albums (docs/design/switch-features.md §3): a wedding, trip or party album
// that anyone with its link or QR code can join and add their own photos to.
// The owner turns it on (a random, revocable code) and off; joining is the
// member's own consent, so no share request. Photos stay in their owner's
// storage and quota; the album holds references (AI# with `by`). Records:
//   EV#<code>  EVENT                    → { ownerId, albumId }
//   D#<owner>  AL#<albumId>             album.event = { code, at }
//   D#<owner>  AM#<albumId>#<member>    membership (shareId `ev-<code>`)
//   D#<member> SA#<albumId>#<owner>     the album in the member's Albums
//   D#<x>      S#<mediaId>#<by>         access for every member (+ the owner) to others' photos

const CODE = /^[A-Za-z0-9_-]{10,16}$/;
const MAX_MEMBERS = 500;
/** Per person per album (a guest phone can't flood an event). */
const MAX_ITEMS_PER_MEMBER = 500;
const MAX_ADD = 100;
/** Items shown on the public event page (newest first). */
const PAGE_ITEMS = 200;
const MEDIA_ID = /^[0-9a-z]{8}-[0-9a-z]{4,12}$/;

type EventIndex = { pk: string; sk: string; ownerId: string; albumId: string };

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

/** The event behind a code, or 404 (turned off, deleted or never existed). */
async function resolve(code: string): Promise<{ index: EventIndex; album: Album; owner: Record<string, any> }> {
  if (!CODE.test(code)) throw new HttpError(404, 'This event link doesn’t work any more');
  const index = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `EV#${code}`, sk: 'EVENT' } }))).Item as EventIndex | undefined;
  if (!index) throw new HttpError(404, 'This event link doesn’t work any more');
  const [album, owner] = await Promise.all([
    getAlbum(index.ownerId, index.albumId),
    ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${index.ownerId}`, sk: 'PROFILE' } })).then((r) => r.Item),
  ]);
  if (!album || album.event?.code !== code || !owner) throw new HttpError(404, 'This event link doesn’t work any more');
  return { index, album, owner };
}

async function isMember(ownerId: string, albumId: string, id: string): Promise<boolean> {
  if (id === ownerId) return true;
  return !!(await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${ownerId}`, sk: `AM#${albumId}#${id}` } }))).Item;
}

/**
 * POST /v1/albums/:id/event {on}: the owner turns the join link on (a new code)
 * or off (the link stops working at once; people already in stay).
 */
export async function setEvent(identity: Identity, albumId: string, req: Req): Promise<Res> {
  const album = await getAlbum(identity.id, albumId);
  if (!album) throw new HttpError(404, 'Album not found');
  const on = req.body?.on === true;
  if (album.event) {
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `EV#${album.event.code}`, sk: 'EVENT' } }));
  }
  if (!on) {
    await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `AL#${albumId}` }, UpdateExpression: 'REMOVE #e', ExpressionAttributeNames: { '#e': 'event' } }));
    return json(200, { event: null });
  }
  await rateLimit(`event-on#${identity.id}`, 50);
  const code = randomId(9); // 12 url-safe characters, unguessable
  const now = Date.now();
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `EV#${code}`, sk: 'EVENT', ownerId: identity.id, albumId, at: now }, ConditionExpression: 'attribute_not_exists(pk)' }));
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `D#${identity.id}`, sk: `AL#${albumId}` },
      UpdateExpression: 'SET #e = :e, updatedAt = :now',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#e': 'event' },
      ExpressionAttributeValues: { ':e': { code, at: now }, ':now': now },
    }),
  );
  return json(200, { event: { code, url: eventUrl(code) } });
}

/**
 * GET /v1/events/:code (public; the identity is optional): what the link shows:
 * album name, who made it, the newest photos (previews, never originals for
 * people who haven't joined), and whether this person is already in.
 */
export async function eventInfo(code: string, identity: Identity | null, req: Req): Promise<Res> {
  if (req.sourceIp) await rateLimit(`event-view#${req.sourceIp}`, 600);
  const { index, album, owner } = await resolve(code);
  const joined = identity ? await isMember(index.ownerId, index.albumId, identity.id) : false;
  const all = (await albumItems(index.ownerId, index.albumId)).slice(0, PAGE_ITEMS);
  const media = ((await batchGet(all.map((it) => mediaKey(it.by, it.mediaId)))) as MediaRecord[]).filter(
    (m) => !m.deletedAt && !m.ownerHidden && (m.status === 'ready' || m.previewReady),
  );
  const byKey = new Map(media.map((m) => [`${(m.pk as string).slice(2)}#${m.id}`, m]));
  const items = await Promise.all(
    all
      .filter((it) => byKey.has(`${it.by}#${it.mediaId}`))
      .map(async (it) => {
        const c = await toClient(byKey.get(`${it.by}#${it.mediaId}`)!);
        return {
          id: c.id,
          kind: c.kind,
          width: c.width,
          height: c.height,
          duration: c.duration,
          createdAt: c.createdAt,
          thumbUrl: c.thumbUrl,
          previewUrl: c.previewUrl,
          mine: identity?.id === it.by,
        };
      }),
  );
  const members = await albumMembers(index.ownerId, index.albumId);
  return json(200, {
    event: {
      code,
      url: eventUrl(code),
      name: album.name,
      ownerName: owner.name as string,
      count: album.count,
      people: members.length + 1,
      joined,
      isOwner: identity?.id === index.ownerId,
      albumId: index.albumId,
      ownerId: index.ownerId,
    },
    items,
  });
}

/** POST /v1/events/:code/join: you're in; you see everyone's photos and can add yours. */
export async function joinEvent(identity: Identity, code: string): Promise<Res> {
  await rateLimit(`event-join#${identity.id}`, 60);
  const { index, album, owner } = await resolve(code);
  if (identity.id === index.ownerId) return json(200, { joined: true, albumId: index.albumId, ownerId: index.ownerId, name: album.name });
  if (await isMember(index.ownerId, index.albumId, identity.id)) {
    return json(200, { joined: true, albumId: index.albumId, ownerId: index.ownerId, name: album.name });
  }
  const members = await albumMembers(index.ownerId, index.albumId);
  if (members.length >= MAX_MEMBERS) throw new HttpError(400, `This event is full (${MAX_MEMBERS} people)`);
  const shareId = `ev-${code}`;
  await addMember({ id: index.ownerId, name: owner.name }, index.albumId, album.name, { id: identity.id, name: identity.name }, shareId);
  // Access to everything already in the album (the owner's and other members' photos).
  const items = await albumItems(index.ownerId, index.albumId);
  const media = ((await batchGet(items.filter((it) => it.by !== identity.id).map((it) => mediaKey(it.by, it.mediaId)))) as MediaRecord[]).filter(
    (m) => m.status === 'ready' && !m.deletedAt && !m.ownerHidden,
  );
  const names = await ownerNames([...new Set(media.map((m) => (m.pk as string).slice(2)))]);
  const now = Date.now();
  await batchWrite(
    media.map((m) => {
      const by = (m.pk as string).slice(2);
      return { PutRequest: { Item: memberAccess({ id: by, name: names.get(by) }, identity.id, shareId, index.albumId, m, now, false, index.ownerId) } };
    }),
  );
  await notify(index.ownerId, 'shares', { title: album.name, body: `${identity.name} joined your event album.`, route: `/album/${index.albumId}` }).catch(() => {});
  return json(200, { joined: true, albumId: index.albumId, ownerId: index.ownerId, name: album.name });
}

async function ownerNames(ids: string[]): Promise<Map<string, string>> {
  const profiles = await batchGet(ids.map((id) => ({ pk: `D#${id}`, sk: 'PROFILE' })));
  return new Map(profiles.map((p) => [(p.pk as string).slice(2), p.name as string]));
}

/**
 * POST /v1/events/:code/items {mediaIds}: a member (or the owner) adds their own
 * photos. Everyone in the event gets access; the photos stay in their storage.
 */
export async function addEventItems(identity: Identity, code: string, req: Req): Promise<Res> {
  const { index, album } = await resolve(code);
  return addItems(identity, index.ownerId, album, req);
}

/**
 * POST /v1/shared-albums/:ownerId/:albumId/items {mediaIds}: the same from the
 * app's album screen (works while the album is an event, whatever its current code).
 */
export async function addSharedAlbumItems(identity: Identity, ownerId: string, albumId: string, req: Req): Promise<Res> {
  const album = await getAlbum(ownerId, albumId);
  if (!album?.event) throw new HttpError(403, 'Only event albums take photos from everyone');
  return addItems(identity, ownerId, album, req);
}

async function addItems(identity: Identity, ownerId: string, album: Album, req: Req): Promise<Res> {
  await rateLimit(`event-add#${identity.id}`, 300);
  const index = { ownerId, albumId: album.albumId };
  const code = album.event!.code;
  if (!(await isMember(index.ownerId, index.albumId, identity.id))) throw new HttpError(403, 'Join the event first');
  const ids = Array.isArray(req.body?.mediaIds)
    ? [...new Set((req.body.mediaIds as unknown[]).filter((v): v is string => typeof v === 'string' && MEDIA_ID.test(v)))].slice(0, MAX_ADD)
    : [];
  if (!ids.length) throw new HttpError(400, 'Choose photos or videos to add');
  const media = ((await batchGet(ids.map((id) => mediaKey(identity.id, id)))) as MediaRecord[]).filter(
    (m) => m.status === 'ready' && !m.deletedAt && !m.ownerHidden,
  );
  if (!media.length) throw new HttpError(404, 'Nothing to add yet: photos must finish uploading first');
  const existing = await albumItems(index.ownerId, index.albumId);
  const have = new Set(existing.map((it) => `${it.by}#${it.mediaId}`));
  const fresh = media.filter((m) => !have.has(`${identity.id}#${m.id}`));
  const mine = existing.filter((it) => it.by === identity.id).length;
  if (mine + fresh.length > MAX_ITEMS_PER_MEMBER) throw new HttpError(400, `You can add up to ${MAX_ITEMS_PER_MEMBER} items to one event`);
  if (album.count + fresh.length > MAX_ALBUM_ITEMS) throw new HttpError(400, `An album holds up to ${MAX_ALBUM_ITEMS} items`);
  if (!fresh.length) return json(200, { added: 0, count: album.count });

  const members = await albumMembers(index.ownerId, index.albumId);
  const now = Date.now();
  const isOwner = identity.id === index.ownerId;
  // Everyone in the event except the person adding (the owner too, when a member adds).
  const audience = [...members.map((m) => ({ id: m.memberId, shareId: m.shareId })), ...(isOwner ? [] : [{ id: index.ownerId, shareId: `ev-${code}` }])].filter(
    (a) => a.id !== identity.id,
  );
  await batchWrite([
    ...fresh.map((m) => ({
      PutRequest: { Item: { pk: `D#${index.ownerId}`, sk: `AI#${index.albumId}#${m.id}`, mediaId: m.id, addedAt: now, ...(isOwner ? {} : { by: identity.id }) } },
    })),
    ...audience.flatMap((a) =>
      fresh.map((m) => ({ PutRequest: { Item: memberAccess({ id: identity.id, name: identity.name }, a.id, a.shareId, index.albumId, m, now, false, index.ownerId) } })),
    ),
  ]);
  const count = await refresh(index.ownerId, index.albumId);
  // One notification per person per batch (not per photo); big events: the first 50.
  const body = `${identity.name} added ${fresh.length} ${fresh.length === 1 ? 'photo' : 'photos'}.`;
  await Promise.all(
    audience.slice(0, 50).map((a) =>
      notify(a.id, 'shares', { title: album.name, body, route: a.id === index.ownerId ? `/album/${index.albumId}` : `/album/${index.albumId}?owner=${index.ownerId}` }).catch(() => {}),
    ),
  );
  return json(200, { added: fresh.length, count });
}

/** GET /v1/shared-albums/:ownerId/:albumId/mine: a member's own photos in the album (others' come with GET /shared). */
export async function mySharedAlbumItems(identity: Identity, ownerId: string, albumId: string): Promise<Res> {
  if (!(await isMember(ownerId, albumId, identity.id))) throw new HttpError(404, 'Album not found');
  const items = await albumItems(ownerId, albumId);
  return json(200, { mine: items.filter((it) => it.by === identity.id).map((it) => it.mediaId) });
}

/** DELETE /v1/shared-albums/:ownerId/:albumId/items/:mediaId: whoever added it (or the owner) takes it out. */
export async function removeEventItem(identity: Identity, ownerId: string, albumId: string, mediaId: string): Promise<Res> {
  const album = await getAlbum(ownerId, albumId);
  if (!album) throw new HttpError(404, 'Album not found');
  const index = { ownerId, albumId };
  const item = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${index.ownerId}`, sk: `AI#${index.albumId}#${mediaId}` } }))).Item;
  if (!item) throw new HttpError(404, 'Not in this album');
  const by = (item.by as string | undefined) ?? index.ownerId;
  if (identity.id !== by && identity.id !== index.ownerId) throw new HttpError(403, 'Only who added it, or the album owner, can remove it');
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `D#${index.ownerId}`, sk: `AI#${index.albumId}#${mediaId}` } }));
  const members = await albumMembers(index.ownerId, index.albumId);
  const it = [{ mediaId, by }];
  await Promise.all([...members.map((m) => revokeAlbumAccess(m.memberId, index.ownerId, index.albumId, it)), revokeAlbumAccess(index.ownerId, index.ownerId, index.albumId, it)]);
  return json(200, { removed: mediaId, count: await refresh(index.ownerId, index.albumId) });
}

/** DELETE /v1/events/:code/members/me: leave (your photos leave with you). */
export async function leaveEvent(identity: Identity, code: string): Promise<Res> {
  const { index } = await resolve(code);
  if (identity.id === index.ownerId) throw new HttpError(400, 'You made this event: turn the link off or delete the album instead');
  await removeMember(index.ownerId, index.albumId, identity.id);
  return json(200, { left: index.albumId });
}
