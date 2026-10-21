// Product analytics, our own (no third party). Two kinds of rows, read by the Lens Console:
//
//   ACT#<YYYY-MM-DD>  <accountId>  → this account used Lens that day { at, client, build?, os?,
//                                    tier?, region?, f_<feature>: count… } (kept 400 days)
//
// The API writes the row the first time an account is seen each day (authenticate → markActive).
// The app adds how often features were used that day (POST /v1/usage, src/lib/usage.ts): counts
// only — never photos, text, places or who they're with — and only while "Help improve Lens" is on.
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { Identity } from './identity';
import { ddb, env, HttpError, json, Req, Res } from './lib';

const KEEP_SECONDS = 400 * 86400;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FEATURE = /^[a-z][a-z0-9_]{1,40}$/;
const BATCH = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_FEATURES = 80;
const MAX_DAYS_BACK = 14;

const ttl = (now: number) => Math.floor(now / 1000) + KEEP_SECONDS;

/** First request of the day from this account: its activity row (and the profile remembers the day). */
export async function markActive(accountId: string, day: string, client: 'app' | 'web', now = Date.now()) {
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `ACT#${day}`, sk: accountId },
      UpdateExpression: 'SET #at = if_not_exists(#at, :n), #c = if_not_exists(#c, :c), #ttl = :t',
      ExpressionAttributeNames: { '#at': 'at', '#c': 'client', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':n': now, ':c': client, ':t': ttl(now) },
    }),
  );
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `D#${accountId}`, sk: 'PROFILE' },
      UpdateExpression: 'SET activeDay = :d',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeValues: { ':d': day },
    }),
  );
}

const short = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max && /^[\w .+()-]*$/.test(v) ? v : undefined);

/**
 * POST /v1/usage {batch, build?, os?, tier?, region?, days: [{day, counts: {feature: n}}]}
 * Counts are added once per batch id (a retried upload doesn't count twice).
 */
export async function saveUsage(identity: Identity, req: Req): Promise<Res> {
  const batch = String(req.body?.batch ?? '');
  if (!BATCH.test(batch)) throw new HttpError(400, 'batch is required');
  const days = Array.isArray(req.body?.days) ? req.body.days.slice(0, MAX_DAYS_BACK + 1) : [];
  const now = Date.now();
  const oldest = new Date(now - MAX_DAYS_BACK * 86_400_000).toISOString().slice(0, 10);
  const today = new Date(now + 14 * 3600_000).toISOString().slice(0, 10); // phones ahead of UTC
  const meta = {
    build: short(req.body?.build, 20),
    os: short(req.body?.os, 20),
    tier: short(req.body?.tier, 20),
    region: short(req.body?.region, 2)?.toUpperCase(),
  };
  let saved = 0;
  for (const d of days) {
    const day = String(d?.day ?? '');
    if (!DAY.test(day) || day < oldest || day > today) continue;
    const counts = Object.entries((d?.counts ?? {}) as Record<string, unknown>)
      .filter(([k, v]) => FEATURE.test(k) && Number.isInteger(v) && (v as number) > 0 && (v as number) <= 100_000)
      .slice(0, MAX_FEATURES) as [string, number][];
    const names: Record<string, string> = { '#at': 'at', '#c': 'client', '#ttl': 'ttl', '#b': 'batches' };
    const values: Record<string, unknown> = { ':n': now, ':c': 'app', ':t': ttl(now), ':bs': new Set([batch]), ':b': batch };
    const sets = ['#at = if_not_exists(#at, :n)', '#c = if_not_exists(#c, :c)', '#ttl = :t'];
    for (const [k, v] of Object.entries(meta)) {
      if (!v) continue;
      names[`#${k}`] = k;
      values[`:${k}`] = v;
      sets.push(`#${k} = :${k}`);
    }
    const adds = ['#b :bs'];
    counts.forEach(([k, v], i) => {
      names[`#f${i}`] = `f_${k}`;
      values[`:f${i}`] = v;
      adds.push(`#f${i} :f${i}`);
    });
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: env.table,
          Key: { pk: `ACT#${day}`, sk: identity.id },
          UpdateExpression: `SET ${sets.join(', ')} ADD ${adds.join(', ')}`,
          ConditionExpression: 'attribute_not_exists(#b) OR NOT contains(#b, :b)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        }),
      );
      saved++;
    } catch (e) {
      if ((e as { name?: string })?.name !== 'ConditionalCheckFailedException') throw e; // already counted
    }
  }
  return json(200, { saved });
}
