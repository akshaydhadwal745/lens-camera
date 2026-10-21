// Screenshots users attached to their feedback: the only user images the console can open
// (its role can read the feedback bucket, never the media bucket). Served through this API
// (same origin, strict CSP, nothing public) and every view is recorded.
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, Res, s3 } from '../api/lib';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** GET /api/feedback/<id>/files/<n> */
export async function feedbackFile(id: string, n: number): Promise<Res> {
  if (!env.feedbackBucket || !/^\d{15}#[A-Za-z0-9_-]+$/.test(id) || !Number.isInteger(n) || n < 0 || n > 2) throw new HttpError(404, 'Not found');
  const row = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'FEEDBACK', sk: id }, ProjectionExpression: 'attachments' }))).Item;
  const key = row?.attachments?.[n];
  if (typeof key !== 'string') throw new HttpError(404, 'Not found');
  const obj = await s3.send(new GetObjectCommand({ Bucket: env.feedbackBucket, Key: key })).catch(() => null);
  if (!obj?.Body) throw new HttpError(404, 'This screenshot was deleted');
  const body = Buffer.from(await obj.Body.transformToByteArray());
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'content-type': TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream',
      'cache-control': 'private, no-store',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
    },
    body: body.toString('base64'),
  };
}
