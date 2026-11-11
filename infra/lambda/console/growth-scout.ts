// Event scout (docs/growth/content-engine.md, Moments; owner 2026-11-11: "how are we going to fetch events,
// concerts… currently only the calendar"). The daily pull (api/growth-moments.ts) has holidays, photo days,
// seasons and trends but no real concerts, tours, festivals or parties, and India's ticketing sites have no API.
// So once a week the engine's Claude searches the web (Claude Code's WebSearch + WebFetch) for big, photo-worthy
// public events in the next 60 days in our countries and returns each with its date, city and source links.
// Code decides what becomes a moment: a real date inside the window, a country we serve, nothing sensitive, and
// a source link that opens and names the event (a made-up link or date never reaches the feed).
//   GROWTH / MOMENT#<id>      kind concert | festival | match, source "Web: <site>", url = the checked link
//   GROWTH / MOMENTS-SCOUT    { at, sources: { scout: "ok N (M checked of K)" } } merged into the Moments page
import { PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam } from '../api/lib';
import { finish, HOLIDAY_CALENDARS, SENSITIVE, type MomentKind } from '../api/growth-moments';
import { runClaude, type Mode } from './growth';

const DAY = 86_400_000;
export const SCOUT_DAYS = 60;
const UA = 'Mozilla/5.0 (compatible; LensGrowth/1.0; +https://lens.instagrowapp.com)';
export const SCOUT_COUNTRIES = Object.keys(HOLIDAY_CALENDARS);

export const SCOUT_SYSTEM = `You are the events researcher for the marketing team of Lens, a camera and photo-backup app (full-quality backup, freeing phone space, event albums that guests add to by scanning a QR code). You find the big real-world moments coming up where people take lots of photos and videos, so the team can post about them in time.

Use WebSearch to find events and WebFetch to open the source page and confirm the date. Never guess: every event needs a source page that you opened and that states the event and its date.

What to find (public events only, in the given countries and dates):
- concerts and tours of big artists (stadium and arena shows, a famous artist's India / UK / US tour dates);
- music and cultural festivals (Sunburn, Lollapalooza, NH7, Glastonbury, Coachella-size, Hornbill, Rann Utsav, Pushkar fair);
- big parties and nights out (New Year's Eve fireworks, city countdowns, famous parties, Pride parades);
- big sports moments people film (finals, derbies, a World Cup or IPL match, marathons);
- expos, fan conventions, light shows and city festivals that draw crowds (Comic Con, Diwali light shows, Christmas markets with a name and a date).
Prefer what many people go to and photograph. Skip anything private, religious services, political rallies, protests, memorials, and anything sad.

Sources, best first: the event's official site, the ticketing page (BookMyShow, District, Ticketmaster, Live Nation, AXS, Skiddle, Eventbrite), the venue, then major news. Give 1 or 2 source URLs exactly as you opened them.

Return 15 to 40 events, the most photo-worthy first.`;

export const SCOUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'start', 'end', 'city', 'country', 'why', 'sources'],
        properties: {
          title: { type: 'string', description: 'the event name as people say it, e.g. "Coldplay in Mumbai" or "Sunburn Festival Goa"' },
          kind: { type: 'string', enum: ['concert', 'festival', 'party', 'sports', 'expo'] },
          start: { type: 'string', description: 'YYYY-MM-DD (first day)' },
          end: { type: 'string', description: 'YYYY-MM-DD (last day; same as start for one day)' },
          city: { type: 'string' },
          country: { type: 'string', description: 'ISO 3166 alpha-2, e.g. IN, US, GB' },
          why: { type: 'string', description: 'one line: why people photograph it' },
          sources: { type: 'array', items: { type: 'string' }, description: '1–2 URLs you opened that state the event and its date' },
        },
      },
    },
  },
} as const;

export const SCOUT_MODE: Mode = { system: SCOUT_SYSTEM, schema: SCOUT_SCHEMA, toolNames: [], mode: 'report', builtins: ['WebSearch', 'WebFetch'] };

export type Scouted = { title: string; kind: string; start: string; end: string; city: string; country: string; why: string; sources: string[] };
type Raw = Parameters<typeof finish>[0];

const KIND: Record<string, MomentKind> = { concert: 'concert', festival: 'festival', party: 'festival', expo: 'festival', sports: 'match' };
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** Claude's list → candidate moments (pure): real dates in the window, our countries, nothing sensitive, https sources. */
export function readScouted(r: { events?: Partial<Scouted>[] } | undefined, today: string, days = SCOUT_DAYS): { raw: Raw; sources: string[] }[] {
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  const seen = new Set<string>();
  const out: { raw: Raw; sources: string[] }[] = [];
  for (const e of (r?.events ?? []).slice(0, 60)) {
    const title = String(e.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const start = String(e.start ?? '');
    const end = isDay(String(e.end ?? '')) && String(e.end) >= start ? String(e.end) : start;
    const country = String(e.country ?? '').toUpperCase();
    const sources = ((e.sources ?? []) as string[]).map(String).filter((u) => /^https:\/\/[^\s/]+\.[^\s/]+/.test(u)).slice(0, 2);
    if (!title || !isDay(start) || end < today || start > last || !KIND[String(e.kind)] || !SCOUT_COUNTRIES.includes(country) || !sources.length) continue;
    if (SENSITIVE.test(`${title} ${e.why ?? ''}`)) continue;
    const key = `${title.toLowerCase()}|${start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const city = String(e.city ?? '').trim().slice(0, 40);
    const named = city && !title.toLowerCase().includes(city.toLowerCase()) ? `${title} (${city})` : title;
    out.push({ raw: { title: named, kind: KIND[String(e.kind)], day: start < today ? today : start, ...(end > start ? { ends: end } : {}), countries: [country], source: 'Web', url: sources[0] }, sources });
  }
  return out;
}

/** The words a source page must contain for the event to count: its most distinctive name word. */
export function nameWords(title: string): string[] {
  const stop = /^(the|and|live|tour|festival|concert|show|in|at|of|with|world|india|edition|season|night|party|day|2026|2027|fest|music)$/i;
  return title
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4 && !stop.test(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
}

/** A source opens (2xx) and names the event: the check that keeps made-up links out. */
async function checks(url: string, words: string[]): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return false;
    const text = (await r.text()).slice(0, 2_000_000).toLowerCase();
    return !words.length || words.some((w) => text.includes(w.toLowerCase()));
  } catch {
    return false;
  }
}

/** The weekly scout: search, check, store. Never throws (writes its status instead). */
export async function eventScout(now = Date.now()): Promise<Record<string, unknown>> {
  const today = new Date(now).toISOString().slice(0, 10);
  const status = async (s: string) => ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: 'MOMENTS-SCOUT', at: Date.now(), sources: { scout: s } } }));
  const token = await getParam('/lens/growth/claude-token').catch(() => undefined);
  if (!token) {
    await status('not connected (no Claude token)');
    return { scout: 'no token' };
  }
  const until = new Date(now + SCOUT_DAYS * DAY).toISOString().slice(0, 10);
  const prompt = `Today is ${today}. Find events from ${today} to ${until} in these countries (ISO codes): ${SCOUT_COUNTRIES.join(', ')}. Our biggest audiences are IN, US, GB, AU, CA and AE: give them most of the list, India most of all (concerts, tours and festivals there are hard to find anywhere else).`;
  let report: { events?: Partial<Scouted>[] };
  try {
    ({ report } = await runClaude<{ events?: Partial<Scouted>[] }>(prompt, token, { enabled: [] }, now + 11 * 60_000, SCOUT_MODE));
  } catch (e) {
    await status(`failed: ${(e as Error).message.slice(0, 160)}`);
    return { scout: 'failed', message: (e as Error).message.slice(0, 300) };
  }
  const found = readScouted(report, today);
  const kept: Raw[] = [];
  for (const f of found) {
    const words = nameWords(f.raw.title);
    for (const u of f.sources) {
      if (await checks(u, words)) {
        kept.push({ ...f.raw, url: u, source: `Web: ${new URL(u).hostname.replace(/^www\./, '')}` });
        break;
      }
    }
  }
  for (const m of kept.map(finish)) {
    const last = Date.parse(`${m.ends ?? m.day}T23:59:59Z`);
    await ddb
      .send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `MOMENT#${m.id}`, ...m, at: now, ttl: Math.floor((last + 14 * DAY) / 1000) }, ConditionExpression: 'attribute_not_exists(taskId)' }))
      .catch((e: Error) => {
        if (e.name !== 'ConditionalCheckFailedException') throw e;
      });
  }
  const line = `ok ${kept.length} (${kept.length} of ${found.length} links checked, ${(report.events ?? []).length} found)`;
  await status(line);
  console.log(JSON.stringify({ eventScout: line, kept: kept.map((k) => `${k.day} ${k.countries[0]} ${k.title}`) }));
  return { scout: line };
}
