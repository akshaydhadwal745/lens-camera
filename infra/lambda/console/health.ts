// System health from AWS's own metrics (no user data): the Lens API and background functions,
// the website/CDN, video processing (Batch), email (SES) and the database. Cached 5 minutes.
import { BatchClient, ListJobsCommand } from '@aws-sdk/client-batch';
import { CloudWatchClient, GetMetricDataCommand, MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { GetAccountCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, json, Req, Res } from '../api/lib';

const HOUR = 3_600_000;
const CACHE_MS = 5 * 60_000;

const cw = new CloudWatchClient({});
// CloudFront publishes its metrics in us-east-1 only.
const cwGlobal = new CloudWatchClient({ region: 'us-east-1' });
const batch = new BatchClient({});
const ses = new SESv2Client({});

const csv = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
// "label=function-name,…", plus this console's own function.
const FUNCTIONS = [...csv(process.env.HEALTH_FUNCTIONS), ...(process.env.AWS_LAMBDA_FUNCTION_NAME ? [`Console=${process.env.AWS_LAMBDA_FUNCTION_NAME}`] : [])];
const QUEUES = csv(process.env.HEALTH_QUEUES); // "label=queue-arn,…"
const DISTRIBUTION = process.env.HEALTH_DISTRIBUTION ?? '';

const pair = (s: string) => {
  const i = s.indexOf('=');
  return { label: s.slice(0, i), name: s.slice(i + 1) };
};

type Q = { id: string; ns: string; metric: string; dims: Record<string, string>; stat: string; period: number };

async function metrics(client: CloudWatchClient, queries: Q[], hours: number) {
  if (!queries.length) return {};
  const end = new Date(Math.floor(Date.now() / HOUR) * HOUR + HOUR);
  const start = new Date(end.getTime() - hours * HOUR);
  const out: Record<string, { t: number; v: number }[]> = {};
  // GetMetricData takes up to 500 queries; we use far fewer.
  const r = await client.send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      ScanBy: 'TimestampAscending',
      MetricDataQueries: queries.map(
        (q): MetricDataQuery => ({
          Id: q.id,
          MetricStat: {
            Metric: { Namespace: q.ns, MetricName: q.metric, Dimensions: Object.entries(q.dims).map(([Name, Value]) => ({ Name, Value })) },
            Period: q.period,
            Stat: q.stat,
          },
        }),
      ),
    }),
  );
  for (const m of r.MetricDataResults ?? []) {
    out[m.Id!] = (m.Timestamps ?? []).map((t, i) => ({ t: t.getTime(), v: m.Values?.[i] ?? 0 }));
  }
  return out;
}

const total = (xs?: { v: number }[]) => (xs ?? []).reduce((s, x) => s + x.v, 0);
const maxOf = (xs?: { v: number }[]) => (xs ?? []).reduce((m, x) => Math.max(m, x.v), 0);
/** Hourly buckets for the last 24 h (missing hours = 0). */
function hourly(xs: { t: number; v: number }[] | undefined) {
  const end = Math.floor(Date.now() / HOUR) * HOUR;
  const map = new Map((xs ?? []).map((x) => [x.t, x.v]));
  return Array.from({ length: 24 }, (_, i) => {
    const t = end - (23 - i) * HOUR;
    return { t, v: map.get(t) ?? 0 };
  });
}

export async function compute() {
  const fns = FUNCTIONS.map(pair);
  const lambdaQ: Q[] = fns.flatMap((f, i) => [
    { id: `inv${i}`, ns: 'AWS/Lambda', metric: 'Invocations', dims: { FunctionName: f.name }, stat: 'Sum', period: 3600 },
    { id: `err${i}`, ns: 'AWS/Lambda', metric: 'Errors', dims: { FunctionName: f.name }, stat: 'Sum', period: 3600 },
    { id: `thr${i}`, ns: 'AWS/Lambda', metric: 'Throttles', dims: { FunctionName: f.name }, stat: 'Sum', period: 3600 },
    { id: `p95${i}`, ns: 'AWS/Lambda', metric: 'Duration', dims: { FunctionName: f.name }, stat: 'p95', period: 3600 },
  ]);
  const dbQ: Q[] = [
    { id: 'dbr', ns: 'AWS/DynamoDB', metric: 'ConsumedReadCapacityUnits', dims: { TableName: env.table }, stat: 'Sum', period: 3600 },
    { id: 'dbw', ns: 'AWS/DynamoDB', metric: 'ConsumedWriteCapacityUnits', dims: { TableName: env.table }, stat: 'Sum', period: 3600 },
    { id: 'dbt', ns: 'AWS/DynamoDB', metric: 'ThrottledRequests', dims: { TableName: env.table }, stat: 'Sum', period: 3600 },
    { id: 'sesSend', ns: 'AWS/SES', metric: 'Send', dims: {}, stat: 'Sum', period: 3600 },
    { id: 'sesBounce', ns: 'AWS/SES', metric: 'Bounce', dims: {}, stat: 'Sum', period: 3600 },
    { id: 'sesComplaint', ns: 'AWS/SES', metric: 'Complaint', dims: {}, stat: 'Sum', period: 3600 },
  ];
  const cdnQ: Q[] = DISTRIBUTION
    ? [
        { id: 'req', ns: 'AWS/CloudFront', metric: 'Requests', dims: { DistributionId: DISTRIBUTION, Region: 'Global' }, stat: 'Sum', period: 3600 },
        { id: 'e5', ns: 'AWS/CloudFront', metric: '5xxErrorRate', dims: { DistributionId: DISTRIBUTION, Region: 'Global' }, stat: 'Average', period: 3600 },
        { id: 'e4', ns: 'AWS/CloudFront', metric: '4xxErrorRate', dims: { DistributionId: DISTRIBUTION, Region: 'Global' }, stat: 'Average', period: 3600 },
        { id: 'bytes', ns: 'AWS/CloudFront', metric: 'BytesDownloaded', dims: { DistributionId: DISTRIBUTION, Region: 'Global' }, stat: 'Sum', period: 3600 },
      ]
    : [];

  const [m, cdn, jobs, account] = await Promise.all([
    metrics(cw, [...lambdaQ, ...dbQ], 24 * 7),
    metrics(cwGlobal, cdnQ, 24 * 7).catch((e) => (console.error('cdn metrics', e), {} as Record<string, { t: number; v: number }[]>)),
    Promise.all(
      QUEUES.map(pair).map(async (q) => {
        const counts: Record<string, number> = {};
        for (const status of ['RUNNABLE', 'STARTING', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const) {
          let next: string | undefined;
          let n = 0;
          do {
            const r = await batch.send(new ListJobsCommand({ jobQueue: q.name, jobStatus: status, nextToken: next, maxResults: 100 }));
            n += r.jobSummaryList?.length ?? 0;
            next = r.nextToken;
          } while (next && n < 1000);
          counts[status.toLowerCase()] = n;
        }
        return { label: q.label, ...counts };
      }),
    ).catch((e) => (console.error('batch', e), [])),
    ses.send(new GetAccountCommand({})).catch((e) => (console.error('ses', e), null)),
  ]);

  const day = (xs?: { t: number; v: number }[]) => (xs ?? []).filter((x) => x.t >= Date.now() - 24 * HOUR);
  const weighted = (vals: { t: number; v: number }[], weights: { t: number; v: number }[]) => {
    const w = new Map(weights.map((x) => [x.t, x.v]));
    const total = vals.reduce((s, x) => s + (w.get(x.t) ?? 0), 0);
    return total ? vals.reduce((s, x) => s + x.v * (w.get(x.t) ?? 0), 0) / total : maxOf(vals);
  };
  const functions = fns.map((f, i) => {
    const inv7 = total(m[`inv${i}`]);
    const err7 = total(m[`err${i}`]);
    const inv1 = total(day(m[`inv${i}`]));
    const err1 = total(day(m[`err${i}`]));
    return {
      label: f.label,
      invocations24h: inv1,
      errors24h: err1,
      errorRate24h: inv1 ? err1 / inv1 : 0,
      invocations7d: inv7,
      errors7d: err7,
      throttles7d: total(m[`thr${i}`]),
      // Each hour's p95 weighted by its calls: a quiet hour with one slow call can't set the day's figure.
      p95Ms24h: Math.round(weighted(day(m[`p95${i}`]), day(m[`inv${i}`]))),
      hourly: hourly(m[`inv${i}`]).map((x, k) => ({ t: x.t, calls: x.v, errors: hourly(m[`err${i}`])[k].v })),
    };
  });

  const status = (ok: boolean, warn: boolean) => (!ok ? 'bad' : warn ? 'warn' : 'good');
  const sesSent = total(m.sesSend);
  const bounceRate = sesSent ? total(m.sesBounce) / sesSent : 0;
  const complaintRate = sesSent ? total(m.sesComplaint) / sesSent : 0;
  const cdnReq = total(cdn.req);
  const cdn5 = maxOf(day(cdn.e5));

  const checks = [
    ...functions.map((f) => ({
      name: `${f.label} function`,
      status: status(f.errorRate24h < 0.05, f.errorRate24h >= 0.01 || f.throttles7d > 0),
      detail: `${f.errors24h} errors in ${f.invocations24h} calls (24 h) · p95 ${f.p95Ms24h} ms`,
    })),
    ...(DISTRIBUTION ? [{ name: 'Website & media CDN', status: status(cdn5 < 5, cdn5 >= 1), detail: `${Math.round(cdnReq)} requests in 7 days · worst hour ${cdn5.toFixed(2)}% server errors` }] : []),
    ...jobs.map((j: Record<string, any>) => ({
      name: `Video processing (${j.label})`,
      status: status(j.failed < 5, j.failed > 0 || j.runnable > 10),
      detail: `${j.running ?? 0} running · ${j.runnable ?? 0} waiting · ${j.succeeded ?? 0} done · ${j.failed ?? 0} failed (recent)`,
    })),
    {
      name: 'Email (sign-in codes, feedback)',
      status: account ? status(account.SendingEnabled !== false && account.EnforcementStatus !== 'SHUTDOWN', account.EnforcementStatus === 'PROBATION' || (sesSent >= 50 && (bounceRate > 0.04 || complaintRate > 0.001))) : 'warn',
      detail: account
        ? `${Math.round(account.SendQuota?.SentLast24Hours ?? 0)} sent in 24 h of ${Math.round(account.SendQuota?.Max24HourSend ?? 0)} allowed · ${sesSent >= 50 ? `bounces ${(bounceRate * 100).toFixed(1)}%` : `${Math.round(total(m.sesBounce))} of ${Math.round(sesSent)} bounced this week`} · ${(account.EnforcementStatus ?? 'healthy').toLowerCase()}`
        : 'Could not read the email account',
    },
    {
      name: 'Database',
      status: status(total(m.dbt) < 50, total(m.dbt) > 0),
      detail: `${Math.round(total(m.dbr))} reads · ${Math.round(total(m.dbw))} writes · ${Math.round(total(m.dbt))} throttled (7 days)`,
    },
  ];

  return {
    at: Date.now(),
    overall: checks.some((c) => c.status === 'bad') ? 'bad' : checks.some((c) => c.status === 'warn') ? 'warn' : 'good',
    checks,
    functions,
    cdn: DISTRIBUTION ? { requests7d: cdnReq, bytes7d: total(cdn.bytes), hourly: hourly(cdn.req).map((x) => ({ t: x.t, requests: x.v })) } : null,
    jobs,
    email: account ? { sent24h: account.SendQuota?.SentLast24Hours ?? 0, max24h: account.SendQuota?.Max24HourSend ?? 0, enforcement: account.EnforcementStatus, bounceRate, complaintRate, sent7d: sesSent } : null,
  };
}

/** GET /api/health[?refresh=1] */
export async function health(req: Req): Promise<Res> {
  const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'STATS', sk: 'HEALTH' } }))).Item;
  if (cached && req.query.refresh !== '1' && Date.now() - cached.data.at < CACHE_MS) return json(200, { ...cached.data, cached: true });
  const data = await compute();
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'STATS', sk: 'HEALTH', data } }));
  return json(200, data);
}
