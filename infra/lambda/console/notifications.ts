// Console → Notifications: campaigns (compose, audience, schedule, stats) and lifecycle numbers.
// Sending happens in the Maintenance function (api/campaigns.ts), every 15 minutes.
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { cancelCampaign, createCampaign, getCampaign, listCampaigns, resolveAudience, validate } from '../api/campaigns';
import { ddb, env, HttpError, json, Req, Res } from '../api/lib';

/** The console user's own Lens account (same Google email), for test sends. */
async function ownAccount(email: string): Promise<string | null> {
  const r = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `ID#email#${email}`, sk: 'ACCOUNT' } }))).Item;
  return (r?.accountId as string) ?? null;
}

export async function campaigns(): Promise<Res> {
  return json(200, { campaigns: await listCampaigns(50) });
}

/** POST /api/notifications/estimate {audience}: how many people, and how many can get pushes. */
export async function estimate(req: Req): Promise<Res> {
  const v = validate({ title: 'xxx', body: 'xxxxx', audience: req.body?.audience });
  const { ids, reachable } = await resolveAudience(v.audience);
  return json(200, { matched: ids.length, reachable });
}

/** POST /api/notifications {title, body, route, category, audience, scheduledAt?, test?} */
export async function createNotification(email: string, req: Req): Promise<Res> {
  const input = { ...(req.body ?? {}) };
  if (input.test === true) {
    const own = await ownAccount(email);
    if (!own) throw new HttpError(400, `No Lens account signed in with ${email}: sign in to the Lens app with this Google account to get test sends.`);
    input.audience = { only: [own] };
    input.scheduledAt = Date.now();
  }
  const c = await createCampaign(input, email);
  return json(200, { campaign: c });
}

export async function stopNotification(id: string): Promise<Res> {
  await cancelCampaign(id);
  return json(200, { campaign: await getCampaign(id) });
}

/** GET /api/notifications/lifecycle?days=30: sent/opened/skipped per automatic notification. */
export async function lifecycleStats(req: Req): Promise<Res> {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows: Record<string, any>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND sk >= :f', ExpressionAttributeValues: { ':p': 'NSTAT', ':f': from }, ExclusiveStartKey: start }));
    rows.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  // sk = <day>#<result>#<name>, or <day>#optout#<category>
  const table: Record<string, Record<string, number>> = {};
  const optouts: Record<string, number> = {};
  for (const r of rows) {
    const [, a, b] = String(r.sk).split('#');
    if (a === 'optout') optouts[b] = (optouts[b] ?? 0) + (r.count ?? 0);
    else if (b) (table[b] ??= {})[a] = (table[b]?.[a] ?? 0) + (r.count ?? 0);
  }
  return json(200, { days, lifecycle: table, optouts });
}
