// Moments feed for the Content tab (docs/growth/content-engine.md, "Moments"): dated events worth a timely
// post — festivals and holidays, seasons, big matches, concerts, trending searches — scored for how well
// they fit Lens (a photo or video moment × how much of our audience it reaches). Pulled once a day in the
// maintenance job into GROWTH / MOMENT#<id> (ttl 14 days after the day) plus GROWTH / MOMENTS (source
// status). Keyless sources always run; the keyed ones read /lens/growth/moments (JSON, SecureString:
// {"cricketKey"?, "footballKey"?, "ticketmasterKey"?}, all free tiers) and report "not connected" without it.
// Sensitive days (elections, disasters, mourning) never become moments.
import { createHash } from 'node:crypto';

import { PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam } from './lib';

const DAY = 86_400_000;
export const WINDOW_DAYS = 30;
const UA = 'LensGrowth/1.0 (https://lens.instagrowapp.com; growth analyst)';

export type MomentKind = 'festival' | 'holiday' | 'season' | 'match' | 'concert' | 'trend';
export type Moment = {
  id: string;
  title: string;
  kind: MomentKind;
  day: string; // yyyy-mm-dd (first day)
  ends?: string; // seasons: last day
  time?: string; // matches and concerts: ISO start time when known
  countries: string[]; // ISO codes (IN, US, GB, AU, CA) or ['WW']
  source: string;
  url: string;
  score: number; // 0–100
  angle: string;
  formats: string[];
  hashtags: string[];
};
type Raw = Omit<Moment, 'id' | 'score' | 'angle' | 'formats' | 'hashtags'> & { publicHoliday?: boolean };

// ---------- rules (pure) ----------

/** Days we never make marketing content for. */
export const SENSITIVE =
  /election|polling|\bvote|referendum|death|died|memorial|remembrance|mourning|martyr|tragedy|attack|disaster|earthquake|flood|cyclone|tsunami|\bwar\b|genocide|holocaust|assassinat|funeral|crash|shooting|riot|bandh|good friday|yom kippur|ashura|muharram|veterans|armistice|partition|9\/11|september 11/i;

const PHOTO_MOMENT =
  /diwali|deepavali|holi\b|christmas|new year|eid|wedding|halloween|thanksgiving|navratri|durga|ganesh|lohri|pongal|onam|raksha|bandhan|karva|karwa|valentine|mother'?s day|father'?s day|graduation|pride|carnival|fireworks|eclipse|bonfire|guy fawkes|independence day|4th of july|fourth of july|canada day|australia day|hanukkah|chhath?|bhai d[ou]o?j|govardhan|guru nanak|gurpurab|dussehra|baisakhi|vaisakhi|easter|st\.? patrick|lunar new year|chinese new year|world cup|final/i;
const NIGHT = /diwali|deepavali|new year|bonfire|guy fawkes|fireworks|independence day|4th of july|fourth of july|canada day|eclipse|meteor|hanukkah|christmas|dev deepawali|lights/i;
const GATHERING = /wedding|christmas|eid|thanksgiving|holi\b|navratri|durga|ganesh|raksha|bandhan|onam|pongal|easter|lohri|bhai d[ou]o?j|chhath?|govardhan|guru nanak|gurpurab|karva|karwa|hanukkah|graduation|mother'?s day|father'?s day/i;

const BASE: Record<MomentKind, number> = { festival: 55, holiday: 35, season: 50, match: 45, concert: 50, trend: 35 };

/** How well a moment fits Lens: photo/video moment × audience reach. */
export function score(m: Raw): number {
  let s = BASE[m.kind];
  if (PHOTO_MOMENT.test(m.title)) s += 25;
  if (m.publicHoliday) s += 5;
  const reach = m.countries.includes('WW') ? 4 : new Set(m.countries).size;
  s += Math.min(15, reach * 4);
  if (m.countries.includes('IN') || m.countries.includes('US')) s += 5;
  return Math.max(0, Math.min(100, s));
}

/** The Lens angle: which feature the moment shows off, and the formats that suit it. */
export function angleOf(m: Raw): { angle: string; formats: string[] } {
  const t = m.title;
  if (/wedding/i.test(t))
    return { angle: 'Event albums: one QR code collects every guest’s photos and videos at full quality, no WhatsApp compression.', formats: ['reel', 'carousel'] };
  if (NIGHT.test(t))
    return { angle: 'Lights and fireworks: sharp night photos with Night mode, and every photo backed up at full quality the same night.', formats: ['reel', 'carousel'] };
  if (GATHERING.test(t) || m.kind === 'festival')
    return { angle: 'Everyone’s photos in one shared album, at full quality — no more “send me the pics”.', formats: ['carousel', 'reel'] };
  if (m.kind === 'match' || m.kind === 'concert')
    return { angle: 'Phone full right before the big moment? Free up space safely first, then record it in full quality.', formats: ['short', 'post'] };
  if (/summer|holiday|trip|monsoon|travel|break/i.test(t))
    return { angle: 'Trip photos: back up as you go, free up space on the road, and keep every original.', formats: ['carousel', 'short'] };
  return { angle: 'Phone full of photos from it? Back them up at full quality and free up space safely.', formats: ['post', 'short'] };
}

const camel = (s: string) =>
  s
    .replace(/['’]/g, '')
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');

/** The moment's own tags (#Diwali, #Diwali2026) plus one for the kind of photo it brings. */
export function tagsOf(m: Raw): string[] {
  const year = m.day.slice(0, 4);
  const names = m.title
    .replace(/\s*\([^)]*\)/g, '')
    .split(/\s*[\/,(&]\s*|\s+vs?\.?\s+|\s+and\s+/i)
    .map((p) => camel(p.replace(/\)/g, '')))
    .filter((p) => p.length >= 3 && p.length <= 28)
    .slice(0, 2);
  const tags = names.flatMap((n, i) => (i === 0 && m.kind !== 'trend' ? [`#${n}`, `#${n}${year}`] : [`#${n}`]));
  if (/wedding/i.test(m.title)) tags.push('#WeddingPhotography');
  else if (NIGHT.test(m.title)) tags.push('#NightPhotography');
  else if (/summer|trip|monsoon|travel/i.test(m.title)) tags.push('#TravelPhotography');
  else if (m.kind === 'match' || m.kind === 'concert') tags.push('#PhoneStorage');
  return [...new Set(tags)].slice(0, 5);
}

export const momentId = (m: Pick<Raw, 'source' | 'title' | 'day'>) =>
  createHash('sha256').update(`${m.source}|${m.title.toLowerCase()}|${m.day}`).digest('hex').slice(0, 10);

export function finish(m: Raw): Moment {
  const { publicHoliday: _, ...rest } = m;
  return { ...rest, id: momentId(m), score: score(m), ...angleOf(m), hashtags: tagsOf(m) };
}

// ---------- keyless sources ----------

/** Google's public holiday calendars (official, no key). */
export const HOLIDAY_CALENDARS: Record<string, string> = { IN: 'en.indian', US: 'en.usa', GB: 'en.uk', AU: 'en.australian', CA: 'en.canadian' };

/** VEVENTs of an iCal feed: all-day date, summary, and whether it is a public holiday. */
export function parseIcs(ics: string): { day: string; title: string; publicHoliday: boolean }[] {
  const text = ics.replace(/\r?\n[ \t]/g, '');
  return [...text.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)].flatMap((m) => {
    const v = m[1];
    const d = v.match(/DTSTART[^:\n]*:(\d{4})(\d{2})(\d{2})/);
    const title = (v.match(/\nSUMMARY[^:\n]*:(.*)/)?.[1] ?? '').replace(/\\([,;\\])/g, '$1').trim();
    if (!d || !title) return [];
    const desc = v.match(/\nDESCRIPTION[^:\n]*:(.*)/)?.[1] ?? '';
    return [{ day: `${d[1]}-${d[2]}-${d[3]}`, title, publicHoliday: /public holiday/i.test(desc) }];
  });
}

/** Holidays from all calendars in the window, merged across countries (same name and day = one moment). */
export function holidayMoments(feeds: Record<string, string>, from: string, to: string): Raw[] {
  const byKey = new Map<string, Raw>();
  for (const [country, ics] of Object.entries(feeds)) {
    for (const h of parseIcs(ics)) {
      if (h.day < from || h.day > to) continue;
      const title = h.title.replace(/\s*\((regional )?holiday\)$/i, '').replace(/\s+observed$/i, '');
      const key = `${title.toLowerCase()}|${h.day}`;
      const known = byKey.get(key);
      if (known) {
        if (!known.countries.includes(country)) known.countries.push(country);
        known.publicHoliday ||= h.publicHoliday;
        continue;
      }
      byKey.set(key, {
        title,
        kind: PHOTO_MOMENT.test(title) ? 'festival' : 'holiday',
        day: h.day,
        countries: [country],
        source: 'Google public holidays',
        url: `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(`${HOLIDAY_CALENDARS[country]}#holiday@group.v.calendar.google.com`)}`,
        publicHoliday: h.publicHoliday,
      });
    }
  }
  return [...byKey.values()];
}

/** Recurring seasons people take lots of photos in (month-day ranges; a range may cross the new year). */
export const SEASONS: { title: string; from: string; to: string; countries: string[] }[] = [
  { title: 'Wedding season (India)', from: '11-01', to: '02-28', countries: ['IN'] },
  { title: 'Wedding season', from: '05-01', to: '10-15', countries: ['US', 'GB', 'CA', 'AU'] },
  { title: 'Summer holidays (India)', from: '04-20', to: '06-15', countries: ['IN'] },
  { title: 'Monsoon trips', from: '07-01', to: '09-15', countries: ['IN'] },
  { title: 'Summer holidays', from: '06-20', to: '08-31', countries: ['US', 'GB', 'CA'] },
  { title: 'Summer holidays (Australia)', from: '12-15', to: '01-31', countries: ['AU'] },
  { title: 'Graduation season', from: '05-01', to: '06-30', countries: ['US', 'GB', 'CA', 'AU'] },
  { title: 'Back to school', from: '08-15', to: '09-10', countries: ['US', 'GB', 'CA'] },
  { title: 'Year-end holidays and New Year trips', from: '12-18', to: '01-05', countries: ['WW'] },
];

/** Seasons that start in the window or are on now (one row per season and year). */
export function seasonMoments(today: string, to: string): Raw[] {
  const y = Number(today.slice(0, 4));
  return SEASONS.flatMap((s) => {
    for (const start of [y - 1, y, y + 1]) {
      const from = `${start}-${s.from}`;
      const end = `${s.to < s.from ? start + 1 : start}-${s.to}`;
      if (end < today || from > to) continue;
      return [{ title: s.title, kind: 'season' as const, day: from, ends: end, countries: s.countries, source: 'Seasons list', url: 'https://github.com/akshaydhadwal745/lens-camera/blob/main/infra/lambda/api/growth-moments.ts' }];
    }
    return [];
  });
}

const EVENTISH = /\bvs?\b|v\/s|match|final|concert|tour|festival|wedding|eclipse|meteor|fireworks|parade|marathon|premiere|launch event/i;
const EVENT_NEWS = /\bvs?\b|v\/s|\bmatch\b|\bfinal\b|concert|tour\b/i;

/** "200K+", "1M+", "5,000+" → searches. */
export const trafficCount = (t: string) => {
  const m = t.replace(/,/g, '').match(/([\d.]+)\s*([KM]?)/i);
  return m ? Math.round(Number(m[1]) * (m[2].toUpperCase() === 'M' ? 1e6 : m[2].toUpperCase() === 'K' ? 1e3 : 1)) : 0;
};
/** Below this a trend is a niche search (a player's name, a local league), not a moment. */
export const TREND_MIN = 50_000;

/** Google Trends "trending now" (official RSS): big searches that are themselves a moment. */
export function trendMoments(items: { title: string; traffic: string; news: string[] }[], country: string, today: string): Raw[] {
  return items
    .filter((t) => trafficCount(t.traffic) >= TREND_MIN)
    .filter((t) => EVENTISH.test(t.title) || EVENT_NEWS.test(t.news.join(' ')))
    .slice(0, 5)
    .map((t) => ({ title: t.title, kind: 'trend' as const, day: today, countries: [country], source: `Google Trends (${t.traffic || 'trending'})`, url: `https://trends.google.com/trending?geo=${country}` }));
}

// ---------- keyed sources (free tiers) ----------

type Json = Record<string, any>;

/** CricketData.org (cricapi) upcoming matches: internationals and finals only. */
export function cricketMoments(body: Json, from: string, to: string): Raw[] {
  return ((body.data ?? []) as Json[])
    .filter((m) => !m.matchEnded && typeof m.dateTimeGMT === 'string')
    .map((m): Json => ({ ...m, day: String(m.dateTimeGMT).slice(0, 10) }))
    .filter((m) => m.day >= from && m.day <= to)
    .filter((m) => /\bindia\b/i.test((m.teams ?? []).join(' ')) || /final|world cup|champions trophy|asia cup/i.test(m.name ?? ''))
    .slice(0, 10)
    .map((m) => ({ title: String(m.name).slice(0, 120), kind: 'match' as const, day: m.day, time: String(m.dateTimeGMT).endsWith('Z') ? m.dateTimeGMT : `${m.dateTimeGMT}Z`, countries: ['IN'], source: 'CricketData.org', url: 'https://cricketdata.org/' }));
}

const BIG_FOOTBALL = new Set(['WC', 'EC', 'CL', 'CLI']);

/** football-data.org matches: the World Cup, Euros, Champions League, and any final. */
export function footballMoments(body: Json): Raw[] {
  return ((body.matches ?? []) as Json[])
    .filter((m) => BIG_FOOTBALL.has(m.competition?.code) || /FINAL/.test(m.stage ?? ''))
    .slice(0, 10)
    .map((m) => ({
      title: `${m.homeTeam?.name ?? '?'} vs ${m.awayTeam?.name ?? '?'} (${m.competition?.name ?? 'football'})`,
      kind: 'match' as const,
      day: String(m.utcDate).slice(0, 10),
      time: String(m.utcDate),
      countries: ['WW'],
      source: 'football-data.org',
      url: 'https://www.football-data.org/',
    }));
}

/** Ticketmaster Discovery: the most relevant music events per country. */
export function concertMoments(body: Json, country: string): Raw[] {
  return ((body._embedded?.events ?? []) as Json[])
    .filter((e) => e.dates?.start?.localDate)
    .slice(0, 5)
    .map((e) => ({ title: String(e.name).slice(0, 120), kind: 'concert' as const, day: e.dates.start.localDate, time: e.dates.start.dateTime, countries: [country], source: 'Ticketmaster', url: String(e.url ?? 'https://www.ticketmaster.com/') }));
}

// ---------- the daily pull ----------

async function fetchText(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.text();
}
const fetchJson = async (url: string, headers: Record<string, string> = {}) => JSON.parse(await fetchText(url, headers)) as Json;

/** Daily (maintenance.ts): refresh the moments for the next 30 days. Never throws. */
export async function pullMoments(trending: (geo: string) => Promise<{ title: string; traffic: string; news: string[] }[]>, now = Date.now()): Promise<Record<string, string>> {
  const today = new Date(now).toISOString().slice(0, 10);
  const to = new Date(now + WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const status: Record<string, string> = {};
  const raws: Raw[] = [];
  const run = async (name: string, f: () => Promise<Raw[]>) => {
    try {
      const got = await f();
      raws.push(...got);
      status[name] = `ok (${got.length})`;
    } catch (e) {
      status[name] = `failed: ${(e as Error).message.slice(0, 100)}`;
    }
  };

  await run('holidays', async () => {
    const feeds: Record<string, string> = {};
    for (const [c, cal] of Object.entries(HOLIDAY_CALENDARS))
      feeds[c] = await fetchText(`https://calendar.google.com/calendar/ical/${encodeURIComponent(`${cal}#holiday@group.v.calendar.google.com`)}/public/basic.ics`).catch(() => '');
    if (!Object.values(feeds).some(Boolean)) throw new Error('no calendar could be read');
    return holidayMoments(feeds, today, to);
  });
  await run('seasons', async () => seasonMoments(today, to));
  await run('trends', async () => (await Promise.all(['IN', 'US'].map(async (g) => trendMoments(await trending(g).catch(() => []), g, today)))).flat());

  const keys = (await getParam('/lens/growth/moments')
    .then((r) => (r ? (JSON.parse(r) as Record<string, string>) : {}))
    .catch(() => ({}))) as Record<string, string>;
  if (keys.cricketKey) await run('cricket', async () => cricketMoments(await fetchJson(`https://api.cricapi.com/v1/matches?apikey=${encodeURIComponent(keys.cricketKey)}&offset=0`), today, to));
  else status.cricket = 'not connected';
  if (keys.footballKey) {
    // The free tier allows 10 days per request.
    const to10 = new Date(now + 10 * DAY).toISOString().slice(0, 10);
    await run('football', async () => footballMoments(await fetchJson(`https://api.football-data.org/v4/matches?dateFrom=${today}&dateTo=${to10}`, { 'X-Auth-Token': keys.footballKey })));
  } else status.football = 'not connected';
  if (keys.ticketmasterKey) {
    const range = `startDateTime=${today}T00:00:00Z&endDateTime=${to}T23:59:59Z`;
    await run('concerts', async () =>
      (
        await Promise.all(
          ['US', 'GB', 'AU', 'CA', 'IN'].map(async (c) =>
            concertMoments(await fetchJson(`https://app.ticketmaster.com/discovery/v2/events.json?apikey=${encodeURIComponent(keys.ticketmasterKey)}&classificationName=music&countryCode=${c}&${range}&sort=relevance,desc&size=5`).catch(() => ({})), c),
          ),
        )
      ).flat(),
    );
  } else status.concerts = 'not connected';

  const kept = raws.filter((r) => !SENSITIVE.test(r.title));
  status.sensitiveSkipped = String(raws.length - kept.length);
  for (const m of kept.map(finish)) {
    const last = Date.parse(`${m.ends ?? m.day}T23:59:59Z`);
    // A moment that already has a task keeps its row as it is (the task links to it).
    await ddb
      .send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `MOMENT#${m.id}`, ...m, at: now, ttl: Math.floor((last + 14 * DAY) / 1000) }, ConditionExpression: 'attribute_not_exists(taskId)' }))
      .catch((e: Error) => {
        if (e.name !== 'ConditionalCheckFailedException') throw e;
      });
  }
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'MOMENTS', at: now, sources: status } }));
  return status;
}
