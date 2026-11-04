// Content library (docs/growth/content-engine.md, phase 2): photos, screen recordings, designs and licensed
// media used in posts, each with a rights record. Files live in the GrowthContent bucket:
//   u/<id>.<ext>  upload staging (1 day); checked (size, file signature) then moved to a/
//   a/<id>.<ext>  the asset
//   GROWTH / ASSET#<id>  name, kind, origin, file, Lens photo?, personal-content check, rights, status
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { BatchGetCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'node:crypto';

import { ddb, env, HttpError, json, Req, Res, s3, signedCdnUrl } from '../api/lib';
import { creditLine, effectiveStatus, licenseVerdict, type Rights, type RightsStatus } from './growth-rights';
import { log } from './log';

const BUCKET = process.env.GROWTH_CONTENT_BUCKET ?? '';
export const ASSET_KINDS = ['photo', 'screen-recording', 'video', 'image', 'illustration', 'render'] as const;
export const ASSET_ROLES = ['media', 'background', 'reference'] as const;
const TYPES: Record<string, { ext: string; max: number; video: boolean }> = {
  'image/jpeg': { ext: 'jpg', max: 30 * 1024 * 1024, video: false },
  'image/png': { ext: 'png', max: 30 * 1024 * 1024, video: false },
  'image/webp': { ext: 'webp', max: 30 * 1024 * 1024, video: false },
  'video/mp4': { ext: 'mp4', max: 200 * 1024 * 1024, video: true },
  'video/quicktime': { ext: 'mov', max: 200 * 1024 * 1024, video: true },
};

export type Asset = {
  id: string;
  name: string;
  kind: (typeof ASSET_KINDS)[number];
  origin: 'upload' | 'template' | 'ai-svg' | 'discovered';
  key: string;
  mime: string;
  bytes: number;
  lensPhoto: boolean;
  checkedPersonal: boolean;
  rights: Rights;
  status: 'uploading' | 'ready';
  createdAt: number;
  createdBy: string;
};
export type AssetRef = { id: string; role: (typeof ASSET_ROLES)[number] };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isId = (id: string) => /^[a-f0-9]{12}$/.test(id);
const need = () => {
  if (!BUCKET) throw new HttpError(503, 'Content storage isn’t set up yet');
};

/** Licensed media (anything we didn't make) may only be a background or a reference: owner decision 2026-11-02. */
export const licensed = (a: Pick<Asset, 'rights'>) => a.rights.license !== 'own';

export function readAssetRefs(v: unknown): AssetRef[] {
  if (!Array.isArray(v)) return [];
  const out: AssetRef[] = [];
  for (const x of v.slice(0, 20)) {
    const id = str((x as any)?.id, 20);
    if (!isId(id) || out.some((y) => y.id === id)) continue;
    const role = (ASSET_ROLES as readonly string[]).includes((x as any)?.role) ? ((x as any).role as AssetRef['role']) : 'media';
    out.push({ id, role });
  }
  return out;
}

export async function loadAssets(ids: string[]): Promise<Map<string, Asset>> {
  const out = new Map<string, Asset>();
  const keys = [...new Set(ids.filter(isId))];
  for (let i = 0; i < keys.length; i += 100) {
    const r = await ddb.send(new BatchGetCommand({ RequestItems: { [env.table]: { Keys: keys.slice(i, i + 100).map((id) => ({ pk: 'GROWTH', sk: `ASSET#${id}` })) } } }));
    for (const a of (r.Responses?.[env.table] ?? []) as Asset[]) out.set(a.id, a);
  }
  return out;
}

/** What the assets in a post stop: missing, not uploaded, rights not cleared, stock used as the main visual. */
export function assetProblems(refs: AssetRef[], assets: Map<string, Asset>): string[] {
  const p: string[] = [];
  for (const r of refs) {
    const a = assets.get(r.id);
    if (!a) {
      p.push('A media item was deleted from the library');
      continue;
    }
    if (a.status !== 'ready') p.push(`"${a.name}" hasn't finished uploading`);
    const st = effectiveStatus(a.rights);
    if (st === 'blocked') p.push(`"${a.name}" can't be used: ${a.rights.decision?.note || a.rights.reason}`);
    if (st === 'review') p.push(`"${a.name}" needs a rights decision in the Library (${a.rights.reason})`);
    if (licensed(a) && r.role === 'media') p.push(`"${a.name}" is licensed stock: use it only as a background or reference`);
  }
  return p;
}

/** A real photo taken with Lens is in the post (only then may it say "shot on Lens"). */
export const hasLensPhoto = (refs: AssetRef[], assets: Map<string, Asset>) => refs.some((r) => {
  const a = assets.get(r.id);
  return !!a && a.lensPhoto && a.status === 'ready' && effectiveStatus(a.rights) === 'cleared';
});

/** Credit lines for the post's licensed media. */
export const credits = (refs: AssetRef[], assets: Map<string, Asset>) =>
  [...new Set(refs.map((r) => assets.get(r.id)).filter((a): a is Asset => !!a && licensed(a)).map((a) => creditLine(a.rights.author, a.rights.license, a.rights.source)).filter(Boolean))];

/** A 5-minute link on the Console's own CloudFront (a/, e/ and x/ are served there, signed; see console-stack.ts). */
export async function viewUrl(key: string) {
  return signedCdnUrl(`${process.env.CONSOLE_ORIGIN}/${key.split('/').map(encodeURIComponent).join('/')}`, 300);
}

async function allAssets(): Promise<Asset[]> {
  const items: Asset[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'ASSET#' }, ExclusiveStartKey: start }));
    items.push(...((r.Items ?? []) as Asset[]));
    start = r.LastEvaluatedKey;
  } while (start);
  return items;
}

/** GET /growth/assets: the library with 5-minute view links and where each asset is used. */
export async function assetsPage(): Promise<Res> {
  need();
  const [assets, posts] = await Promise.all([allAssets(), ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'POST#' }, ProjectionExpression: 'id, title, assets' }))]);
  const usedIn = new Map<string, { id: string; title: string }[]>();
  for (const p of posts.Items ?? []) for (const r of (p.assets ?? []) as AssetRef[]) usedIn.set(r.id, [...(usedIn.get(r.id) ?? []), { id: p.id, title: p.title }]);
  const out = await Promise.all(
    assets
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(async (a) => ({ ...a, pk: undefined, sk: undefined, rightsStatus: effectiveStatus(a.rights), credit: creditLine(a.rights.author, a.rights.license, a.rights.source), url: a.status === 'ready' ? await viewUrl(a.key) : '', usedIn: usedIn.get(a.id) ?? [] })),
  );
  return json(200, { assets: out });
}

/** POST /growth/assets/upload: checks what the file is and who made it, then gives a 10-minute upload link. */
export async function assetUpload(req: Req, by: string): Promise<Res> {
  need();
  const b = req.body ?? {};
  const type = TYPES[String(b.contentType)];
  if (!type) throw new HttpError(400, 'Upload a JPEG, PNG or WebP image, or an MP4 or MOV video');
  const bytes = Number(b.bytes);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > type.max) throw new HttpError(400, `Too large: ${type.video ? 200 : 30} MB at most`);
  const name = str(b.name, 120);
  if (!name) throw new HttpError(400, 'Give it a name');
  const kind = (ASSET_KINDS as readonly string[]).includes(b.kind) ? (b.kind as Asset['kind']) : type.video ? 'video' : 'image';
  const madeByUs = b.madeBy !== 'other';
  // The owner's rule for recordings and photos from our phones: nothing personal on screen or in frame.
  if (madeByUs && b.checkedPersonal !== true) throw new HttpError(400, 'Check the file first: no personal photos, faces, names or notifications');
  const people = b.peopleOrBrands === true;
  let rights: Rights;
  if (madeByUs) {
    const v = licenseVerdict('own', people);
    rights = { status: v.status, license: 'own', licenseUrl: '', source: '', author: '', credit: '', commercialOk: true, editsOk: true, peopleOrBrands: people, reason: v.reason, checkedAt: Date.now(), checkedBy: by };
  } else {
    const license = str(b.license, 80);
    const source = str(b.source, 400);
    if (!/^https:\/\/\S+$/.test(source)) throw new HttpError(400, 'Add the page you got it from (https://…)');
    if (!license) throw new HttpError(400, 'Add the licence shown on that page');
    const v = licenseVerdict(license, people);
    const author = str(b.author, 120);
    rights = { status: v.status, license, licenseUrl: str(b.licenseUrl, 400), source, author, credit: creditLine(author, license, source), commercialOk: v.commercialOk, editsOk: v.editsOk, peopleOrBrands: people, reason: v.reason, checkedAt: Date.now(), checkedBy: by };
  }
  const id = randomBytes(6).toString('hex');
  const asset: Asset = { id, name, kind, origin: madeByUs ? 'upload' : 'discovered', key: `a/${id}.${type.ext}`, mime: String(b.contentType), bytes, lensPhoto: madeByUs && b.lensPhoto === true && !type.video, checkedPersonal: madeByUs, rights, status: 'uploading', createdAt: Date.now(), createdBy: by };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `ASSET#${id}`, ...asset } }));
  const url = await presign(s3, new PutObjectCommand({ Bucket: BUCKET, Key: `u/${id}.${type.ext}`, ContentType: asset.mime, ContentLength: bytes }), { expiresIn: 600 });
  await log({ entity: `growth:asset:${id}`, action: 'growth.asset-upload', actor: `console:${by}`, data: { kind, madeBy: madeByUs ? 'us' : 'other', rights: rights.status, license: rights.license } });
  return json(200, { asset, url, headers: { 'content-type': asset.mime } });
}

/** The first bytes match the type the uploader named (a renamed file can't slip in). */
export function signatureMatches(mime: string, head: Uint8Array): boolean {
  const hex = Buffer.from(head).toString('hex');
  const ascii = Buffer.from(head).toString('latin1');
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mime === 'image/png') return hex.startsWith('89504e470d0a1a0a');
  if (mime === 'image/webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  if (mime === 'video/mp4' || mime === 'video/quicktime') return ascii.slice(4, 8) === 'ftyp' || ascii.slice(4, 8) === 'moov' || ascii.slice(4, 8) === 'wide';
  return false;
}

/** POST /growth/assets/<id>/done: the upload finished; check it and move it into the library. */
export async function assetDone(id: string, by: string): Promise<Res> {
  need();
  if (!isId(id)) throw new HttpError(400, 'Bad id');
  const a = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${id}` } }))).Item as Asset | undefined;
  if (!a) throw new HttpError(404, 'No such file');
  if (a.status === 'ready') return json(200, { asset: a });
  const staged = `u/${a.key.slice(2)}`;
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: staged })).catch(() => undefined);
  if (!head) throw new HttpError(400, 'The upload didn’t finish. Try again.');
  const first = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: staged, Range: 'bytes=0-15' }));
  const bytes = await first.Body!.transformToByteArray();
  if (head.ContentLength !== a.bytes || !signatureMatches(a.mime, bytes)) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: staged }));
    await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${id}` } }));
    throw new HttpError(400, 'That file isn’t what it says it is (type or size), so it was removed');
  }
  await s3.send(new CopyObjectCommand({ Bucket: BUCKET, CopySource: `${BUCKET}/${staged}`, Key: a.key, ContentType: a.mime, MetadataDirective: 'REPLACE' }));
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: staged }));
  const ready = { ...a, status: 'ready' as const };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `ASSET#${id}`, ...ready } }));
  await log({ entity: `growth:asset:${id}`, action: 'growth.asset-ready', actor: `console:${by}` });
  return json(200, { asset: ready });
}

/** PUT /growth/assets/<id>/rights (managers): a person's rights decision with a note; blocked licences stay blocked. */
export async function assetRights(id: string, req: Req, by: string): Promise<Res> {
  if (!isId(id)) throw new HttpError(400, 'Bad id');
  const status = req.body?.status as RightsStatus;
  if (!['cleared', 'review', 'blocked'].includes(status)) throw new HttpError(400, 'Choose cleared, review or blocked');
  const note = str(req.body?.note, 500);
  if (status === 'cleared' && !note) throw new HttpError(400, 'Say why it’s fine to use (for example: model release on file)');
  const a = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${id}` } }))).Item as Asset | undefined;
  if (!a) throw new HttpError(404, 'No such file');
  if (a.rights.status === 'blocked' && status === 'cleared') throw new HttpError(400, `This licence can't be cleared: ${a.rights.reason}`);
  const rights = { ...a.rights, decision: { status, note, by, at: Date.now() } };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...a, pk: 'GROWTH', sk: `ASSET#${id}`, rights } }));
  await log({ entity: `growth:asset:${id}`, action: 'growth.asset-rights', actor: `console:${by}`, data: { status, note } });
  return json(200, { asset: { ...a, rights, rightsStatus: effectiveStatus(rights) } });
}

/** DELETE /growth/assets/<id> (managers): only when no post uses it. */
export async function assetDelete(id: string, by: string): Promise<Res> {
  need();
  if (!isId(id)) throw new HttpError(400, 'Bad id');
  const posts = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'POST#' }, ProjectionExpression: 'title, assets' }));
  const users = (posts.Items ?? []).filter((p) => ((p.assets ?? []) as AssetRef[]).some((r) => r.id === id));
  if (users.length) throw new HttpError(400, `Used in ${users.map((p) => `"${p.title}"`).join(', ')}: remove it there first`);
  const a = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${id}` } }))).Item as Asset | undefined;
  if (!a) throw new HttpError(404, 'No such file');
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: a.key })).catch(() => {});
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: `u/${a.key.slice(2)}` })).catch(() => {});
  await ddb.send(new DeleteCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `ASSET#${id}` } }));
  await log({ entity: `growth:asset:${id}`, action: 'growth.asset-delete', actor: `console:${by}`, data: { name: a.name } });
  return json(200, { ok: true });
}
