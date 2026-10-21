// App crashes and errors from Sentry (org instagrowapp, project lens-app). Read with a read-only
// token in SSM /lens/console/sentry-token; until it exists the page says how to connect it.
// Events carry no user identity (src/lib/sentry.ts drops it); we show titles and counts only.
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, getParam, HttpError, json, Req, Res } from '../api/lib';

const ORG = process.env.SENTRY_ORG ?? 'instagrowapp';
const PROJECT = process.env.SENTRY_PROJECT ?? 'lens-app';
const API = process.env.SENTRY_API ?? 'https://us.sentry.io/api/0';
const CACHE_MS = 10 * 60_000;
const PERIODS = ['24h', '14d', '90d'];

type Issue = {
  id: string;
  shortId: string;
  title: string;
  culprit?: string;
  level?: string;
  count: string;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  permalink: string;
  isUnhandled?: boolean;
  status?: string;
};

async function sentry(path: string, token: string) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Sentry refused the token: check its permissions (project:read, event:read)');
  if (!res.ok) throw new HttpError(502, `Sentry answered ${res.status}`);
  return res.json();
}

/** GET /api/errors?period=14d[&refresh=1] */
export async function errors(req: Req): Promise<Res> {
  const period = PERIODS.includes(req.query.period ?? '') ? req.query.period! : '14d';
  const token = await getParam('/lens/console/sentry-token');
  if (!token) return json(200, { connected: false, org: ORG, project: PROJECT });
  const key = { pk: 'STATS', sk: `ERRORS#${period}` };
  const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: key }))).Item;
  if (cached && req.query.refresh !== '1' && Date.now() - cached.data.at < CACHE_MS) return json(200, { ...cached.data, cached: true });

  const issues = (await sentry(
    `/projects/${ORG}/${PROJECT}/issues/?statsPeriod=${period}&query=${encodeURIComponent('is:unresolved')}&sort=freq&limit=50`,
    token,
  )) as Issue[];
  const data = {
    connected: true,
    at: Date.now(),
    period,
    org: ORG,
    project: PROJECT,
    issues: issues.map((i) => ({
      id: i.id,
      shortId: i.shortId,
      title: String(i.title).slice(0, 300),
      culprit: i.culprit?.slice(0, 200),
      level: i.level,
      events: Number(i.count),
      users: i.userCount,
      firstSeen: Date.parse(i.firstSeen),
      lastSeen: Date.parse(i.lastSeen),
      unhandled: !!i.isUnhandled,
      link: i.permalink,
    })),
  };
  await ddb.send(new PutCommand({ TableName: env.table, Item: { ...key, data } }));
  return json(200, data);
}
