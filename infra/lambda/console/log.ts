// Console audit: every sign-in, failed code, team change and admin action. Written to the
// tamper-proof audit trail (api/audit.ts: DynamoDB + S3 Object Lock) and to a monthly
// console feed for Activity:  CAUDIT#<YYYY-MM>  <at>#<id>
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { audit, AuditEvent } from '../api/audit';
import { ddb, env, json, randomId, Req, Res } from '../api/lib';

const KEEP_SECONDS = 400 * 86400;

export async function log(event: AuditEvent): Promise<void> {
  await audit(event);
  const at = Date.now();
  await ddb.send(
    new PutCommand({
      TableName: env.table,
      Item: {
        pk: `CAUDIT#${new Date(at).toISOString().slice(0, 7)}`,
        sk: `${String(at).padStart(15, '0')}#${randomId(6)}`,
        ...event,
        at,
        ttl: Math.floor(at / 1000) + KEEP_SECONDS,
      },
    }),
  );
}

/** GET /api/activity?month=YYYY-MM: newest first. */
export async function activity(req: Req): Promise<Res> {
  const month = /^\d{4}-\d{2}$/.test(req.query.month ?? '') ? req.query.month! : new Date().toISOString().slice(0, 7);
  const r = await ddb.send(
    new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `CAUDIT#${month}` }, ScanIndexForward: false, Limit: 500 }),
  );
  return json(200, { month, events: (r.Items ?? []).map(({ pk: _p, sk: _s, ttl: _t, ...e }) => e) });
}
