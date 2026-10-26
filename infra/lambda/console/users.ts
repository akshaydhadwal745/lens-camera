// Users: find an account and see its facts. Never photos or videos (owner's rule): only counts,
// sizes, dates, devices and program status. Opening an account is audited (index.ts).
import { GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, json, quotaFor, Req, Res } from '../api/lib';
import { extraForConsole } from '../api/extra-storage';
import { activatePlan, deletionAt, lapsePlan, paymentFailed, PLANS } from '../api/plans';
import { testAccounts } from './overview';

const TEST_EMAIL = '@e2e.lens.invalid';
const ID = /^[A-Za-z0-9_-]{6,40}$/;

type Row = Record<string, any>;

const summary = (p: Row) => ({
  id: String(p.pk).slice(2),
  name: p.name,
  email: p.email,
  signedIn: !!p.email,
  createdAt: p.createdAt,
  usedBytes: p.usedBytes ?? 0,
  bonusBytes: p.bonusBytes ?? 0,
  logins: p.logins ? [...p.logins] : [],
  test: !!p.test || String(p.email ?? '').endsWith(TEST_EMAIL),
});

/** GET /api/users?q=&tests=1: newest first; q matches email, name or id. */
export async function userSearch(req: Req): Promise<Res> {
  const q = String(req.query.q ?? '').trim().toLowerCase().slice(0, 120);
  const withTests = req.query.tests === '1';
  // Exact email or id: direct lookups.
  if (q.includes('@')) {
    const acc = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `ID#email#${q}`, sk: 'ACCOUNT' } }))).Item;
    const id = acc?.accountId;
    if (!id) return json(200, { users: [] });
    const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' } }))).Item;
    return json(200, { users: p ? [summary(p)] : [] });
  }
  const out: Row[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: env.table,
        FilterExpression: 'sk = :p OR sk = :d',
        ExpressionAttributeValues: { ':p': 'PROFILE', ':d': 'DEVICE' },
        ProjectionExpression: 'pk, sk, #n, email, createdAt, usedBytes, bonusBytes, logins, test, emulator, guestId',
        ExpressionAttributeNames: { '#n': 'name' },
        ExclusiveStartKey: start,
      }),
    );
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  const profiles = out.filter((p) => p.sk === 'PROFILE' && String(p.pk).startsWith('D#'));
  const tests = testAccounts(profiles, out.filter((d) => d.sk === 'DEVICE'));
  let users = profiles.map((p) => ({ ...summary(p), test: tests.has(String(p.pk).slice(2)) }));
  if (!withTests) users = users.filter((u) => !u.test);
  if (q) users = users.filter((u) => u.id.toLowerCase() === q || String(u.name ?? '').toLowerCase().includes(q) || String(u.email ?? '').includes(q));
  users.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return json(200, { users: users.slice(0, 200), total: users.length });
}

async function all(pk: string, prefix: string, projection: string, names?: Record<string, string>) {
  const out: Row[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: env.table,
        KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)',
        ExpressionAttributeValues: { ':p': pk, ':s': prefix },
        ProjectionExpression: projection,
        ExpressionAttributeNames: names,
        ExclusiveStartKey: start,
      }),
    );
    out.push(...(r.Items ?? []));
    start = r.LastEvaluatedKey;
  } while (start);
  return out;
}

/** GET /api/users/<id>: one account's facts. */
export async function userDetail(id: string): Promise<Res> {
  if (!ID.test(id)) throw new HttpError(404, 'Not found');
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' } }))).Item;
  if (!p) throw new HttpError(404, 'No such account');
  const [media, sessions, affiliate, referrals, links, albums, extra] = await Promise.all([
    all(`D#${id}`, 'M#', 'kind, #size, #status, createdAt, deletedAt, archived, #loc', { '#size': 'size', '#status': 'status', '#loc': 'location' }),
    all(`D#${id}`, 'T#', 'device, browser, createdAt, lastUsedAt'),
    ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'AFFILIATE' }, ProjectionExpression: '#s, appliedAt', ExpressionAttributeNames: { '#s': 'status' } })),
    all(`D#${id}`, 'RF#', '#st, updatedAt', { '#st': 'state' }),
    all(`D#${id}`, 'LKO#', 'createdAt'),
    all(`D#${id}`, 'AL#', 'createdAt, code'),
    extraForConsole(id),
  ]);
  const live = media.filter((m) => !m.deletedAt);
  const ready = live.filter((m) => m.status === 'ready');
  const bytes = (xs: Row[]) => xs.reduce((s, m) => s + (m.size ?? 0), 0);
  return json(200, {
    user: summary(p),
    attribution: p.attribution ? { program: p.attribution.program, source: p.attribution.source, at: p.attribution.at } : null,
    referral: p.referral ?? null,
    storage: {
      quotaBytes: quotaFor(p),
      welcomeUntil: p.welcomeUntil ?? null,
      plan: p.plan ?? null,
      // Extra storage above Lens Plus (₹3 per GB-month): cap, use now, this period, bills.
      extra: extra?.capGB || extra?.bills.length
        ? { capGB: extra.capGB, extraBytes: extra.extraBytes, soFarPaise: extra.soFarPaise, estimatePaise: extra.estimatePaise, bills: extra.bills.slice(0, 6) }
        : null,
      overLimitSince: p.overLimitSince ?? null,
      deletionAt: p.overLimitSince ? deletionAt(p.overLimitSince) : null,
    },
    media: {
      items: live.length,
      photos: live.filter((m) => m.kind === 'photo').length,
      videos: live.filter((m) => m.kind === 'video').length,
      pending: live.filter((m) => m.status === 'pending').length,
      inTrash: media.filter((m) => m.deletedAt && !m.archived).length,
      archived: media.filter((m) => m.archived).length,
      lensBytes: bytes(ready.filter((m) => !m.location)),
      ownStorageItems: ready.filter((m) => m.location).length,
      lastUploadAt: ready.reduce((t, m) => Math.max(t, m.createdAt ?? 0), 0) || null,
    },
    devices: sessions
      .map((s) => ({ name: s.device ?? s.browser ?? 'Unknown', web: !!s.browser, since: s.createdAt, lastUsedAt: s.lastUsedAt }))
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)),
    sharing: { links: links.length, albums: albums.filter((a) => !a.code).length },
    programs: {
      affiliate: affiliate.Item?.status ?? null,
      invites: referrals.length,
      invitesByState: referrals.reduce<Record<string, number>>((m, r) => ((m[r.state ?? 'unknown'] = (m[r.state ?? 'unknown'] ?? 0) + 1), m), {}),
    },
  });
}

/**
 * POST /api/users/<id>/plan {action: 'grant' | 'payment-failed' | 'end', planId?, months?}
 * Support tools (and testing before payments go live): give a plan for N months (no charge),
 * simulate a failed renewal (7-day grace), or end a plan (back to Free; nothing is deleted).
 */
export async function changePlan(id: string, by: string, req: Req): Promise<Res> {
  if (!ID.test(id)) throw new HttpError(404, 'Not found');
  const p = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' } }))).Item;
  if (!p?.email) throw new HttpError(400, 'Plans are for signed-in accounts');
  const action = req.body?.action;
  if (action === 'grant') {
    const planId = String(req.body?.planId ?? 'plus50');
    if (!PLANS[planId]) throw new HttpError(400, 'Unknown plan');
    const months = Math.max(1, Math.min(12, Math.round(Number(req.body?.months) || 1)));
    const plan = await activatePlan(id, { id: planId, periodEnd: Date.now() + months * 30 * 86_400_000, provider: 'manual', ref: `console:${by}` }, `console:${by}`);
    return json(200, { plan });
  }
  if (action === 'payment-failed') return json(200, { plan: (await paymentFailed(id, `console:${by}`)) ?? null });
  if (action === 'end') return json(200, { plan: (await lapsePlan(id, `console:${by}`)) ?? null });
  throw new HttpError(400, 'action must be grant, payment-failed or end');
}
