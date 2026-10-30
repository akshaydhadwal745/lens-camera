// Account integrations for the growth workspace (docs/growth/growth-workspace.md, group 5). Each one
// reads its keys from SSM (/lens/growth/<name>, JSON, SecureString) once a day in the maintenance job and
// stores what Lens Console shows: GROWTH / INTEG#<name> { connected, at, metrics, recent, error, setup }.
// No keys → connected: false with the setup steps, and nothing else happens. Read-only for now: posting
// and sending stay with people (drafts in the Console) until the owner turns publishing on.
//   instagram  {"accessToken","igUserId","pageId"?}   Meta Graph API (Instagram business + Facebook Page)
//   youtube    {"apiKey","channelId"}                 YouTube Data API v3 (public channel statistics)
//   pinterest  {"accessToken"}                        Pinterest API v5 (business account analytics)
//   email      {"from","secret"}                      SES marketing email: consent on PROFILE.marketingEmail
import { createHmac } from 'node:crypto';

import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, HttpError, json, Req, Res, safeEqual } from './lib';
import { scanTable } from './table-scan';

const DAY = 86_400_000;
const GRAPH = 'https://graph.facebook.com/v21.0';

export type IntegrationStatus = { connected: boolean; metrics: Record<string, number | string>; recent: { title: string; url: string; at: string; stats: Record<string, number> }[]; note?: string };

async function getJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body.error ?? body.message ?? body).slice(0, 160)}`);
  return body;
}

async function keys(name: string): Promise<Record<string, string> | undefined> {
  const raw = await getParam(`/lens/growth/${name}`).catch(() => undefined);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new Error(`/lens/growth/${name} is not JSON`);
  }
}

// ---------- connectors ----------

async function instagram(k: Record<string, string>): Promise<IntegrationStatus> {
  if (!k.accessToken || !k.igUserId) throw new Error('needs accessToken and igUserId');
  const auth = `access_token=${encodeURIComponent(k.accessToken)}`;
  const me = await getJson(`${GRAPH}/${k.igUserId}?fields=username,followers_count,media_count&${auth}`);
  const media = await getJson(`${GRAPH}/${k.igUserId}/media?fields=caption,permalink,timestamp,like_count,comments_count&limit=10&${auth}`);
  const page = k.pageId ? await getJson(`${GRAPH}/${k.pageId}?fields=name,followers_count&${auth}`).catch(() => undefined) : undefined;
  return {
    connected: true,
    metrics: { account: `@${me.username}`, followers: me.followers_count ?? 0, posts: me.media_count ?? 0, ...(page ? { facebookFollowers: page.followers_count ?? 0 } : {}) },
    recent: ((media.data ?? []) as Record<string, any>[]).map((m) => ({ title: String(m.caption ?? '').slice(0, 120), url: m.permalink, at: String(m.timestamp ?? '').slice(0, 10), stats: { likes: m.like_count ?? 0, comments: m.comments_count ?? 0 } })),
  };
}

async function youtube(k: Record<string, string>): Promise<IntegrationStatus> {
  if (!k.apiKey || !k.channelId) throw new Error('needs apiKey and channelId');
  const key = `key=${encodeURIComponent(k.apiKey)}`;
  const ch = ((await getJson(`https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=${encodeURIComponent(k.channelId)}&${key}`)).items ?? [])[0];
  if (!ch) throw new Error('channel not found');
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  const items = uploads ? ((await getJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=10&playlistId=${uploads}&${key}`)).items ?? []) : [];
  const ids = items.map((i: Record<string, any>) => i.contentDetails.videoId).join(',');
  const videos = ids ? ((await getJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids}&${key}`)).items ?? []) : [];
  const n = (v: unknown) => Number(v ?? 0);
  return {
    connected: true,
    metrics: { channel: ch.snippet?.title ?? k.channelId, subscribers: n(ch.statistics?.subscriberCount), views: n(ch.statistics?.viewCount), videos: n(ch.statistics?.videoCount) },
    recent: videos.map((v: Record<string, any>) => ({ title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id}`, at: String(v.snippet.publishedAt ?? '').slice(0, 10), stats: { views: n(v.statistics.viewCount), likes: n(v.statistics.likeCount), comments: n(v.statistics.commentCount) } })),
  };
}

async function pinterest(k: Record<string, string>, now: number): Promise<IntegrationStatus> {
  if (!k.accessToken) throw new Error('needs accessToken');
  const h = { authorization: `Bearer ${k.accessToken}` };
  const me = await getJson('https://api.pinterest.com/v5/user_account', h);
  const d = (t: number) => new Date(t).toISOString().slice(0, 10);
  const a = await getJson(`https://api.pinterest.com/v5/user_account/analytics?start_date=${d(now - 30 * DAY)}&end_date=${d(now - DAY)}&metric_types=IMPRESSION,SAVE,PIN_CLICK,OUTBOUND_CLICK`, h).catch(() => undefined);
  const sum = (a?.all?.summary_metrics ?? {}) as Record<string, number>;
  return {
    connected: true,
    metrics: { account: me.username ?? '', followers: me.follower_count ?? 0, monthlyViews: me.monthly_views ?? 0, impressions30d: sum.IMPRESSION ?? 0, saves30d: sum.SAVE ?? 0, outboundClicks30d: sum.OUTBOUND_CLICK ?? 0 },
    recent: [],
  };
}

async function email(k: Record<string, string>): Promise<IntegrationStatus> {
  if (!k.from || !k.secret) throw new Error('needs from and secret');
  const profiles = (await scanTable(['pk', 'sk', 'marketingEmail', 'email'])).filter((r) => r.sk === 'PROFILE');
  const consented = profiles.filter((p) => p.marketingEmail === true && p.email).length;
  const optedOut = profiles.filter((p) => p.marketingEmail === false).length;
  return { connected: true, metrics: { from: k.from, consented, optedOut }, recent: [], note: consented ? undefined : 'Nobody has opted in yet: the app needs a "Tips and news by email" switch (PUT /v1/me/marketing-email) before any send.' };
}

export const INTEGRATIONS = ['instagram', 'youtube', 'pinterest', 'email'] as const;

/** Daily (maintenance.ts): refresh every integration's status row. Never throws. */
export async function pullIntegrations(now = Date.now()): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of INTEGRATIONS) {
    let item: Record<string, unknown>;
    try {
      const k = await keys(name);
      if (!k) item = { connected: false, metrics: {}, recent: [] };
      else item = { ...(name === 'instagram' ? await instagram(k) : name === 'youtube' ? await youtube(k) : name === 'pinterest' ? await pinterest(k, now) : await email(k)) };
    } catch (e) {
      item = { connected: false, metrics: {}, recent: [], error: (e as Error).message.slice(0, 300) };
    }
    await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'GROWTH', sk: `INTEG#${name}`, at: now, ...item } }));
    out[name] = item.error ? `failed: ${String(item.error).slice(0, 80)}` : item.connected ? 'ok' : 'not connected';
  }
  return out;
}

// ---------- marketing email consent and one-click unsubscribe ----------

export const unsubscribeToken = (id: string, secret: string) => createHmac('sha256', secret).update(`unsub:${id}`).digest('base64url').slice(0, 32);

/** The link every marketing email carries (and its List-Unsubscribe header). */
export const unsubscribeLink = (id: string, secret: string) => `https://lens.instagrowapp.com/api/v1/email/unsubscribe?u=${encodeURIComponent(id)}&t=${unsubscribeToken(id, secret)}`;

async function setConsent(id: string, on: boolean, via: string) {
  await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: `D#${id}`, sk: 'PROFILE' }, UpdateExpression: 'SET marketingEmail = :v, marketingEmailAt = :t, marketingEmailVia = :w', ConditionExpression: 'attribute_exists(pk)', ExpressionAttributeValues: { ':v': on, ':t': Date.now(), ':w': via } }));
}

/** PUT /v1/me/marketing-email {on}: the account's own choice (off unless they turn it on). */
export async function setMarketingEmail(identity: { id: string }, req: Req): Promise<Res> {
  if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'on must be true or false');
  await setConsent(identity.id, req.body.on, 'app');
  return json(200, { marketingEmail: req.body.on });
}

/** GET or POST /v1/email/unsubscribe?u=&t= (public; POST is the one-click List-Unsubscribe-Post). */
export async function unsubscribe(req: Req): Promise<Res> {
  const k = await keys('email').catch(() => undefined);
  const id = req.query.u ?? '';
  const ok = !!k?.secret && /^[\w:-]{1,80}$/.test(id) && safeEqual(req.query.t ?? '', unsubscribeToken(id, k.secret));
  if (ok) await setConsent(id, false, 'unsubscribe-link').catch(() => undefined);
  const msg = ok ? 'You are unsubscribed. Lens will not send you tips or news by email. Account emails (sign-in codes, security) still arrive.' : 'This unsubscribe link is not valid. Turn off "Tips and news by email" in the app settings instead.';
  return { statusCode: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lens email</title><p style="font:16px system-ui;max-width:32em;margin:3em auto;padding:0 16px">${msg}</p>` };
}
