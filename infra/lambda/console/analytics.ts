// Product analytics (our own: docs/design/analytics.md). From the Lens table, real accounts only:
//   - funnel: installed → uploaded → signed in → shared → came back 7+ days later
//   - retention: weekly install cohorts, share active in each later week (ACT# rows)
//   - active users: daily / weekly / monthly (ACT# rows)
//   - feature use: people and uses per feature (app counts f_* on ACT# rows + server records)
//   - breakdowns: app build, Android version, camera tier, region, app vs web
// Counts only; cached 30 minutes (STATS ANALYTICS#<window>).
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, json, rateLimit, Req, Res } from '../api/lib';
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

async function compute(windowDays: number) {
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
    if (sk.startsWith('M#') && r.status === 'ready' && !r.deletedAt) mark(id, 'upload', tsOf(r));
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

  return {
    at: now,
    windowDays,
    trackingSince,
    accounts: real.size,
    funnel: funnel.map(({ _t, ...s }) => s),
    eligibleForReturn,
    active: { series: active, today: { dau: today.dau, wau: today.wau, mau: today.mau }, stickiness: today.mau ? today.dau / today.mau : null },
    retention,
    features,
    breakdowns: { build: by('build'), os: by('os'), tier: by('tier'), region: by('region'), client: by('client') },
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
