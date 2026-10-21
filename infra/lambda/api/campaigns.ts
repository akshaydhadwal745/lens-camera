// Notification campaigns written in the Lens Console (docs/design/notifications.md).
//
//   CAMPAIGNS        <createdAt>#<id>  → list index
//   CAMPAIGN#<id>    META              → { title, body, route, category, audience, status, scheduledAt, expiresAt, stats }
//   CR#<id>          <accountId>       → one recipient { status: pending | sent | failed | off | capped | no-device | expired }
//
// The Maintenance function runs every 15 minutes: due campaigns get their recipients, then each run
// sends to the ones whose phone is in daytime (9:00–21:00 local), within the daily/weekly limits
// (push.ts deliver). Whatever is still waiting 24 hours after the start is dropped as "expired".
import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, HttpError, inWelcome, PLAN_CHANGE_WELCOME_UNTIL, quotaFor, randomId } from './lib';
import { Category, deliver, DeliveryResult } from './push';
import { Row, scanTable } from './table-scan';
import { testAccounts } from './test-accounts';

const DAY = 86_400_000;
const SEND_WINDOW_MS = DAY;
const KEEP_SECONDS = 400 * 86400;
const ROUTES = ['/', '/gallery', '/settings', '/invite', '/storage', '/albums', '/recaps', '/people', '/places', '/feedback', '/links'];
export const CAMPAIGN_CATEGORIES: Category[] = ['news', 'account'];

export type Audience = {
  signedIn?: 'any' | 'yes' | 'no';
  plans?: ('guest' | 'welcome' | 'free')[];
  activeWithinDays?: number;
  inactiveForDays?: number;
  installedWithinDays?: number;
  minStoragePct?: number;
  builds?: string[];
  regions?: string[];
  hasShared?: 'any' | 'yes' | 'no';
  /** Test send: only these account ids (the console fills in the sender's own Lens account). */
  only?: string[];
};

export type Campaign = {
  id: string;
  title: string;
  body: string;
  route: string;
  category: Category;
  audience: Audience;
  status: 'scheduled' | 'sending' | 'sent' | 'cancelled';
  scheduledAt: number;
  expiresAt: number;
  createdAt: number;
  createdBy: string;
  finishedAt?: number;
  stats: Record<string, number>;
};

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, max);

export function validate(input: Record<string, any>): Omit<Campaign, 'id' | 'status' | 'expiresAt' | 'createdAt' | 'createdBy' | 'stats'> {
  const title = clean(input.title, 65);
  const body = clean(input.body, 240);
  if (title.length < 3) throw new HttpError(400, 'Write a headline (3–65 characters)');
  if (body.length < 5) throw new HttpError(400, 'Write a message (5–240 characters)');
  const route = ROUTES.includes(input.route) ? input.route : '/';
  const category = CAMPAIGN_CATEGORIES.includes(input.category) ? (input.category as Category) : 'news';
  const now = Date.now();
  const scheduledAt = input.scheduledAt === undefined || input.scheduledAt === null ? now : Number(input.scheduledAt);
  if (!Number.isFinite(scheduledAt) || scheduledAt < now - 60_000 || scheduledAt > now + 60 * DAY) throw new HttpError(400, 'Pick a time within the next 60 days');
  const a = (input.audience ?? {}) as Record<string, any>;
  const num = (v: unknown, max: number) => (v === undefined || v === null || v === '' ? undefined : Math.max(0, Math.min(max, Math.round(Number(v)))) || undefined);
  const list = (v: unknown, re: RegExp) => (Array.isArray(v) ? v.map(String).filter((x) => re.test(x)).slice(0, 20) : undefined);
  const audience: Audience = {
    signedIn: ['yes', 'no'].includes(a.signedIn) ? a.signedIn : 'any',
    plans: Array.isArray(a.plans) ? a.plans.filter((p: string) => ['guest', 'welcome', 'free'].includes(p)) : undefined,
    activeWithinDays: num(a.activeWithinDays, 365),
    inactiveForDays: num(a.inactiveForDays, 365),
    installedWithinDays: num(a.installedWithinDays, 3650),
    minStoragePct: num(a.minStoragePct, 100),
    builds: list(a.builds, /^dev-\d{1,5}$/),
    regions: list(a.regions, /^[A-Z]{2}$/),
    hasShared: ['yes', 'no'].includes(a.hasShared) ? a.hasShared : 'any',
    only: list(a.only, /^[A-Za-z0-9_-]{6,40}$/),
  };
  if (audience.plans && !audience.plans.length) delete audience.plans;
  return { title, body, route, category, audience, scheduledAt };
}

const FIELDS = ['pk', 'sk', 'email', 'createdAt', 'usedBytes', 'bonusBytes', 'welcomeUntil', 'test', 'emulator', 'guestId', 'lastUsedAt', 'build', 'region'];

/** Account ids that match (real accounts only), and how many have a phone that can get pushes. */
export async function resolveAudience(a: Audience, now = Date.now()): Promise<{ ids: string[]; reachable: number }> {
  const rows = await scanTable(FIELDS);
  const profiles = rows.filter((r) => r.sk === 'PROFILE' && String(r.pk).startsWith('D#'));
  const test = testAccounts(profiles, rows.filter((r) => r.sk === 'DEVICE' && String(r.pk).startsWith('FP#')));
  const pushIds = new Set<string>();
  const shared = new Set<string>();
  const lastActive = new Map<string, number>();
  const latestAct = new Map<string, Row>();
  for (const r of rows) {
    const pk = String(r.pk);
    const sk = String(r.sk);
    if (pk.startsWith('ACT#')) {
      const t = Date.parse(`${pk.slice(4)}T12:00:00Z`);
      lastActive.set(sk, Math.max(lastActive.get(sk) ?? 0, t));
      if (!latestAct.get(sk) || String(latestAct.get(sk)!.pk) < pk) latestAct.set(sk, r);
      continue;
    }
    if (!pk.startsWith('D#')) continue;
    const id = pk.slice(2);
    if (sk.startsWith('PUSH#')) pushIds.add(id);
    else if (sk.startsWith('OUT#') || sk.startsWith('LKO#') || sk.startsWith('AM#')) shared.add(id);
    else if (sk.startsWith('T#') && typeof r.lastUsedAt === 'number') lastActive.set(id, Math.max(lastActive.get(id) ?? 0, r.lastUsedAt));
  }
  const only = a.only?.length ? new Set(a.only) : null;
  const ids: string[] = [];
  for (const p of profiles) {
    const id = String(p.pk).slice(2);
    if (only) {
      if (only.has(id)) ids.push(id);
      continue;
    }
    if (test.has(id)) continue;
    const plan = !p.email ? 'guest' : inWelcome({ welcomeUntil: p.welcomeUntil ?? PLAN_CHANGE_WELCOME_UNTIL }, now) ? 'welcome' : 'free';
    if (a.signedIn === 'yes' && !p.email) continue;
    if (a.signedIn === 'no' && p.email) continue;
    if (a.plans && !a.plans.includes(plan)) continue;
    const last = lastActive.get(id) ?? p.createdAt ?? 0;
    if (a.activeWithinDays && last < now - a.activeWithinDays * DAY) continue;
    if (a.inactiveForDays && last > now - a.inactiveForDays * DAY) continue;
    if (a.installedWithinDays && (p.createdAt ?? 0) < now - a.installedWithinDays * DAY) continue;
    if (a.minStoragePct) {
      const quota = quotaFor({ email: p.email, bonusBytes: p.bonusBytes, welcomeUntil: p.welcomeUntil ?? PLAN_CHANGE_WELCOME_UNTIL }, now);
      if (!quota || ((p.usedBytes ?? 0) / quota) * 100 < a.minStoragePct) continue;
    }
    const act = latestAct.get(id);
    if (a.builds?.length && !a.builds.includes(String(act?.build ?? ''))) continue;
    if (a.regions?.length && !a.regions.includes(String(act?.region ?? ''))) continue;
    if (a.hasShared === 'yes' && !shared.has(id)) continue;
    if (a.hasShared === 'no' && shared.has(id)) continue;
    ids.push(id);
  }
  return { ids, reachable: ids.filter((id) => pushIds.has(id)).length };
}

export async function createCampaign(input: Record<string, any>, createdBy: string): Promise<Campaign> {
  const v = validate(input);
  const now = Date.now();
  const id = randomId(9).replace(/[^A-Za-z0-9]/g, 'x');
  const c: Campaign = { ...v, id, status: 'scheduled', expiresAt: v.scheduledAt + SEND_WINDOW_MS, createdAt: now, createdBy, stats: {} };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: `CAMPAIGN#${id}`, sk: 'META', ...c, ttl: Math.floor(now / 1000) + KEEP_SECONDS } }));
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'CAMPAIGNS', sk: `${String(now).padStart(15, '0')}#${id}`, id, ttl: Math.floor(now / 1000) + KEEP_SECONDS } }));
  return c;
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  if (!/^[A-Za-z0-9_-]{6,30}$/.test(id)) return null;
  const r = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: `CAMPAIGN#${id}`, sk: 'META' } }))).Item;
  if (!r) return null;
  const { pk: _p, sk: _s, ttl: _t, ...c } = r;
  return c as Campaign;
}

export async function listCampaigns(limit = 50): Promise<Campaign[]> {
  const r = await ddb.send(new QueryCommand({ TableName: env.table, KeyConditionExpression: 'pk = :p', ExpressionAttributeValues: { ':p': 'CAMPAIGNS' }, ScanIndexForward: false, Limit: limit }));
  const out = await Promise.all((r.Items ?? []).map((i) => getCampaign(String(i.id))));
  return out.filter((c): c is Campaign => !!c);
}

export async function cancelCampaign(id: string): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.table,
        Key: { pk: `CAMPAIGN#${id}`, sk: 'META' },
        UpdateExpression: 'SET #s = :c, finishedAt = :n',
        ConditionExpression: '#s IN (:sch, :sending)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':c': 'cancelled', ':n': Date.now(), ':sch': 'scheduled', ':sending': 'sending' },
      }),
    );
  } catch (e) {
    if ((e as { name?: string })?.name === 'ConditionalCheckFailedException') throw new HttpError(409, 'Only scheduled or sending campaigns can be stopped');
    throw e;
  }
}

async function addStats(id: string, counts: Record<string, number>, extra: Record<string, unknown> = {}) {
  const names: Record<string, string> = { '#st': 'stats' };
  const values: Record<string, unknown> = {};
  const adds: string[] = [];
  Object.entries(counts).forEach(([k, n], i) => {
    if (!n) return;
    names[`#k${i}`] = k;
    values[`:v${i}`] = n;
    adds.push(`#st.#k${i} :v${i}`);
  });
  const sets = Object.keys(extra).map((k, i) => {
    names[`#e${i}`] = k;
    values[`:e${i}`] = extra[k];
    return `#e${i} = :e${i}`;
  });
  if (!adds.length && !sets.length) return;
  await ddb.send(
    new UpdateCommand({
      TableName: env.table,
      Key: { pk: `CAMPAIGN#${id}`, sk: 'META' },
      UpdateExpression: [sets.length ? `SET ${sets.join(', ')}` : '', adds.length ? `ADD ${adds.join(', ')}` : ''].filter(Boolean).join(' '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/** Every 15 minutes (Maintenance): start due campaigns and send to recipients in their daytime. */
export async function runCampaigns(now: number, deadline: number, onlyId?: string): Promise<Record<string, number>> {
  const totals: Record<string, number> = {};
  const list = onlyId ? [await getCampaign(onlyId)].filter((c): c is Campaign => !!c) : await listCampaigns(30);
  for (const c of list) {
    if (Date.now() > deadline) break;
    if (c.status === 'scheduled' && c.scheduledAt <= now) {
      const { ids } = await resolveAudience(c.audience, now);
      for (let i = 0; i < ids.length; i += 25) {
        await ddb.send(
          new BatchWriteCommand({
            RequestItems: {
              [env.table]: ids.slice(i, i + 25).map((uid) => ({
                PutRequest: { Item: { pk: `CR#${c.id}`, sk: uid, status: 'pending', ttl: Math.floor(now / 1000) + 60 * 86400 } },
              })),
            },
          }),
        );
      }
      await addStats(c.id, { targeted: ids.length }, { status: 'sending', startedAt: now });
      c.status = 'sending';
    }
    if (c.status !== 'sending') continue;
    const counts: Record<string, number> = {};
    let pending = 0;
    let start: Record<string, unknown> | undefined;
    do {
      const r = await ddb.send(
        new QueryCommand({
          TableName: env.table,
          KeyConditionExpression: 'pk = :p',
          FilterExpression: '#s = :pending',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':p': `CR#${c.id}`, ':pending': 'pending' },
          ExclusiveStartKey: start,
        }),
      );
      const batch = r.Items ?? [];
      for (let i = 0; i < batch.length; i += 20) {
        if (Date.now() > deadline) break;
        const results = await Promise.all(
          batch.slice(i, i + 20).map(async (row): Promise<[string, DeliveryResult | 'expired']> => {
            const uid = String(row.sk);
            if (now > c.expiresAt) return [uid, 'expired'];
            return [uid, await deliver(uid, c.category, { title: c.title, body: c.body, route: c.route }, { data: { campaign: c.id, kind: 'campaign' }, now })];
          }),
        );
        for (const [uid, result] of results) {
          if (result === 'quiet') {
            pending++;
            continue;
          }
          counts[result] = (counts[result] ?? 0) + 1;
          await ddb.send(new UpdateCommand({ TableName: env.table, Key: { pk: `CR#${c.id}`, sk: uid }, UpdateExpression: 'SET #s = :r, #a = :n', ExpressionAttributeNames: { '#s': 'status', '#a': 'at' }, ExpressionAttributeValues: { ':r': result, ':n': now } }));
        }
      }
      start = r.LastEvaluatedKey;
    } while (start && Date.now() < deadline);
    const done = !start && pending === 0;
    await addStats(c.id, counts, done ? { status: 'sent', finishedAt: now } : {});
    for (const [k, n] of Object.entries(counts)) totals[k] = (totals[k] ?? 0) + n;
  }
  return totals;
}
