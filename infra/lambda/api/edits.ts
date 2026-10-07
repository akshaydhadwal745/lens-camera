// Non-destructive edits: the original object is never touched. An edit is a
// small JSON recipe plus a re-rendered thumbnail/preview (rendered on the
// phone) stored under a new version so every device and CDN sees the new look.
import { DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { Identity } from './identity';
import { ddb, env, HttpError, json, Req, Res, s3 } from './lib';
import {
  DERIVATIVES,
  derivativeKey,
  derivativeUrls,
  mediaKey,
  parseDerivatives,
  requireMedia,
  toClient,
} from './media';

const MAX_EDIT_BYTES = 8 * 1024;

function parseEdit(value: unknown): Record<string, unknown> | null {
  if (value === null) return null; // reset to original
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Invalid edit');
  if (JSON.stringify(value).length > MAX_EDIT_BYTES) throw new HttpError(413, 'Edit too large');
  return value as Record<string, unknown>;
}

/**
 * POST /v1/media/:id/edit {edit, derivatives:{thumb,preview}}: start saving an
 * edit. Returns upload URLs for the re-rendered thumbnail + preview.
 */
export async function startEdit(identity: Identity, id: string, req: Req): Promise<Res> {
  const item = await requireMedia(identity, id);
  const edit = parseEdit(req.body.edit);
  const derivatives = parseDerivatives(req.body.derivatives);
  if (!derivatives?.thumb || !derivatives.preview) throw new HttpError(400, 'Thumbnail and preview required');

  const version = Math.max(item.derivVersion ?? 0, item.pendingDerivVersion ?? 0) + 1;
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: mediaKey(identity.id, id),
      UpdateExpression: 'SET pendingDerivVersion = :v, pendingEdit = :e',
      ExpressionAttributeValues: { ':v': version, ':e': edit },
    }),
  );
  return json(200, { version, derivativeUrls: await derivativeUrls(item, derivatives, version, true) });
}

/** POST /v1/media/:id/edit/commit {version}: verify uploads, switch to the new look. */
export async function commitEdit(identity: Identity, id: string, req: Req): Promise<Res> {
  const item = await requireMedia(identity, id);
  const version = Number(req.body.version);
  if (!Number.isInteger(version) || version !== item.pendingDerivVersion) throw new HttpError(409, 'Unknown edit version');

  for (const name of DERIVATIVES) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: env.bucket, Key: derivativeKey(item.key, name, version) }));
    } catch (error: any) {
      if (error?.name === 'NotFound') throw new HttpError(409, `${name} not uploaded yet`);
      throw error;
    }
  }

  const edit = item.pendingEdit ?? null;
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: mediaKey(identity.id, id),
      UpdateExpression: edit
        ? 'SET derivVersion = :v, previewReady = :t, edit = :e REMOVE pendingDerivVersion, pendingEdit'
        : 'SET derivVersion = :v, previewReady = :t REMOVE pendingDerivVersion, pendingEdit, edit',
      ConditionExpression: 'pendingDerivVersion = :v',
      ExpressionAttributeValues: edit ? { ':v': version, ':t': true, ':e': edit } : { ':v': version, ':t': true },
    }),
  );

  // Old rendered versions are no longer referenced.
  const old = item.derivVersion ?? 0;
  if (old !== version) {
    await Promise.all(
      DERIVATIVES.map((name) =>
        s3.send(new DeleteObjectCommand({ Bucket: env.bucket, Key: derivativeKey(item.key, name, old) })).catch(() => {}),
      ),
    );
  }

  return json(200, {
    media: await toClient({ ...item, derivVersion: version, previewReady: true, edit: edit ?? undefined }),
  });
}
