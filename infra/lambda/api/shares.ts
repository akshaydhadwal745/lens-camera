import { BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, decodeCursor, encodeCursor, env, HttpError, json, randomId, Req, Res, signMediaUrl } from './lib';
import { derivativeKey, MediaRecord, mediaKey, toClient } from './media';
import { notify } from './push';
import { archiveIfOrphaned } from './trash';

// Sharing with consent (docs/design/sharing-consent.md). A share is a request per
// recipient: pending → accepted | declined | cancelled | expired, and accepted →
// revoked. The recipient's access records (S#<mediaId>#<ownerId>, which every
// file/stream check already requires) are written only on accept, so nothing
// protected is reachable before the recipient agrees. Records:
//   D#<recipient> IN#<shareId>   the request in the recipient's inbox
//   D#<sender>    OUT#<shareId>  the same request in the sender's Sent list
//   D#<recipient> C#<sender>     contact after an accept ({ trusted } = always accept)
//   D#<recipient> B#<sender>     blocked: new shares from them never arrive

const MAX_MEDIA = 50;
const MAX_RECIPIENTS = 20;
const EXPIRE_MS = 7 * 24 * 3600 * 1000;
const SHARE_ID = /^[0-9a-z]{8,10}-[A-Za-z0-9_-]{6}$/;

export type ShareStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'revoked' | 'expired';

type ShareRequest = {
  pk: string;
  sk: string;
  shareId: string;
  fromId: string;
  fromName: string;
  fromAccount: boolean;
  toId: string;
  toName: string;
  toAccount: boolean;
  mediaIds: string[];
  photos: number;
  videos: number;
  status: ShareStatus;
  createdAt: number;
  expiresAt: number;
  respondedAt?: number;
};

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

const put = (Item: Record<string, any>) => ({ PutRequest: { Item } });
const del = (Key: { pk: string; sk: string }) => ({ DeleteRequest: { Key } });

/** Time-sortable id (newest last in a key range). */
function newShareId(): string {
  return `${Date.now().toString(36).padStart(9, '0')}-${randomId(6).slice(0, 6)}`;
}

/** Pending past its 7 days counts as expired (written lazily). */
function effectiveStatus(r: Pick<ShareRequest, 'status' | 'expiresAt'>, now = Date.now()): ShareStatus {
  return r.status === 'pending' && r.expiresAt <= now ? 'expired' : r.status;
}

/** The access records an accepted share gives the recipient (the format GET /shared and streams check). */
function accessRecords(r: ShareRequest, media: MediaRecord[], now: number) {
  return media.map((m) => ({
    pk: `D#${r.toId}`,
    sk: `S#${m.id}#${r.fromId}`, // media ids are time-sortable
    ownerId: r.fromId,
    ownerName: r.fromName,
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
    shareId: r.shareId,
    gsi1pk: `SM#${r.fromId}#${m.id}`,
    gsi1sk: `D#${r.toId}`,
  }));
}

async function shareableMedia(ownerId: string, mediaIds: string[]): Promise<MediaRecord[]> {
  const media = (await batchGet(mediaIds.map((id) => mediaKey(ownerId, id)))) as MediaRecord[];
  return media.filter((m) => m.status === 'ready' && !m.deletedAt && !m.ownerHidden);
}

/** Writes access + contacts for an accepted request (both sides now know each other). */
async function grant(r: ShareRequest, trusted: boolean | undefined, now: number): Promise<number> {
  const media = await shareableMedia(r.fromId, r.mediaIds);
  const contact = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${r.toId}`, sk: `C#${r.fromId}` } }))).Item;
  await batchWrite([
    ...accessRecords(r, media, now).map(put),
    put({ pk: `D#${r.toId}`, sk: `C#${r.fromId}`, name: r.fromName, account: r.fromAccount, lastAt: now, trusted: trusted ?? contact?.trusted ?? false }),
    put({ pk: `D#${r.fromId}`, sk: `C#${r.toId}`, name: r.toName, account: r.toAccount, lastAt: now }),
  ]);
  return media.length;
}

/**
 * POST /v1/shares {mediaIds, to}: a share request to each person. People who chose
 * "always accept" from this sender get it at once; blocked senders' requests are
 * kept on the sender's side only (they see it waiting, then expired).
 */
export async function share(identity: Identity, req: Req): Promise<Res> {
  const mediaIds = unique(req.body.mediaIds).slice(0, MAX_MEDIA);
  const to = unique(req.body.to).filter((id) => id !== identity.id).slice(0, MAX_RECIPIENTS);
  if (!mediaIds.length || !to.length) throw new HttpError(400, 'Choose media and at least one person');

  const ready = await shareableMedia(identity.id, mediaIds);
  if (!ready.length) throw new HttpError(404, 'Nothing to share yet: items must finish uploading first');

  const recipients = await batchGet(to.map((id) => ({ pk: `D#${id}`, sk: 'PROFILE' })));
  if (!recipients.length) throw new HttpError(404, 'Recipient not found');
  const ids = recipients.map((r) => (r.pk as string).slice(2));
  const relations = await batchGet(ids.flatMap((rid) => [{ pk: `D#${rid}`, sk: `C#${identity.id}` }, { pk: `D#${rid}`, sk: `B#${identity.id}` }]));
  const trustedBy = new Set(relations.filter((x) => (x.sk as string).startsWith('C#') && x.trusted).map((x) => (x.pk as string).slice(2)));
  const blockedBy = new Set(relations.filter((x) => (x.sk as string).startsWith('B#')).map((x) => (x.pk as string).slice(2)));

  const now = Date.now();
  const photos = ready.filter((m) => m.kind !== 'video').length;
  const videos = ready.length - photos;
  const writes: Record<string, any>[] = [];
  const results: { id: string; name: string; shareId: string; status: ShareStatus }[] = [];
  const accepted: ShareRequest[] = [];
  for (const r of recipients) {
    const rid = (r.pk as string).slice(2);
    const shareId = newShareId();
    const auto = trustedBy.has(rid) && !blockedBy.has(rid);
    const base: Omit<ShareRequest, 'pk' | 'sk'> = {
      shareId,
      fromId: identity.id,
      fromName: identity.name,
      fromAccount: !!identity.email,
      toId: rid,
      toName: r.name,
      toAccount: !!r.email,
      mediaIds: ready.map((m) => m.id),
      photos,
      videos,
      status: auto ? 'accepted' : 'pending',
      createdAt: now,
      expiresAt: now + EXPIRE_MS,
      ...(auto ? { respondedAt: now } : {}),
    };
    writes.push(put({ ...base, pk: `D#${identity.id}`, sk: `OUT#${shareId}` }));
    if (!blockedBy.has(rid)) writes.push(put({ ...base, pk: `D#${rid}`, sk: `IN#${shareId}` }));
    if (auto) accepted.push({ ...base, pk: `D#${rid}`, sk: `IN#${shareId}` });
    results.push({ id: rid, name: r.name, shareId, status: base.status });
  }
  await batchWrite(writes);
  for (const r of accepted) await grant(r, undefined, now);

  const what = describe(photos, videos);
  await Promise.all(
    results
      .filter((r) => !blockedBy.has(r.id))
      .map((r) =>
        r.status === 'accepted'
          ? notify(r.id, 'shares', { title: `${identity.name} shared ${what} with you`, body: 'Open Lens to see them.', route: '/gallery?tab=shared' })
          : notify(r.id, 'shares', { title: `${identity.name} wants to share ${what}`, body: 'Review to accept or decline.', route: `/shares/${r.shareId}` }),
      ),
  );
  // `shared` + `recipients` kept for app versions before the request flow.
  return json(200, { shared: ready.length, recipients: results.map((r) => r.name), requests: results });
}

function describe(photos: number, videos: number): string {
  const parts = [photos ? `${photos} photo${photos === 1 ? '' : 's'}` : '', videos ? `${videos} video${videos === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.join(' and ') || 'items';
}

/** Small thumbnails of a request: only thumbs, never the preview or the original. */
async function thumbs(r: ShareRequest, limit = 12): Promise<{ id: string; kind: string; thumbUrl?: string }[]> {
  const media = await shareableMedia(r.fromId, r.mediaIds.slice(0, limit));
  return Promise.all(
    media.map(async (m) => ({
      id: m.id,
      kind: m.kind,
      thumbUrl: m.previewReady ? await signMediaUrl(derivativeKey(m.key, 'thumb', m.derivVersion)) : undefined,
    })),
  );
}

function view(r: ShareRequest, now = Date.now()) {
  return {
    shareId: r.shareId,
    from: { id: r.fromId, name: r.fromName, account: r.fromAccount },
    to: { id: r.toId, name: r.toName, account: r.toAccount },
    photos: r.photos,
    videos: r.videos,
    count: r.mediaIds.length,
    status: effectiveStatus(r, now),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    respondedAt: r.respondedAt,
  };
}

async function list(identity: Identity, prefix: 'IN#' | 'OUT#', req: Req) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: env.table,
      KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
      ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':s': prefix },
      ScanIndexForward: false,
      Limit: 50,
      ExclusiveStartKey: decodeCursor(req.query.cursor),
    }),
  );
  return { items: (result.Items ?? []) as ShareRequest[], cursor: encodeCursor(result.LastEvaluatedKey) };
}

/**
 * GET /v1/shares/in: requests sent to me, newest first. Thumbnails come along only
 * from people I already accepted from (others: GET /shares/in/:id?previews=1).
 */
export async function inbox(identity: Identity, req: Req): Promise<Res> {
  const { items, cursor } = await list(identity, 'IN#', req);
  const now = Date.now();
  const known = new Set(
    (await batchGet([...new Set(items.map((r) => r.fromId))].map((id) => ({ pk: `D#${identity.id}`, sk: `C#${id}` })))).map((c) => (c.sk as string).slice(2)),
  );
  const out = await Promise.all(
    items.map(async (r) => {
      const v = view(r, now);
      const showThumbs = v.status === 'pending' && known.has(r.fromId);
      return { ...v, knownSender: known.has(r.fromId), thumbs: showThumbs ? await thumbs(r) : undefined };
    }),
  );
  return json(200, { requests: out, pending: out.filter((r) => r.status === 'pending').length, cursor });
}

/** GET /v1/shares/out: what I shared, with each person's status. */
export async function sent(identity: Identity, req: Req): Promise<Res> {
  const { items, cursor } = await list(identity, 'OUT#', req);
  const now = Date.now();
  return json(200, { requests: items.map((r) => view(r, now)), cursor });
}

async function load(pk: string, sk: string): Promise<ShareRequest | undefined> {
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk, sk } }))).Item as ShareRequest | undefined;
}

function checkId(shareId: string) {
  if (!SHARE_ID.test(shareId)) throw new HttpError(400, 'Invalid share');
}

/** GET /v1/shares/in/:id[?previews=1]: one request; thumbnails when asked for (still no preview/original). */
export async function request(identity: Identity, shareId: string, req: Req): Promise<Res> {
  checkId(shareId);
  const r = await load(`D#${identity.id}`, `IN#${shareId}`);
  if (!r) throw new HttpError(404, 'Not found');
  const v = view(r);
  const known = !!(await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `C#${r.fromId}` } }))).Item;
  const showThumbs = v.status === 'pending' && (known || req.query.previews === '1');
  return json(200, { ...v, knownSender: known, thumbs: showThumbs ? await thumbs(r, 50) : undefined });
}

/** Moves both copies of a request from one status to another, only if it's still in `from`. */
async function transition(r: ShareRequest, from: ShareStatus, to: ShareStatus, now: number) {
  const update = (pk: string, sk: string) => ({
    Update: {
      TableName: env.table,
      Key: { pk, sk },
      UpdateExpression: 'SET #s = :to, respondedAt = :now',
      ConditionExpression: from === 'pending' ? '#s = :from AND expiresAt > :now' : '#s = :from',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':to': to, ':from': from, ':now': now },
    },
  });
  try {
    await ddb.send(new TransactWriteCommand({ TransactItems: [update(`D#${r.toId}`, `IN#${r.shareId}`), update(`D#${r.fromId}`, `OUT#${r.shareId}`)] }));
  } catch (e) {
    if ((e as { name?: string }).name === 'TransactionCanceledException') {
      throw new HttpError(409, `This share is ${effectiveStatus(r, now)}`);
    }
    throw e;
  }
}

/** POST /v1/shares/in/:id/accept {alwaysAccept?}: the items join my Shared tab. */
export async function accept(identity: Identity, shareId: string, req: Req): Promise<Res> {
  checkId(shareId);
  const r = await load(`D#${identity.id}`, `IN#${shareId}`);
  if (!r) throw new HttpError(404, 'Not found');
  const now = Date.now();
  await transition(r, 'pending', 'accepted', now);
  const count = await grant(r, req.body?.alwaysAccept === true ? true : undefined, now);
  await notify(r.fromId, 'shares', { title: `${identity.name} accepted your ${describe(r.photos, r.videos)}`, body: 'They can see them now.', route: '/shares/sent' });
  return json(200, { status: 'accepted', count });
}

/** POST /v1/shares/in/:id/decline {block?}: nothing is shared; optionally block the sender. */
export async function decline(identity: Identity, shareId: string, req: Req): Promise<Res> {
  checkId(shareId);
  const r = await load(`D#${identity.id}`, `IN#${shareId}`);
  if (!r) throw new HttpError(404, 'Not found');
  await transition(r, 'pending', 'declined', Date.now());
  if (req.body?.block === true) await block(identity, r.fromId, r.fromName);
  return json(200, { status: 'declined', blocked: req.body?.block === true });
}

/**
 * POST /v1/shares/out/:id/cancel: the sender takes it back. Pending → cancelled
 * (it leaves the recipient's inbox); accepted → revoked (their access ends now).
 */
export async function cancel(identity: Identity, shareId: string): Promise<Res> {
  checkId(shareId);
  const r = await load(`D#${identity.id}`, `OUT#${shareId}`);
  if (!r) throw new HttpError(404, 'Not found');
  const now = Date.now();
  const status = effectiveStatus(r, now);
  if (status === 'pending') {
    await transition(r, 'pending', 'cancelled', now);
    return json(200, { status: 'cancelled' });
  }
  if (status !== 'accepted') throw new HttpError(409, `This share is ${status}`);
  await transition(r, 'accepted', 'revoked', now);
  await batchWrite(r.mediaIds.map((id) => del({ pk: `D#${r.toId}`, sk: `S#${id}#${r.fromId}` })));
  await Promise.all(r.mediaIds.map((id) => archiveIfOrphaned(r.fromId, id)));
  return json(200, { status: 'revoked' });
}

async function block(identity: Identity, userId: string, name?: string) {
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `D#${identity.id}`, sk: `B#${userId}`, name, at: Date.now() } }));
  // Blocking also ends "always accept" from them.
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `C#${userId}` } }));
}

/** POST /v1/blocks/:userId — DELETE /v1/blocks/:userId. */
export async function setBlocked(identity: Identity, userId: string, blocked: boolean): Promise<Res> {
  if (!userId || userId.length > 64 || userId === identity.id) throw new HttpError(400, 'Invalid person');
  if (blocked) await block(identity, userId);
  else await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `B#${userId}` } }));
  return json(200, { blocked });
}

/** PUT /v1/contacts/:userId {trusted}: "always accept from this person" on or off. */
export async function setTrusted(identity: Identity, userId: string, req: Req): Promise<Res> {
  const contact = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `C#${userId}` } }))).Item;
  if (!contact) throw new HttpError(404, 'Accept a share from them first');
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...contact, trusted: req.body?.trusted === true } }));
  return json(200, { trusted: req.body?.trusted === true });
}

/** GET /v1/shared?cursor=: media others have shared with this identity (accepted shares only). */
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
        location: current.get(`${s.ownerId}#${s.mediaId}`)?.location, // own storage: preview only (free plan)
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
