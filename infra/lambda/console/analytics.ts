// Product analytics (our own: docs/design/analytics.md). From the Lens table, real accounts only:
//   - funnel: installed → uploaded → signed in → shared → came back 7+ days later
//   - retention: weekly install cohorts, share active in each later week (ACT# rows)
//   - active users: daily / weekly / monthly (ACT# rows)
//   - feature use: people and uses per feature (app counts f_* on ACT# rows + server records)
//   - breakdowns: app build, Android version, camera tier, region, app vs web
// Counts only; cached 30 minutes (STATS ANALYTICS#<window>).
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, json, rateLimit, Req, Res } from '../api/lib';
import { planActive } from '../api/plans';
import { byChannel } from './channels';
import { scanAll, testAccounts } from './overview';

const DAY = 86_400_000;
const CACHE_MS = 30 * 60_000;
const WINDOWS = { '30': 30, '90': 90, all: 100_000 } as const;

type Row = Record<string, any>;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const dayStart = (k: string) => Date.parse(`${k}T00:00:00Z`);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Monday of the week (UTC) as YYYY-MM-DD. */
const weekOf = (t: number) => {
  const d = new Date(t);
  const back = (d.getUTCDay() + 6) % 7;
  return dayKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
};
const tsOf = (r: Row) => (typeof r.createdAt === 'number' ? r.createdAt : typeof r.at === 'number' ? r.at : typeof r.updatedAt === 'number' ? r.updatedAt : undefined);

/** Website (our own beacon, api/web-events.ts): daily totals for the last 30 days. */
async function website(now: number) {
  const days = Array.from({ length: 30 }, (_, i) => dayKey(now - (29 - i) * DAY));
  const rows = await Promise.all(
    days.map(async (day) => {
      const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': `WSTAT#${day}` } }));
      return { day, items: r.Items ?? [] };
    }),
  );
  const sum = (prefix: string) => {
    const m = new Map<string, number>();
    for (const d of rows) for (const i of d.items) if (String(i.sk).startsWith(prefix)) m.set(String(i.sk).slice(prefix.length), (m.get(String(i.sk).slice(prefix.length)) ?? 0) + (i.count ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
  };
  const daily = rows.map((d) => ({
    day: d.day,
    visits: d.items.find((i) => i.sk === 'visit')?.count ?? 0,
    pageviews: d.items.filter((i) => String(i.sk).startsWith('pv#')).reduce((s, i) => s + (i.count ?? 0), 0),
    getLens: d.items.filter((i) => ['ev#get_lens', 'ev#apk_download', 'ev#play_store'].includes(String(i.sk))).reduce((s, i) => s + (i.count ?? 0), 0),
  }));
  const visits = daily.reduce((s, d) => s + d.visits, 0);
  const getLens = daily.reduce((s, d) => s + d.getLens, 0);
  const total = (key: string) => rows.reduce((s, d) => s + (d.items.find((i) => i.sk === key)?.count ?? 0), 0);
  const counts = (prefix: string) => new Map(sum(prefix).map((x) => [x.label, x.count]));
  // Landing pages: visits that started there, how many engaged, how many clicked Get Lens (any of the three).
  const engagedFrom = counts('engl#');
  const getLensFrom = new Map<string, number>();
  for (const e of ['get_lens', 'apk_download', 'play_store']) for (const [k, n] of counts(`evl#${e}#`)) getLensFrom.set(k, (getLensFrom.get(k) ?? 0) + n);
  const landing = sum('land#')
    .slice(0, 25)
    .map(({ label, count }) => ({ path: label, visits: count, engaged: engagedFrom.get(label) ?? 0, getLens: getLensFrom.get(label) ?? 0 }));
  // Pages: views, average seconds visible, share engaged (≥10 s) and scrolled to 75 %.
  const timed = counts('tv#');
  const seconds = counts('tsum#');
  const engagedViews = counts('eng#');
  const deep = counts('sc75#');
  const pageQuality = sum('pv#')
    .slice(0, 25)
    .map(({ label, count }) => {
      const tv = timed.get(label) ?? 0;
      return { path: label, views: count, avgSeconds: tv ? Math.round((seconds.get(label) ?? 0) / tv) : null, engagedRate: tv ? (engagedViews.get(label) ?? 0) / tv : null, scrollRate: tv ? (deep.get(label) ?? 0) / tv : null };
    });
  const engagedVisits = total('engv');
  return {
    daily,
    visits,
    pageviews: daily.reduce((s, d) => s + d.pageviews, 0),
    getLens,
    getLensRate: visits ? getLens / visits : null,
    pages: sum('pv#').slice(0, 20),
    sources: sum('src#').filter((s) => s.label !== 'internal').slice(0, 15),
    events: sum('ev#'),
    getLensFrom: sum('evp#get_lens#').slice(0, 10),
    // From 2026-10-30 (beacon v2): engagement, landing pages, campaigns, countries, devices.
    engagedVisits,
    engagedRate: visits ? engagedVisits / visits : null,
    landing,
    pageQuality,
    mediums: sum('med#').slice(0, 10),
    campaigns: sum('camp#').slice(0, 15),
    countries: sum('cty#').slice(0, 15),
    devices: sum('dev#'),
  };
}

/** D1/D7/D30 by channel look this far back (a 30-day window has no install old enough for D30). */
const RETENTION_DAYS = 90;

export async function compute(windowDays: number) {
  const now = Date.now();
  const rows = await scanAll(true);
  const profiles = rows.filter((r) => r.sk === 'PROFILE' && String(r.pk).startsWith('D#'));
  const test = testAccounts(profiles, rows.filter((r) => r.sk === 'DEVICE' && String(r.pk).startsWith('FP#')));
  const real = new Map(profiles.filter((p) => !test.has(String(p.pk).slice(2))).map((p) => [String(p.pk).slice(2), p]));
  const owner = (r: Row) => (String(r.pk).startsWith('D#') ? String(r.pk).slice(2) : undefined);

  // ---- per account: first time each step happened ----
  const first = new Map<string, { upload?: number; signin?: number; share?: number }>();
  const mark = (id: string | undefined, step: 'upload' | 'signin' | 'share', t: number | undefined) => {
    if (!id || t === undefined || !real.has(id)) return;
    const f = first.get(id) ?? {};
    if (f[step] === undefined || t < f[step]!) f[step] = t;
    first.set(id, f);
  };
  // Activity days per account (ACT#), and the last-session fallback for "came back".
  const activeDays = new Map<string, Set<string>>();
  const lastUsed = new Map<string, number>();
  const actRows: Row[] = [];
  // North star (docs/growth/growth-workspace.md): weekly backup users = real accounts with a finished
  // upload in that 7-day window; weeks counted back from now (0 = the last 7 days).
  const backupWeeks: Set<string>[] = Array.from({ length: 8 }, () => new Set<string>());
  for (const r of rows) {
    const pk = String(r.pk);
    const sk = String(r.sk);
    if (pk.startsWith('ACT#')) {
      if (!real.has(sk)) continue;
      actRows.push(r);
      const set = activeDays.get(sk) ?? new Set<string>();
      set.add(pk.slice(4));
      activeDays.set(sk, set);
      continue;
    }
    const id = owner(r);
    if (sk.startsWith('M#') && r.status === 'ready' && !r.deletedAt) {
      mark(id, 'upload', tsOf(r));
      const t = tsOf(r);
      const w = t === undefined ? -1 : Math.floor((now - t) / (7 * DAY));
      if (id && real.has(id) && w >= 0 && w < 8) backupWeeks[w].add(id);
    }
    else if (sk.startsWith('OUT#') || sk.startsWith('LKO#') || sk.startsWith('AM#')) mark(id, 'share', tsOf(r));
    else if (sk.startsWith('T#') && id && typeof r.lastUsedAt === 'number') lastUsed.set(id, Math.max(lastUsed.get(id) ?? 0, r.lastUsedAt));
    else if (sk === 'ACCOUNT' && pk.startsWith('ID#') && r.accountId) mark(String(r.accountId), 'signin', tsOf(r));
  }
  for (const [id, p] of real) {
    if (typeof p.signedInAt === 'number') {
      const f = first.get(id) ?? {};
      f.signin = Math.min(f.signin ?? Infinity, p.signedInAt);
      first.set(id, f);
    }
  }
  const trackingSince = [...activeDays.values()].flatMap((s) => [...s]).sort()[0] ?? null;

  // ---- funnel (accounts installed in the window) ----
  const cohort = [...real.entries()].filter(([, p]) => p.createdAt >= now - windowDays * DAY);
  const cameBack = (id: string, installedAt: number) => {
    const days = activeDays.get(id);
    if (days && [...days].some((d) => dayStart(d) >= installedAt + 7 * DAY)) return true;
    return (lastUsed.get(id) ?? 0) >= installedAt + 7 * DAY;
  };
  const stepDefs: { key: string; label: string; test: (id: string, p: Row) => number | boolean | undefined }[] = [
    { key: 'install', label: 'Installed (opened Lens)', test: () => true },
    { key: 'upload', label: 'Backed up a photo or video', test: (id) => first.get(id)?.upload },
    { key: 'signin', label: 'Signed in', test: (id, p) => first.get(id)?.signin ?? (p.email ? true : undefined) },
    { key: 'share', label: 'Shared (link, friend or album)', test: (id) => first.get(id)?.share },
    { key: 'return', label: 'Came back 7+ days later', test: (id, p) => (p.createdAt <= now - 7 * DAY && cameBack(id, p.createdAt)) || undefined },
  ];
  const funnel = stepDefs.map((s) => {
    const reached = cohort.filter(([id, p]) => s.test(id, p));
    const times = reached.map(([id, p]) => s.test(id, p)).filter((t): t is number => typeof t === 'number');
    const installs = new Map(cohort);
    const hours = reached
      .map(([id]) => {
        const t = s.test(id, installs.get(id)!);
        return typeof t === 'number' ? (t - installs.get(id)!.createdAt) / 3_600_000 : null;
      })
      .filter((h): h is number => h !== null && h >= 0);
    return { key: s.key, label: s.label, count: reached.length, medianHoursToReach: s.key === 'install' || s.key === 'return' ? null : median(hours), _t: times.length };
  });
  const eligibleForReturn = cohort.filter(([, p]) => p.createdAt <= now - 7 * DAY).length;

  // ---- active users (ACT#) ----
  const byDay = new Map<string, Set<string>>();
  for (const r of actRows) {
    const d = String(r.pk).slice(4);
    const set = byDay.get(d) ?? new Set<string>();
    set.add(String(r.sk));
    byDay.set(d, set);
  }
  const active = [];
  for (let i = 89; i >= 0; i--) {
    const d = dayKey(now - i * DAY);
    const union = (n: number) => {
      const u = new Set<string>();
      for (let k = 0; k < n; k++) for (const id of byDay.get(dayKey(dayStart(d) - k * DAY)) ?? []) u.add(id);
      return u.size;
    };
    active.push({ day: d, dau: byDay.get(d)?.size ?? 0, wau: union(7), mau: union(30) });
  }
  const today = active[active.length - 1];

  // ---- retention: weekly cohorts ----
  const cohorts = new Map<string, string[]>();
  for (const [id, p] of real) {
    if (p.createdAt < now - 12 * 7 * DAY) continue;
    const w = weekOf(p.createdAt);
    cohorts.set(w, [...(cohorts.get(w) ?? []), id]);
  }
  const retention = [...cohorts.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([week, ids]) => ({
      week,
      size: ids.length,
      weeks: Array.from({ length: 9 }, (_, k) => {
        const from = dayStart(week) + k * 7 * DAY;
        const to = from + 7 * DAY;
        if (to > now + DAY) return null; // that week hasn't finished
        if (trackingSince && to <= dayStart(trackingSince)) return null; // before tracking started
        if (!trackingSince) return null;
        const kept = ids.filter((id) => [...(activeDays.get(id) ?? [])].some((d) => dayStart(d) >= from && dayStart(d) < to)).length;
        return ids.length ? kept / ids.length : null;
      }),
    }));

  // ---- feature use ----
  const since = (days: number) => now - days * DAY;
  const featureUse = new Map<string, { users7: Set<string>; uses7: number; users30: Set<string>; uses30: number; weekly: Map<string, Set<string>> }>();
  const use = (name: string, id: string, t: number, n = 1) => {
    if (t < since(84)) return;
    const f = featureUse.get(name) ?? { users7: new Set(), uses7: 0, users30: new Set(), uses30: 0, weekly: new Map() };
    if (t >= since(7)) {
      f.users7.add(id);
      f.uses7 += n;
    }
    if (t >= since(30)) {
      f.users30.add(id);
      f.uses30 += n;
    }
    const w = weekOf(t);
    f.weekly.set(w, (f.weekly.get(w) ?? new Set()).add(id));
    featureUse.set(name, f);
  };
  for (const r of actRows) {
    const t = dayStart(String(r.pk).slice(4));
    for (const [k, v] of Object.entries(r)) if (k.startsWith('f_') && typeof v === 'number') use(k.slice(2), String(r.sk), t, v);
  }
  // Server-side records (exact, no app needed).
  for (const r of rows) {
    const id = owner(r);
    if (!id || !real.has(id)) continue;
    const sk = String(r.sk);
    const t = tsOf(r);
    if (t === undefined) continue;
    if (sk.startsWith('M#') && r.status === 'ready') use('server_upload', id, t);
    else if (sk.startsWith('LKO#')) use('server_share_link', id, t);
    else if (sk.startsWith('OUT#')) use('server_share_friend', id, t);
    else if (sk.startsWith('AL#') && !r.code) use(r.event ? 'server_event_album' : 'server_album', id, t);
    else if (sk.startsWith('RF#')) use('server_invite', id, t);
    else if (sk.startsWith('ST#')) use('server_own_storage', id, t);
  }
  for (const r of rows) if (r.pk === 'FEEDBACK' && real.has(String(r.identityId)) && typeof r.at === 'number') use('server_feedback', String(r.identityId), r.at);
  const weeks = Array.from({ length: 12 }, (_, i) => weekOf(now - (11 - i) * 7 * DAY));
  const features = [...featureUse.entries()]
    .map(([name, f]) => ({ name, users7: f.users7.size, uses7: f.uses7, users30: f.users30.size, uses30: f.uses30, weekly: weeks.map((w) => ({ week: w, users: f.weekly.get(w)?.size ?? 0 })) }))
    .sort((a, b) => b.users30 - a.users30 || b.uses30 - a.uses30);

  // ---- breakdowns: each account's latest day in the last 30 days ----
  const latest = new Map<string, Row>();
  for (const r of actRows) {
    const d = String(r.pk).slice(4);
    if (dayStart(d) < since(30)) continue;
    const prev = latest.get(String(r.sk));
    if (!prev || String(prev.pk) < String(r.pk)) latest.set(String(r.sk), r);
  }
  const by = (key: string) => {
    const m = new Map<string, number>();
    for (const r of latest.values()) {
      const k = r[key] ? String(r[key]) : 'unknown';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([label, count]) => ({ label, count }));
  };

  // ---- by install channel (PROFILE.acquisition, recorded from 2026-10-29) ----
  // Retention looks back 90 days so that D30 has installs old enough to count.
  const channelAccount = ([id, p]: [string, Row]) => ({
    createdAt: p.createdAt,
    acquisition: p.acquisition,
    usedBytes: typeof p.usedBytes === 'number' ? p.usedBytes : 0,
    paying: planActive(p.plan, now),
    uploadedAt: first.get(id)?.upload,
    signedInAt: first.get(id)?.signin ?? (p.email ? p.createdAt : undefined),
    activeDays: activeDays.get(id) ?? new Set<string>(),
  });
  const channels = byChannel(
    cohort.map(channelAccount),
    now,
    [...real.entries()].filter(([, p]) => p.createdAt >= now - Math.max(windowDays, RETENTION_DAYS) * DAY).map(channelAccount),
  );

  // Campaigns and months (growth-money.ts: CAC, ROI): installs by utm_campaign, and by calendar month.
  const yearAgo = now - 365 * DAY;
  const outcome = (id: string, p: Row) => ({ backedUp: first.get(id)?.upload !== undefined, signedIn: first.get(id)?.signin !== undefined || !!p.email, paying: planActive(p.plan, now) });
  const campaignInstalls: Record<string, { installs: number; backedUp: number; signedIn: number; paying: number }> = {};
  const months: Record<string, { installs: number; backedUp: number; paying: number }> = {};
  for (const [id, p] of real) {
    if (typeof p.createdAt !== 'number' || p.createdAt < yearAgo) continue;
    const o = outcome(id, p);
    const camp = typeof p.acquisition?.campaign === 'string' ? p.acquisition.campaign : '';
    if (camp) {
      const c = (campaignInstalls[camp] ??= { installs: 0, backedUp: 0, signedIn: 0, paying: 0 });
      c.installs++;
      c.backedUp += Number(o.backedUp);
      c.signedIn += Number(o.signedIn);
      c.paying += Number(o.paying);
    }
    const m = (months[new Date(p.createdAt).toISOString().slice(0, 7)] ??= { installs: 0, backedUp: 0, paying: 0 });
    m.installs++;
    m.backedUp += Number(o.backedUp);
    m.paying += Number(o.paying);
  }

  return {
    at: now,
    campaignInstalls,
    installsByMonth: Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, v]) => ({ month, ...v })),
    weeklyBackupUsers: backupWeeks[0].size,
    weeklyBackupSeries: backupWeeks.map((s, w) => ({ weeksAgo: w, users: s.size })).reverse(),
    windowDays,
    trackingSince,
    accounts: real.size,
    channels,
    funnel: funnel.map(({ _t, ...s }) => s),
    eligibleForReturn,
    active: { series: active, today: { dau: today.dau, wau: today.wau, mau: today.mau }, stickiness: today.mau ? today.dau / today.mau : null },
    retention,
    features,
    breakdowns: { build: by('build'), os: by('os'), tier: by('tier'), region: by('region'), client: by('client') },
    website: await website(now),
  };
}

/** GET /api/analytics?window=30|90|all[&refresh=1] */
export async function analytics(req: Req): Promise<Res> {
  const w = (req.query.window ?? '90') as keyof typeof WINDOWS;
  const windowDays = WINDOWS[w] ?? 90;
  const key = { pk: 'STATS', sk: `ANALYTICS#${windowDays}` };
  const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: key }))).Item;
  const refresh = req.query.refresh === '1';
  if (cached && !refresh && Date.now() - cached.data.at < CACHE_MS) return json(200, { ...cached.data, cached: true });
  if (refresh) await rateLimit('console-analytics-refresh', 30, 'Refreshed too often. Try again in a few minutes.');
  const data = await compute(windowDays);
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...key, data } }));
  return json(200, data);
}
