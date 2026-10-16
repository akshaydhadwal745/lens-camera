import { BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { authenticate, Identity } from './identity';
import { ddb, env, HttpError, json, randomId, rateLimit, Req, Res } from './lib';
import { MediaRecord, mediaKey, toClient } from './media';
import { realNames } from './real-names';
import { grantFromLink, revokeAsSender, withoutLocation } from './shares';

// Share links (docs/features/share-links.md): send photos to people without Lens
// through WhatsApp or any app. A link names the exact items picked (1–20; never
// an album or the library), expires (1/7/30 days) and can be revoked.
//   LK#<token>  LINK            the link (owner, items, mode, expiry, claims)
//   LK#<token>  M#<mediaId>     location-free copy of one item (withoutLocation)
//   D#<owner>   LKO#<token>     the owner's list of links
// mode 'anyone': the web page shows the items; everyone who opens it in Lens
// gets their own accepted share. mode 'one': the web page shows only a count;
// the first person who opens it in Lens gets it, nobody else ever can.
// Opening a link in Lens is that person's accept (shares.ts grantFromLink), so
// the items land in their Shared tab and the sender's Sent list; revoking the
// link revokes those shares too. Location is private unless the sender included
// it (same copies as shares).

const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const MAX_ITEMS = 20;
const MAX_CLAIMS = 50;
const DAYS: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 };
const DAY_MS = 24 * 3600 * 1000;
/** Kept this long after expiry so the owner still sees it in the list, then DynamoDB TTL removes it. */
const KEEP_AFTER_MS = 30 * DAY_MS;

type Mode = 'anyone' | 'one';
type LinkRecord = {
  pk: string;
  sk: 'LINK';
  token: string;
  ownerId: string;
  ownerName: string;
  ownerAccount: boolean;
  mediaIds: string[];
  photos: number;
  videos: number;
  mode: Mode;
  withLocation: boolean;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
  opens?: number;
  /** Who opened it in Lens: { id, name, shareId, at }. */
  claims?: { id: string; name: string; shareId: string; at: number }[];
  ttl: number;
};

export function linkUrl(token: string): string {
  return `https://${env.cdnDomain}/s/${token}`;
}

function linkStatus(l: LinkRecord, now = Date.now()): 'active' | 'expired' | 'revoked' | 'used' {
  if (l.revokedAt) return 'revoked';
  if (l.expiresAt <= now) return 'expired';
  if (l.mode === 'one' && l.claims?.length) return 'used';
  return 'active';
}

async function getLink(token: string): Promise<LinkRecord | undefined> {
  if (!TOKEN.test(token)) return undefined;
  return (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `LK#${token}`, sk: 'LINK' } }))).Item as LinkRecord | undefined;
}

async function linkMedia(l: LinkRecord): Promise<MediaRecord[]> {
  const got = await ddb.send(new BatchGetCommand({ RequestItems: { [env.table]: { Keys: l.mediaIds.map((id) => mediaKey(l.ownerId, id)) } } }));
  const byId = new Map(((got.Responses?.[env.table] ?? []) as MediaRecord[]).map((m) => [m.id, m]));
  // Link order; deleted (Trash) or hidden items drop out for everyone.
  return l.mediaIds.map((id) => byId.get(id)).filter((m): m is MediaRecord => !!m && !m.deletedAt && !m.ownerHidden && (m.status === 'ready' || !!m.previewReady));
}

function view(l: LinkRecord, now = Date.now()) {
  return {
    token: l.token,
    url: linkUrl(l.token),
    count: l.mediaIds.length,
    photos: l.photos,
    videos: l.videos,
    mode: l.mode,
    withLocation: l.withLocation,
    createdAt: l.createdAt,
    expiresAt: l.expiresAt,
    status: linkStatus(l, now),
    opens: l.opens ?? 0,
    mediaIds: l.mediaIds,
  };
}

/** POST /v1/links {mediaIds, expires: '1d'|'7d'|'30d', mode: 'anyone'|'one', includeLocation}. */
export async function createLink(identity: Identity, req: Req): Promise<Res> {
  await rateLimit(`links#${identity.id}`, 100, 'Too many links. Try again in an hour.');
  if (typeof req.body?.albumId === 'string') throw new HttpError(400, 'Albums can’t be shared by link. Pick the photos instead.');
  const ids = Array.isArray(req.body?.mediaIds) ? [...new Set((req.body.mediaIds as unknown[]).filter((v): v is string => typeof v === 'string' && v.length < 64))] : [];
  if (!ids.length) throw new HttpError(400, 'Pick at least one photo or video');
  if (ids.length > MAX_ITEMS) throw new HttpError(400, `A link can hold up to ${MAX_ITEMS} items`);
  const days = DAYS[String(req.body?.expires ?? '7d')];
  if (!days) throw new HttpError(400, 'Invalid expiry');
  const mode: Mode = req.body?.mode === 'one' ? 'one' : 'anyone';

  const got = await ddb.send(new BatchGetCommand({ RequestItems: { [env.table]: { Keys: ids.map((id) => mediaKey(identity.id, id)) } } }));
  const media = ((got.Responses?.[env.table] ?? []) as MediaRecord[]).filter((m) => m.status === 'ready' && !m.deletedAt && !m.ownerHidden);
  if (media.length !== ids.length) throw new HttpError(409, 'Some items are still uploading or were deleted. Try again when they’re in the cloud.');

  const now = Date.now();
  const photos = media.filter((m) => m.kind !== 'video').length;
  const link: LinkRecord = {
    pk: '',
    sk: 'LINK',
    token: randomId(16).slice(0, 22), // 128 random bits
    ownerId: identity.id,
    ownerName: identity.name,
    ownerAccount: !!identity.email,
    mediaIds: ids,
    photos,
    videos: media.length - photos,
    mode,
    withLocation: req.body?.includeLocation === true,
    createdAt: now,
    expiresAt: now + days * DAY_MS,
    ttl: Math.floor((now + days * DAY_MS + KEEP_AFTER_MS) / 1000),
  };
  link.pk = `LK#${link.token}`;
  await ddb.send(new PutCommand({ TableName: env.table, Item: link, ConditionExpression: 'attribute_not_exists(pk)' }));
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `D#${identity.id}`, sk: `LKO#${link.token}`, token: link.token, createdAt: now, ttl: link.ttl } }));
  return json(200, { link: view(link, now) });
}

/** GET /v1/links: my links, newest first, with who opened them. */
export async function listLinks(identity: Identity): Promise<Res> {
  const refs = (
    await ddb.send(
      new QueryCommand({
        TableName: env.table,
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
        ExpressionAttributeValues: { ':p': `D#${identity.id}`, ':s': 'LKO#' },
      }),
    )
  ).Items ?? [];
  if (!refs.length) return json(200, { links: [] });
  const out: LinkRecord[] = [];
  for (let i = 0; i < refs.length; i += 100) {
    const got = await ddb.send(
      new BatchGetCommand({ RequestItems: { [env.table]: { Keys: refs.slice(i, i + 100).map((r) => ({ pk: `LK#${r.token}`, sk: 'LINK' })) } } }),
    );
    out.push(...((got.Responses?.[env.table] ?? []) as LinkRecord[]));
  }
  const claimers = out.flatMap((l) => (l.claims ?? []).map((c) => c.id));
  const real = await realNames(claimers);
  const now = Date.now();
  return json(200, {
    links: out
      .filter((l) => l.ownerId === identity.id)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((l) => ({ ...view(l, now), claims: (l.claims ?? []).map((c) => ({ id: c.id, name: c.name, realName: real.get(c.id) ?? null, at: c.at })) })),
  });
}

/** POST /v1/links/:token/revoke: the link stops working and everyone who opened it in Lens loses access. */
export async function revokeLink(identity: Identity, token: string): Promise<Res> {
  const l = await getLink(token);
  if (!l || l.ownerId !== identity.id) throw new HttpError(404, 'Not found');
  if (!l.revokedAt) {
    await ddb.send(
      new UpdateCommand({ TableName: env.table, Key: { pk: l.pk, sk: 'LINK' }, UpdateExpression: 'SET revokedAt = :n', ExpressionAttributeValues: { ':n': Date.now() } }),
    );
  }
  for (const c of l.claims ?? []) await revokeAsSender(l.ownerId, c.shareId);
  return json(200, { status: 'revoked', revoked: l.claims?.length ?? 0 });
}

/**
 * GET /v1/links/:token (public: the /s/ web page and the app before claiming).
 * 'anyone' links: the items (previews + location-safe originals). 'one' links:
 * only who and how many, until it's opened in Lens.
 */
export async function linkInfo(token: string, req: Req): Promise<Res> {
  if (req.sourceIp) await rateLimit(`link-view#${req.sourceIp}`, 600);
  const l = await getLink(token);
  const now = Date.now();
  if (!l) throw new HttpError(404, 'This link doesn’t work. Ask whoever sent it for a new one.');
  const status = linkStatus(l, now);
  const viewer = await authenticate(req).catch(() => null);
  const real = await realNames([l.ownerId]);
  const base = {
    from: { name: l.ownerName, realName: real.get(l.ownerId) ?? null },
    count: l.mediaIds.length,
    photos: l.photos,
    videos: l.videos,
    mode: l.mode,
    status,
    expiresAt: l.expiresAt,
    mine: viewer?.id === l.ownerId,
    claimed: !!viewer && (l.claims ?? []).some((c) => c.id === viewer.id),
    // Android without Lens: Play with the link in the install referrer once listed; until then the website APK.
    getUrl: env.playUrl ? `${env.playUrl}${env.playUrl.includes('?') ? '&' : '?'}referrer=${encodeURIComponent(`lens_share=${token}`)}` : '/download/',
  };
  if (status !== 'active' || l.mode === 'one') return json(200, { link: base, items: [] });

  await ddb
    .send(new UpdateCommand({ TableName: env.table, Key: { pk: l.pk, sk: 'LINK' }, UpdateExpression: 'ADD opens :one', ExpressionAttributeValues: { ':one': 1 } }))
    .catch(() => {});
  const media = await linkMedia(l);
  const items = await Promise.all(
    media.map(async (m) => {
      const client = await toClient(m);
      // Cached per link item (LK#<token> M#<id>): the strippedKey written by withoutLocation.
      const row = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: l.pk, sk: `M#${m.id}` } }))).Item;
      const c = await withoutLocation(
        { pk: l.pk, sk: `M#${m.id}`, ownerId: l.ownerId, mediaId: m.id, withLocation: l.withLocation, strippedKey: row?.strippedKey },
        m,
        client,
      ).catch(() => ({ ...client, url: undefined })); // can't make a location-free copy: preview only
      return { id: c.id, kind: c.kind, width: c.width, height: c.height, duration: c.duration, thumbUrl: c.thumbUrl, previewUrl: c.previewUrl, url: c.url };
    }),
  );
  return json(200, { link: base, items });
}

/** POST /v1/links/:token/open (signed in, from the app): opening it in Lens is the accept. */
export async function openLink(identity: Identity, token: string): Promise<Res> {
  await rateLimit(`link-open#${identity.id}`, 120);
  const l = await getLink(token);
  if (!l) throw new HttpError(404, 'This link doesn’t work. Ask whoever sent it for a new one.');
  if (l.ownerId === identity.id) return json(200, { own: true, mediaIds: l.mediaIds });
  const mine = (l.claims ?? []).find((c) => c.id === identity.id);
  if (mine) return json(200, { shareId: mine.shareId, ownerId: l.ownerId, mediaIds: l.mediaIds });
  const status = linkStatus(l);
  if (status === 'revoked') throw new HttpError(410, 'The sender stopped sharing this link.');
  if (status === 'expired') throw new HttpError(410, 'This link has expired. Ask the sender for a new one.');
  if (status === 'used') throw new HttpError(403, 'This link was for one person and someone else already opened it.');
  if ((l.claims?.length ?? 0) >= MAX_CLAIMS) throw new HttpError(403, 'This link was opened by too many people. Ask the sender for a new one.');
  const blocked = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${identity.id}`, sk: `B#${l.ownerId}` } }))).Item;
  if (blocked) throw new HttpError(403, 'You blocked this person. Unblock them in Settings → Sharing to open it.');

  // Claim first (conditional), then grant: two phones racing for a one-person link can't both win.
  const claim = { id: identity.id, name: identity.name, shareId: '', at: Date.now() };
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: l.pk, sk: 'LINK' },
        UpdateExpression: 'SET claims = list_append(if_not_exists(claims, :empty), :c)',
        ConditionExpression:
          l.mode === 'one'
            ? 'attribute_not_exists(revokedAt) AND expiresAt > :now AND (attribute_not_exists(claims) OR size(claims) = :zero)'
            : 'attribute_not_exists(revokedAt) AND expiresAt > :now',
        ExpressionAttributeValues: { ':empty': [], ':c': [claim], ':now': Date.now(), ...(l.mode === 'one' ? { ':zero': 0 } : {}) },
      }),
    );
  } catch (error: any) {
    if (error?.name === 'ConditionalCheckFailedException') throw new HttpError(403, 'This link can’t be opened any more. Ask the sender for a new one.');
    throw error;
  }
  const media = (await linkMedia(l)).filter((m) => m.status === 'ready');
  const { shareId, count } = await grantFromLink({ id: l.ownerId, name: l.ownerName, account: l.ownerAccount }, identity, media, {
    token: l.token,
    withLocation: l.withLocation,
  });
  // Fill in the share id on our claim (the last one we appended is ours unless another landed after it).
  const fresh = await getLink(token);
  const index = (fresh?.claims ?? []).findIndex((c) => c.id === identity.id && !c.shareId);
  if (index >= 0) {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: l.pk, sk: 'LINK' },
        UpdateExpression: `SET claims[${index}].shareId = :s`,
        ExpressionAttributeValues: { ':s': shareId },
      }),
    );
  }
  return json(200, { shareId, ownerId: l.ownerId, mediaIds: media.map((m) => m.id), count });
}

/** Account deletion: the owner's links are deleted (claims are shares, removed with the account). */
export async function deleteLinksOf(ownerId: string): Promise<void> {
  const refs = (
    await ddb.send(
      new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': `D#${ownerId}`, ':s': 'LKO#' } }),
    )
  ).Items ?? [];
  for (const r of refs) {
    const rows = (await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `LK#${r.token}` } }))).Items ?? [];
    for (const row of rows) await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: row.pk, sk: row.sk } }));
  }
}
