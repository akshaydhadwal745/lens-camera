// Growth facts (docs/growth/growth-engine.md §2.1): every number the weekly growth report may use,
// computed here by plain code, each with an id the report must cite. The AI writer never computes;
// it only explains these. Pure functions over already-loaded data (tested in growth-facts.test.ts).

export type Unit = 'count' | 'pct' | 'position' | 'usd' | 'gb';
export type Fact = {
  id: string;
  area: 'search' | 'website' | 'app' | 'channels' | 'money' | 'loops' | 'demand' | 'ga4';
  label: string;
  value: number | null;
  unit: Unit;
  window: string;
  previous?: number | null;
  /** Relative change vs previous (0.5 = +50%), null when previous is 0 or missing. */
  change?: number | null;
};

export type SearchRow = { sk: string; clicks: number; impressions: number; position: number };
export type SearchDay = { day: string; rows: SearchRow[] };

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const rel = (now: number | null, before: number | null | undefined) => (now === null || !before ? null : round(now / before - 1));

export function fact(f: Omit<Fact, 'change'> & { previous?: number | null }): Fact {
  return { ...f, value: f.value === null ? null : round(f.value), ...(f.previous !== undefined ? { previous: f.previous === null ? null : round(f.previous), change: rel(f.value, f.previous) } : {}) };
}

/** Totals and per-key sums over a set of days (position is impression-weighted). */
function sum(days: SearchDay[], prefix: string) {
  const m = new Map<string, { clicks: number; impressions: number; posW: number }>();
  for (const d of days)
    for (const r of d.rows) {
      if (prefix === 'total' ? r.sk !== 'total' : !r.sk.startsWith(prefix)) continue;
      const key = prefix === 'total' ? 'total' : r.sk.slice(prefix.length);
      const a = m.get(key) ?? { clicks: 0, impressions: 0, posW: 0 };
      a.clicks += r.clicks;
      a.impressions += r.impressions;
      a.posW += r.position * r.impressions;
      m.set(key, a);
    }
  return m;
}

/** Search Console: the last 28 days against the 28 before (days sorted oldest → newest, 56 of them). */
export function searchFacts(days: SearchDay[]): Fact[] {
  const cur = days.slice(-28);
  const prev = days.slice(-56, -28);
  const w = '28 days vs the 28 before';
  const t = sum(cur, 'total').get('total') ?? { clicks: 0, impressions: 0, posW: 0 };
  const p = sum(prev, 'total').get('total') ?? { clicks: 0, impressions: 0, posW: 0 };
  const facts: Fact[] = [
    fact({ id: 'search.clicks', area: 'search', label: 'Clicks from Google search', value: t.clicks, previous: p.clicks, unit: 'count', window: w }),
    fact({ id: 'search.impressions', area: 'search', label: 'Times Lens appeared in Google results', value: t.impressions, previous: p.impressions, unit: 'count', window: w }),
    fact({ id: 'search.ctr', area: 'search', label: 'Click-through rate', value: t.impressions ? t.clicks / t.impressions : null, previous: p.impressions ? p.clicks / p.impressions : null, unit: 'pct', window: w }),
    fact({ id: 'search.position', area: 'search', label: 'Average position in results', value: t.impressions ? t.posW / t.impressions : null, previous: p.impressions ? p.posW / p.impressions : null, unit: 'position', window: w }),
  ];

  // Queries gaining or losing the most impressions.
  const qc = sum(cur, 'q#');
  const qp = sum(prev, 'q#');
  const deltas = [...new Set([...qc.keys(), ...qp.keys()])]
    .map((q) => ({ q, now: qc.get(q)?.impressions ?? 0, before: qp.get(q)?.impressions ?? 0 }))
    .filter((d) => Math.max(d.now, d.before) >= 10);
  deltas.sort((a, b) => b.now - b.before - (a.now - a.before));
  deltas.slice(0, 5).filter((d) => d.now > d.before).forEach((d, i) => facts.push(fact({ id: `search.gaining.${i + 1}`, area: 'search', label: `Query gaining impressions: "${d.q}"`, value: d.now, previous: d.before, unit: 'count', window: w })));
  deltas.reverse().slice(0, 5).filter((d) => d.now < d.before).forEach((d, i) => facts.push(fact({ id: `search.losing.${i + 1}`, area: 'search', label: `Query losing impressions: "${d.q}"`, value: d.now, previous: d.before, unit: 'count', window: w })));

  // Seen a lot, rarely clicked: title/description candidates (top 20 results, ≥ 50 impressions, CTR < 2%).
  [...sum(cur, 'p#').entries()]
    .map(([page, a]) => ({ page, ...a, ctr: a.impressions ? a.clicks / a.impressions : 0, pos: a.impressions ? a.posW / a.impressions : 99 }))
    .filter((a) => a.impressions >= 50 && a.ctr < 0.02 && a.pos <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5)
    .forEach((a, i) => {
      facts.push(fact({ id: `search.lowctr.${i + 1}.impressions`, area: 'search', label: `High impressions, low clicks: ${a.page} (impressions)`, value: a.impressions, unit: 'count', window: '28 days' }));
      facts.push(fact({ id: `search.lowctr.${i + 1}.ctr`, area: 'search', label: `High impressions, low clicks: ${a.page} (click-through rate)`, value: a.ctr, unit: 'pct', window: '28 days' }));
    });

  // Page-two queries: one push away from page one (position 8–20, ≥ 20 impressions).
  [...qc.entries()]
    .map(([q, a]) => ({ q, impressions: a.impressions, pos: a.impressions ? a.posW / a.impressions : 99 }))
    .filter((a) => a.pos >= 8 && a.pos <= 20 && a.impressions >= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5)
    .forEach((a, i) => facts.push(fact({ id: `search.page2.${i + 1}`, area: 'search', label: `Near page one: "${a.q}" (average position)`, value: a.pos, unit: 'position', window: '28 days' })));
  return facts;
}

export function indexFacts(c: { urls: number; indexed: number; states: Record<string, number> } | undefined): Fact[] {
  if (!c) return [];
  const facts = [
    fact({ id: 'search.sitemap_pages', area: 'search', label: 'Pages in our sitemap', value: c.urls, unit: 'count', window: 'now' }),
    fact({ id: 'search.indexed_pages', area: 'search', label: 'Pages Google has indexed', value: c.indexed, unit: 'count', window: 'now' }),
  ];
  Object.entries(c.states)
    .sort((a, b) => b[1] - a[1])
    .forEach(([state, n], i) => facts.push(fact({ id: `search.coverage.${i + 1}`, area: 'search', label: `Pages in state "${state}"`, value: n, unit: 'count', window: 'now' })));
  return facts;
}

/** Last 7 days against the 7 before, from a daily series (oldest → newest). */
export function weekOverWeek(id: string, area: Fact['area'], label: string, series: number[]): Fact {
  const cur = series.slice(-7).reduce((s, x) => s + x, 0);
  const prev = series.slice(-14, -7).reduce((s, x) => s + x, 0);
  return fact({ id, area, label, value: cur, previous: prev, unit: 'count', window: '7 days vs the 7 before' });
}

/** A change worth a look: at least ±50% with at least 10 on one side (noise below that). */
export const notable = (f: Fact) => f.change !== undefined && f.change !== null && Math.abs(f.change) >= 0.5 && Math.max(f.value ?? 0, f.previous ?? 0) >= 10;

type Rate = { reached: number; eligible: number; rate: number | null };
export type AnalyticsInput = {
  funnel: { key: string; label: string; count: number }[];
  eligibleForReturn: number;
  active: { series: { day: string; dau: number; wau: number; mau: number }[]; today: { dau: number; wau: number; mau: number } };
  channels?: { channel: string; installs: number; backedUp: Rate; signedIn: Rate; d1: Rate; d7: Rate; d30: Rate; paying: number; storageGB: number; storageUsdPerMonth: number }[];
  features: { name: string; users30: number; uses30: number }[];
  weeklyBackupSeries?: { weeksAgo: number; users: number }[];
  website?: {
    daily: { day: string; visits: number; getLens: number }[];
    visits: number;
    getLens: number;
    getLensRate: number | null;
    sources: { label: string; count: number }[];
    engagedVisits?: number;
    engagedRate?: number | null;
    landing?: { path: string; visits: number; engaged: number; getLens: number }[];
    pageQuality?: { path: string; views: number; avgSeconds: number | null; engagedRate: number | null; scrollRate: number | null }[];
    campaigns?: { label: string; count: number }[];
    countries?: { label: string; count: number }[];
    devices?: { label: string; count: number }[];
  };
};

/** Website, app funnel, retention, channels, money and growth loops from the Console's analytics (30-day window). */
export function productFacts(a: AnalyticsInput): Fact[] {
  const facts: Fact[] = [];
  const w30 = 'installed in the last 30 days';
  if (a.website) {
    facts.push(weekOverWeek('web.visits', 'website', 'Website visits', a.website.daily.map((d) => d.visits)));
    facts.push(weekOverWeek('web.get_lens', 'website', 'Get Lens clicks on the website', a.website.daily.map((d) => d.getLens)));
    facts.push(fact({ id: 'web.visits_30d', area: 'website', label: 'Website visits', value: a.website.visits, unit: 'count', window: '30 days' }));
    facts.push(fact({ id: 'web.get_lens_rate', area: 'website', label: 'Visits that clicked Get Lens', value: a.website.getLensRate, unit: 'pct', window: '30 days' }));
    a.website.sources.slice(0, 5).forEach((s, i) => facts.push(fact({ id: `web.source.${i + 1}`, area: 'website', label: `Visits from ${s.label}`, value: s.count, unit: 'count', window: '30 days' })));
    // Beacon v2 (from 2026-10-30): engagement, landing pages and who visits. Counted only since then.
    const v2 = '30 days (counted from 30 Oct 2026)';
    if (a.website.engagedRate !== undefined) facts.push(fact({ id: 'web.engaged_rate', area: 'website', label: 'Visits that engaged (2+ pages or 10+ seconds)', value: a.website.engagedRate, unit: 'pct', window: v2 }));
    (a.website.landing ?? []).slice(0, 5).forEach((l, i) => {
      facts.push(fact({ id: `web.landing.${i + 1}.visits`, area: 'website', label: `Visits that landed on ${l.path}`, value: l.visits, unit: 'count', window: v2 }));
      facts.push(fact({ id: `web.landing.${i + 1}.engaged`, area: 'website', label: `Visits landing on ${l.path} that engaged`, value: l.visits ? l.engaged / l.visits : null, unit: 'pct', window: v2 }));
      facts.push(fact({ id: `web.landing.${i + 1}.get_lens`, area: 'website', label: `Visits landing on ${l.path} that clicked Get Lens`, value: l.visits ? l.getLens / l.visits : null, unit: 'pct', window: v2 }));
    });
    (a.website.pageQuality ?? [])
      .filter((p) => p.avgSeconds !== null)
      .slice(0, 5)
      .forEach((p, i) => {
        facts.push(fact({ id: `web.page.${i + 1}.seconds`, area: 'website', label: `Average seconds visible on ${p.path}`, value: p.avgSeconds, unit: 'count', window: v2 }));
        facts.push(fact({ id: `web.page.${i + 1}.scrolled`, area: 'website', label: `Views of ${p.path} scrolled to 75%`, value: p.scrollRate, unit: 'pct', window: v2 }));
      });
    (a.website.countries ?? []).slice(0, 3).forEach((c, i) => facts.push(fact({ id: `web.country.${i + 1}`, area: 'website', label: `Visits from country ${c.label}`, value: c.count, unit: 'count', window: v2 })));
    (a.website.devices ?? []).forEach((d) => facts.push(fact({ id: `web.device.${d.label}`, area: 'website', label: `Visits on ${d.label}`, value: d.count, unit: 'count', window: v2 })));
    (a.website.campaigns ?? []).slice(0, 3).forEach((c, i) => facts.push(fact({ id: `web.campaign.${i + 1}`, area: 'website', label: `Visits from campaign "${c.label}"`, value: c.count, unit: 'count', window: v2 })));
  }
  const step = (k: string) => a.funnel.find((s) => s.key === k)?.count ?? 0;
  const installs = step('install');
  facts.push(fact({ id: 'app.installs', area: 'app', label: 'New installs', value: installs, unit: 'count', window: '30 days' }));
  if (a.weeklyBackupSeries?.length) {
    const s = a.weeklyBackupSeries;
    facts.push(fact({ id: 'app.weekly_backup_users', area: 'app', label: 'Weekly backup users (north star: people who backed up at least one photo or video in 7 days)', value: s[s.length - 1].users, previous: s.length > 1 ? s[s.length - 2].users : null, unit: 'count', window: 'last 7 days vs the 7 before' }));
  }
  for (const [k, label] of [
    ['upload', 'Installs that backed up a photo or video'],
    ['signin', 'Installs that signed in'],
    ['share', 'Installs that shared something'],
  ] as const)
    facts.push(fact({ id: `app.${k}_rate`, area: 'app', label, value: installs ? step(k) / installs : null, unit: 'pct', window: w30 }));
  facts.push(fact({ id: 'app.came_back_7d_rate', area: 'app', label: 'Came back at any time 7+ days after installing (cumulative; not the same as D7)', value: a.eligibleForReturn ? step('return') / a.eligibleForReturn : null, unit: 'pct', window: 'installed 7–30 days ago' }));
  facts.push(weekOverWeek('app.daily_active', 'app', 'Daily active users (sum of days)', a.active.series.map((d) => d.dau)));
  facts.push(fact({ id: 'app.wau', area: 'app', label: 'Weekly active users', value: a.active.today.wau, unit: 'count', window: 'last 7 days' }));
  facts.push(fact({ id: 'app.mau', area: 'app', label: 'Monthly active users', value: a.active.today.mau, unit: 'count', window: 'last 30 days' }));

  const ch = a.channels ?? [];
  const total = (k: 'd1' | 'd7' | 'd30') => {
    const r = ch.reduce((s, c) => ({ reached: s.reached + c[k].reached, eligible: s.eligible + c[k].eligible }), { reached: 0, eligible: 0 });
    return r.eligible ? r.reached / r.eligible : null;
  };
  const w90 = 'installed in the last 90 days, old enough to count';
  for (const k of ['d1', 'd7', 'd30'] as const)
    facts.push(fact({ id: `app.retention_${k}`, area: 'app', label: `${k.toUpperCase()} retention: used Lens on exactly day ${k.slice(1)} after installing (classic day-N; lower than "came back at any time")`, value: total(k), unit: 'pct', window: w90 }));
  ch.slice(0, 5).forEach((c, i) => {
    facts.push(fact({ id: `channel.${i + 1}.installs`, area: 'channels', label: `Installs from ${c.channel}`, value: c.installs, unit: 'count', window: w30 }));
    facts.push(fact({ id: `channel.${i + 1}.backed_up`, area: 'channels', label: `${c.channel}: installs that backed up`, value: c.backedUp.rate, unit: 'pct', window: w30 }));
    facts.push(fact({ id: `channel.${i + 1}.d7`, area: 'channels', label: `${c.channel}: D7 retention (used Lens on exactly day 7)`, value: c.d7.rate, unit: 'pct', window: w90 }));
  });
  facts.push(fact({ id: 'money.paying', area: 'money', label: 'Paying accounts (installed in the window)', value: ch.reduce((s, c) => s + c.paying, 0), unit: 'count', window: w30 }));
  facts.push(fact({ id: 'money.storage_gb', area: 'money', label: 'Storage held by these accounts', value: ch.reduce((s, c) => s + c.storageGB, 0), unit: 'gb', window: w30 }));
  facts.push(fact({ id: 'money.storage_cost', area: 'money', label: 'Estimated monthly storage cost of these accounts', value: ch.reduce((s, c) => s + c.storageUsdPerMonth, 0), unit: 'usd', window: w30 }));

  const feature = (n: string) => a.features.find((f) => f.name === n);
  for (const [n, label] of [
    ['server_invite', 'People who invited friends'],
    ['server_share_link', 'People who made share links'],
    ['server_event_album', 'People who made event albums'],
    ['event_join', 'People who joined an event album'],
    ['server_own_storage', 'People who connected their own storage'],
  ] as const)
    facts.push(fact({ id: `loops.${n}`, area: 'loops', label, value: feature(n)?.users30 ?? 0, unit: 'count', window: '30 days' }));
  return facts;
}

// ---------- demand and interest (growth-sources.ts): every label names its source and scale ----------

type BingTrend = { keyword: string; country: string; last12Weeks: number; previous12Weeks: number; change: number | null };
type WikiTrend = { article: string; last3Months: number; sameMonthsYearBefore: number | null; change: number | null };

/** Bing searches per seed keyword and country, Wikipedia interest per topic, relevant trending searches. */
export function demandFacts(bing: BingTrend[], wiki: WikiTrend[], trending: { geo: string; total: number; relevant: string[] }[]): Fact[] {
  const out: Fact[] = [];
  for (const b of bing) {
    const id = `demand.bing.${b.country}.${b.keyword.replace(/[^a-z0-9]+/g, '_')}`;
    out.push(fact({ id, area: 'demand', label: `Bing searches for "${b.keyword}" in ${b.country.toUpperCase()} (Bing only, broad match; not Google volume)`, value: b.last12Weeks, previous: b.previous12Weeks, unit: 'count', window: '12 weeks vs the 12 before' }));
  }
  for (const w of wiki)
    out.push(fact({ id: `demand.wiki.${w.article.toLowerCase()}`, area: 'demand', label: `Wikipedia views of "${w.article.replace(/_/g, ' ')}" (English; long-term interest, not searches)`, value: w.last3Months, previous: w.sameMonthsYearBefore ?? undefined, unit: 'count', window: 'last 3 full months vs the same months a year before' }));
  for (const t of trending)
    out.push(fact({ id: `demand.trending.${t.geo.toLowerCase()}`, area: 'demand', label: `Google "Trending now" searches in ${t.geo} touching our space${t.relevant.length ? `: ${t.relevant.slice(0, 5).join('; ')}` : ''}`, value: t.relevant.length, unit: 'count', window: `today, of ${t.total} trending` }));
  return out;
}

/** GA4 (consented visitors only where consent is required): sessions, engagement and key events by channel. */
export function ga4Facts(byChannel: { sessionDefaultChannelGroup?: string; sessions?: number; engagedSessions?: number; keyEvents?: number }[], total: { sessions?: number; engagementRate?: number; averageSessionDuration?: number } | undefined): Fact[] {
  if (!total?.sessions) return [];
  const w = '28 days (GA4; consented visitors where required)';
  const out = [
    fact({ id: 'ga4.sessions', area: 'ga4', label: 'GA4 sessions', value: total.sessions, unit: 'count', window: w }),
    fact({ id: 'ga4.engagement_rate', area: 'ga4', label: 'GA4 engagement rate', value: total.engagementRate ?? null, unit: 'pct', window: w }),
    fact({ id: 'ga4.avg_session_seconds', area: 'ga4', label: 'GA4 average session length, seconds', value: total.averageSessionDuration === undefined ? null : Math.round(total.averageSessionDuration), unit: 'count', window: w }),
  ];
  byChannel.slice(0, 6).forEach((c, i) => {
    out.push(fact({ id: `ga4.channel.${i + 1}.sessions`, area: 'ga4', label: `GA4 sessions from ${c.sessionDefaultChannelGroup ?? 'unknown'}`, value: c.sessions ?? 0, unit: 'count', window: w }));
    out.push(fact({ id: `ga4.channel.${i + 1}.key_events`, area: 'ga4', label: `GA4 key events from ${c.sessionDefaultChannelGroup ?? 'unknown'}`, value: c.keyEvents ?? 0, unit: 'count', window: w }));
  });
  return out;
}
