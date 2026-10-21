// Overview: real numbers from the Lens table, computed in one pass (parallel scan, counts only:
// no photos, names or emails leave this function) and cached for 10 minutes:
//
//   STATS  LIVE         → the latest overview
//   STATS  DAY#<date>   → the first overview of each day (kept: trends survive data deletion)
//
// Test traffic is left out: accounts flagged `test` (e2e sends x-lens-test), test emails, and
// for accounts made before the flag existed, guests created during an e2e run.
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, json, rateLimit, Req, Res } from '../api/lib';

const CACHE_MS = 10 * 60_000;
const DAY = 86_400_000;
const SERIES_DAYS = 90;
const TEST_EMAIL = '@e2e.lens.invalid';
/** Accounts made from here on carry `test` when they're test traffic; older ones are inferred. */
const TEST_FLAG_SINCE = Date.UTC(2026, 9, 22);
const E2E_WINDOW_MS = 4 * 60_000;

const cw = new CloudWatchClient({});

type Row = Record<string, any>;

async function scanAll(): Promise<Row[]> {
  const SEGMENTS = 4;
  const parts = await Promise.all(
    Array.from({ length: SEGMENTS }, async (_, segment) => {
      const out: Row[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const r = await ddb.send(
          new ScanCommand({
            TableName: env.table,
            Segment: segment,
            TotalSegments: SEGMENTS,
            ExclusiveStartKey: start,
            ProjectionExpression:
              'pk, sk, createdAt, email, test, fingerprint, attribution, usedBytes, bonusBytes, kind, #size, #status, #location, lastUsedAt, #at, archived, deletedAt, referral, #state, mode, expiresAt, gsi1pk',
            ExpressionAttributeNames: { '#size': 'size', '#status': 'status', '#location': 'location', '#at': 'at', '#state': 'state' },
          }),
        );
        out.push(...(r.Items ?? []));
        start = r.LastEvaluatedKey;
      } while (start);
      return out;
    }),
  );
  return parts.flat();
}

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

function series(times: number[], now: number) {
  const days: Record<string, number> = {};
  for (let i = SERIES_DAYS - 1; i >= 0; i--) days[dayKey(now - i * DAY)] = 0;
  for (const t of times) {
    const k = dayKey(t);
    if (k in days) days[k]++;
  }
  return Object.entries(days).map(([day, count]) => ({ day, count }));
}

async function bucketBytes(): Promise<number | null> {
  const types = ['StandardStorage', 'IntelligentTieringFAStorage', 'IntelligentTieringIAStorage', 'IntelligentTieringAIAStorage', 'StandardIAStorage', 'GlacierInstantRetrievalStorage', 'GlacierStorage', 'DeepArchiveStorage'];
  try {
    const r = await cw.send(
      new GetMetricDataCommand({
        StartTime: new Date(Date.now() - 3 * DAY),
        EndTime: new Date(),
        MetricDataQueries: types.map((t, i) => ({
          Id: `s${i}`,
          MetricStat: {
            Metric: { Namespace: 'AWS/S3', MetricName: 'BucketSizeBytes', Dimensions: [{ Name: 'BucketName', Value: env.bucket }, { Name: 'StorageType', Value: t }] },
            Period: 86400,
            Stat: 'Average',
          },
        })),
      }),
    );
    return (r.MetricDataResults ?? []).reduce((sum, m) => sum + (m.Values?.[0] ?? 0), 0);
  } catch (e) {
    console.error('bucket size', e);
    return null;
  }
}

export async function compute() {
  const now = Date.now();
  const [rows, s3Bytes] = await Promise.all([scanAll(), bucketBytes()]);

  // ---- who is real ----
  const profiles = rows.filter((r) => r.sk === 'PROFILE' && String(r.pk).startsWith('D#'));
  const testWindows = profiles.filter((p) => String(p.email ?? '').endsWith(TEST_EMAIL)).map((p) => p.createdAt as number).sort((a, b) => a - b);
  const nearTestRun = (t: number) => {
    let lo = 0;
    let hi = testWindows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (Math.abs(testWindows[mid] - t) <= E2E_WINDOW_MS) return true;
      if (testWindows[mid] < t) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  };
  const test = new Set<string>();
  for (const p of profiles) {
    const id = String(p.pk).slice(2);
    if (p.test || String(p.email ?? '').endsWith(TEST_EMAIL)) test.add(id);
    else if (p.createdAt < TEST_FLAG_SINCE && !p.email && nearTestRun(p.createdAt)) test.add(id);
  }
  const real = profiles.filter((p) => !test.has(String(p.pk).slice(2)));
  const realIds = new Set(real.map((p) => String(p.pk).slice(2)));
  const mine = (r: Row) => String(r.pk).startsWith('D#') && realIds.has(String(r.pk).slice(2));

  // ---- users ----
  const signedIn = real.filter((p) => p.email);
  const since = (t: number | undefined, days: number) => typeof t === 'number' && t >= now - days * DAY;
  const users = {
    total: real.length,
    signedIn: signedIn.length,
    guests: real.length - signedIn.length,
    new1d: real.filter((p) => since(p.createdAt, 1)).length,
    new7d: real.filter((p) => since(p.createdAt, 7)).length,
    new30d: real.filter((p) => since(p.createdAt, 30)).length,
    invited: real.filter((p) => p.attribution?.program === 'referral').length,
    viaAffiliate: real.filter((p) => p.attribution?.program === 'affiliate').length,
    testAccountsHidden: test.size,
    signups: series(real.map((p) => p.createdAt), now),
  };

  // ---- active (any session used) ----
  const lastUsed = new Map<string, number>();
  for (const r of rows) {
    if (!String(r.sk).startsWith('T#') || !mine(r) || typeof r.lastUsedAt !== 'number') continue;
    const id = String(r.pk).slice(2);
    lastUsed.set(id, Math.max(lastUsed.get(id) ?? 0, r.lastUsedAt));
  }
  const activeIn = (days: number) => [...lastUsed.values()].filter((t) => t >= now - days * DAY).length;
  const active = { d1: activeIn(1), d7: activeIn(7), d30: activeIn(30) };

  // ---- media ----
  const media = rows.filter((r) => String(r.sk).startsWith('M#') && mine(r));
  const live = media.filter((m) => !m.deletedAt);
  const ready = live.filter((m) => m.status === 'ready');
  const sum = (xs: Row[]) => xs.reduce((s, m) => s + (typeof m.size === 'number' ? m.size : 0), 0);
  const mediaStats = {
    items: live.length,
    photos: live.filter((m) => m.kind === 'photo').length,
    videos: live.filter((m) => m.kind === 'video').length,
    pending: live.filter((m) => m.status === 'pending').length,
    inTrash: media.filter((m) => m.deletedAt).length,
    inOwnStorage: ready.filter((m) => m.location).length,
    lensBytes: sum(ready.filter((m) => !m.location)),
    ownStorageBytes: sum(ready.filter((m) => m.location)),
    uploads: series(ready.map((m) => m.createdAt), now),
    uploads1d: ready.filter((m) => since(m.createdAt, 1)).length,
    uploads7d: ready.filter((m) => since(m.createdAt, 7)).length,
  };

  // ---- storage ----
  const storage = {
    accountedBytes: real.reduce((s, p) => s + (p.usedBytes ?? 0), 0),
    bonusBytes: real.reduce((s, p) => s + (p.bonusBytes ?? 0), 0),
    bucketBytes: s3Bytes,
  };

  // ---- sharing ----
  const count = (prefix: string, own = true) => rows.filter((r) => String(r.sk).startsWith(prefix) && (!own || mine(r))).length;
  const links = rows.filter((r) => String(r.pk).startsWith('LK#') && r.sk === 'LINK');
  const sharing = {
    shareRequests: count('OUT#'),
    contacts: count('C#'),
    albums: count('AL#') - rows.filter((r) => String(r.sk).startsWith('AL#') && mine(r) && r.code).length,
    sharedAlbumMembers: count('AM#'),
    links: links.length,
    linksActive: links.filter((l) => !l.expiresAt || l.expiresAt > now).length,
    events: rows.filter((r) => String(r.pk).startsWith('EV#') && r.sk === 'EVENT').length,
    recaps: count('R#'),
  };

  // ---- programs ----
  const referrals = rows.filter((r) => String(r.sk).startsWith('RF#') && mine(r));
  const affiliates = rows.filter((r) => r.sk === 'AFFILIATE' && mine(r));
  const byStatus = (xs: Row[], key: string) => xs.reduce<Record<string, number>>((m, x) => ((m[x[key] ?? 'unknown'] = (m[x[key] ?? 'unknown'] ?? 0) + 1), m), {});
  const programs = {
    referrals: referrals.length,
    referralsByState: byStatus(referrals, 'state'),
    affiliates: affiliates.length,
    affiliatesByStatus: byStatus(affiliates, 'status'),
  };

  // ---- to do ----
  const open = (pk: string) => rows.filter((r) => r.pk === pk && r.status === 'new');
  const feedback = open('FEEDBACK');
  const todo = {
    feedback: feedback.filter((f) => f.kind !== 'report').length,
    reports: feedback.filter((f) => f.kind === 'report').length,
    inbox: open('CONTACT').length,
    affiliatesToReview: affiliates.filter((a) => a.status === 'applied').length,
    referralsHeld: rows.filter((r) => r.gsi1pk === 'REF_HELD').length,
  };

  return { at: now, users, active, media: mediaStats, storage, sharing, programs, todo, table: { items: rows.length } };
}

/** GET /api/overview[?refresh=1] */
export async function overview(req: Req): Promise<Res> {
  const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'STATS', sk: 'LIVE' } }))).Item;
  const refresh = req.query.refresh === '1';
  if (cached && !refresh && Date.now() - cached.data.at < CACHE_MS) return json(200, { ...cached.data, cached: true });
  if (refresh) await rateLimit('console-overview-refresh', 60, 'Refreshed too often. Try again in a few minutes.');
  const data = await compute();
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'STATS', sk: 'LIVE', data } }));
  // Daily snapshot (first of the day): trend history that doesn't depend on rows that may be deleted later.
  const { users, active, media, storage, sharing, todo } = data;
  await ddb
    .send(
      new PutCommand({
        TableName: env.table,
        Item: {
          pk: 'STATS',
          sk: `DAY#${dayKey(data.at)}`,
          at: data.at,
          users: { total: users.total, signedIn: users.signedIn, guests: users.guests },
          active,
          media: { items: media.items, photos: media.photos, videos: media.videos, lensBytes: media.lensBytes },
          storage,
          sharing,
          todo,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    )
    .catch(() => {});
  return json(200, { ...data, cached: false });
}
