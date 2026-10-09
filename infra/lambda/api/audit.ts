// Audit trail for the referral and affiliate programs (and anything else
// involving money or rewards). Every state change is written twice:
//  - DynamoDB `AU#<entity>` items, to search and show in admin;
//  - one JSON object per event in an S3 bucket with Object Lock (compliance
//    mode), so nobody (not even us) can edit or delete history afterwards.
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, randomId, s3 } from './lib';

export type AuditEvent = {
  /** What the event is about, e.g. "affiliate:abc", "referral:xyz", "payout:2026-10:abc". */
  entity: string;
  /** e.g. "referral.rewarded", "commission.reversed". */
  action: string;
  /** Who did it: an account id, "system", or "admin:<id>". */
  actor: string;
  data?: Record<string, unknown>;
};

export async function audit(event: AuditEvent): Promise<void> {
  const at = Date.now();
  const id = randomId(6);
  const record = { ...event, at, id };
  await ddb.send(
    new PutCommand({ TableName: env.table, Item: { pk: `AU#${event.entity}`, sk: `${String(at).padStart(15, '0')}#${id}`, ...record } }),
  );
  if (env.auditBucket) {
    const d = new Date(at).toISOString();
    await s3.send(
      new PutObjectCommand({
        Bucket: env.auditBucket,
        Key: `audit/${d.slice(0, 10)}/${event.entity.replace(/[^A-Za-z0-9:_-]/g, '_')}/${d}-${id}.json`,
        Body: JSON.stringify(record),
        ContentType: 'application/json',
      }),
    );
  }
}
