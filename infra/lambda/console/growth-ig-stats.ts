// Instagram results (docs/growth/content-engine.md, "the brain"; owner 2026-11-11: "we need a Claude brain: why
// users aren't watching the reel, how it gets them engaged"). Every published post's numbers are read at fixed
// ages (1 h, 1 d, 3 d, 7 d, 14 d, 28 d) by the 10-minute content chain, and the account's daily numbers once a
// day. The weekly brain (growth-brain.ts) reads them next to what each post was.
//   GROWTH / POST#<id>     stats.instagram { at, ageHours, views, reach, likes, comments, shares, saved,
//                          interactions, avgWatchSec?, watchedPct?, saveRate, shareRate }, statsHistory.instagram [≤ 12]
//   GROWTH / IGDAY#<date>  { followers, media, reach, profileViews, websiteClicks, accountsEngaged }
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam } from '../api/lib';

const API = 'https://graph.instagram.com/v23.0';
const HOUR = 3_600_000;
/** When a post's numbers are read, in hours after it went out. */
export const CHECKPOINTS = [1, 24, 72, 168, 336, 672];
const REEL_METRICS = 'views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time';
const FEED_METRICS = 'views,reach,likes,comments,shares,saved,total_interactions';

export type IgStats = { at: number; ageHours: number; views: number; reach: number; likes: number; comments: number; shares: number; saved: number; interactions: number; avgWatchSec?: number; watchedPct?: number; saveRate: number; shareRate: number };

/** Is a checkpoint due: one has passed since the post went out that the last read came before? Pure. */
export function statsDue(publishedAt: number, lastAt: number | undefined, now = Date.now()): boolean {
  return CHECKPOINTS.some((h) => publishedAt + h * HOUR <= now && (!lastAt || lastAt < publishedAt + h * HOUR));
}

/** Instagram's metric list → our numbers, with the rates the brain compares (per person reached). Pure. */
export function readStats(data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[], seconds: number | undefined, publishedAt: number, now = Date.now()): IgStats {
  const v = (k: string) => {
    const m = data.find((x) => x.name === k);
    return Number(m?.values?.[0]?.value ?? m?.total_value?.value ?? 0) || 0;
  };
  const reach = v('reach');
  const avgMs = v('ig_reels_avg_watch_time');
  const rate = (x: number) => (reach ? Math.round((x / reach) * 10000) / 10000 : 0);
  return {
    at: now,
    ageHours: Math.round((now - publishedAt) / HOUR),
    views: v('views'),
    reach,
    likes: v('likes'),
    comments: v('comments'),
    shares: v('shares'),
    saved: v('saved'),
    interactions: v('total_interactions'),
    ...(avgMs ? { avgWatchSec: Math.round(avgMs / 100) / 10, ...(seconds ? { watchedPct: Math.min(100, Math.round((avgMs / 1000 / seconds) * 100)) } : {}) } : {}),
    saveRate: rate(v('saved')),
    shareRate: rate(v('shares')),
  };
}

async function token(): Promise<{ token: string; userId: string } | undefined> {
  const v = await getParam('/lens/growth/instagram').catch(() => undefined);
  return v ? (JSON.parse(v) as { token: string; userId: string }) : undefined;
}

async function get(path: string, params: Record<string, string>, t: string): Promise<any> {
  const r = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, access_token: t })}`, { signal: AbortSignal.timeout(30_000) });
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok || j.error) throw new Error(String(j.error?.message ?? r.status).slice(0, 200));
  return j;
}

/** The chain's stats step: posts whose next checkpoint has come (at most 10 a run), and the account once a day. */
export async function igStats(now = Date.now()): Promise<{ posts: number; day?: string }> {
  const c = await token();
  if (!c) return { posts: 0 };
  const due: Record<string, any>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p AND begins_with(sk, :s)', FilterExpression: 'attribute_exists(published.instagram.mediaId)', ExpressionAttributeValues: { ':p': 'GROWTH', ':s': 'POST#' }, ExclusiveStartKey: start }));
    for (const p of r.Items ?? []) if (statsDue(Number(p.published.instagram.at), p.stats?.instagram?.at, now)) due.push(p);
    start = r.LastEvaluatedKey;
  } while (start);
  let n = 0;
  for (const p of due.slice(0, 10)) {
    const ig = p.published.instagram;
    try {
      const j = await get(`${ig.mediaId}/insights`, { metric: ig.kind === 'reel' ? REEL_METRICS : FEED_METRICS }, c.token);
      const s = readStats(j.data ?? [], ig.kind === 'reel' ? Number(p.reel?.seconds) || undefined : undefined, Number(ig.at), now);
      const history = [...((p.statsHistory?.instagram as IgStats[] | undefined) ?? []), s].slice(-12);
      await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `POST#${p.id}` }, UpdateExpression: 'SET stats = :s, statsHistory = :h', ExpressionAttributeValues: { ':s': { ...(p.stats ?? {}), instagram: s }, ':h': { ...(p.statsHistory ?? {}), instagram: history } } }));
      n++;
    } catch (e) {
      console.error(JSON.stringify({ igStatsFailed: p.id, message: (e as Error).message }));
    }
  }
  // The account, once a day (yesterday's numbers are final by now).
  const day = new Date(now - 86_400_000).toISOString().slice(0, 10);
  const have = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'GROWTH', sk: `IGDAY#${day}` } }))).Item;
  if (!have) {
    try {
      const me = await get('me', { fields: 'followers_count,media_count' }, c.token);
      const since = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
      const ins = await get('me/insights', { metric: 'reach,profile_views,website_clicks,accounts_engaged', period: 'day', metric_type: 'total_value', since: String(since), until: String(since + 86400) }, c.token);
      const val = (k: string) => Number((ins.data ?? []).find((x: any) => x.name === k)?.total_value?.value ?? 0) || 0;
      await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `IGDAY#${day}`, day, followers: Number(me.followers_count) || 0, media: Number(me.media_count) || 0, reach: val('reach'), profileViews: val('profile_views'), websiteClicks: val('website_clicks'), accountsEngaged: val('accounts_engaged'), at: now, ttl: Math.floor((now + 400 * 86_400_000) / 1000) } }));
      console.log(JSON.stringify({ igDay: day }));
      return { posts: n, day };
    } catch (e) {
      console.error(JSON.stringify({ igDayFailed: (e as Error).message }));
    }
  }
  return { posts: n };
}
