// AWS costs from Cost Explorer (each call costs $0.01, so it's read at most every 12 hours):
// this month and last month by service, the last 30 days day by day, and AWS's month-end forecast.
import { CostExplorerClient, GetCostAndUsageCommand, GetCostForecastCommand } from '@aws-sdk/client-cost-explorer';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import { ddb, env, json, rateLimit, Req, Res } from '../api/lib';

const CACHE_MS = 12 * 3_600_000;
const ce = new CostExplorerClient({ region: 'us-east-1' });
const BUDGET_USD = Number(process.env.MONTHLY_BUDGET_USD ?? 0);

const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function compute() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const thirtyAgo = new Date(tomorrow.getTime() - 30 * 86_400_000);

  // Usage before credits (what each service costs), and credits/refunds separately: with AWS
  // credits on the account the net per service is ~0, which says nothing.
  const usageOnly = { Not: { Dimensions: { Key: 'RECORD_TYPE' as const, Values: ['Credit', 'Refund'] } } };
  const [byService, byType, daily, forecast] = await Promise.all([
    ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: ymd(lastMonthStart), End: ymd(tomorrow) },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        Filter: usageOnly,
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }),
    ),
    ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: ymd(lastMonthStart), End: ymd(tomorrow) },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'RECORD_TYPE' }],
      }),
    ),
    ce.send(new GetCostAndUsageCommand({ TimePeriod: { Start: ymd(thirtyAgo), End: ymd(tomorrow) }, Granularity: 'DAILY', Metrics: ['UnblendedCost'], Filter: usageOnly })),
    // No forecast on the last day of the month or with too little history: that's fine.
    ymd(tomorrow) < ymd(nextMonth)
      ? ce
          .send(new GetCostForecastCommand({ TimePeriod: { Start: ymd(tomorrow), End: ymd(nextMonth) }, Metric: 'UNBLENDED_COST', Granularity: 'MONTHLY', Filter: usageOnly }))
          .catch((e) => (console.error('forecast', e), null))
      : Promise.resolve(null),
  ]);

  const months = (byService.ResultsByTime ?? []).map((r) => {
    const services = (r.Groups ?? [])
      .map((g) => ({ service: g.Keys?.[0] ?? '?', usd: Number(g.Metrics?.UnblendedCost?.Amount ?? 0) }))
      .filter((s) => Math.abs(s.usd) >= 0.005)
      .sort((a, b) => b.usd - a.usd);
    const month = r.TimePeriod?.Start?.slice(0, 7) ?? '?';
    const types = byType.ResultsByTime?.find((t) => t.TimePeriod?.Start?.slice(0, 7) === month)?.Groups ?? [];
    const credits = types.filter((g) => ['Credit', 'Refund'].includes(g.Keys?.[0] ?? '')).reduce((s, g) => s + Number(g.Metrics?.UnblendedCost?.Amount ?? 0), 0);
    const usd = services.reduce((s, x) => s + x.usd, 0);
    return { month, usd, credits, net: Math.max(0, usd + credits), services, estimated: !!r.Estimated };
  });
  const thisMonth = months.find((m) => m.month === ymd(monthStart).slice(0, 7)) ?? { month: ymd(monthStart).slice(0, 7), usd: 0, credits: 0, net: 0, services: [], estimated: true };
  const lastMonth = months.find((m) => m.month === ymd(lastMonthStart).slice(0, 7)) ?? null;
  const rest = forecast ? Number(forecast.Total?.Amount ?? 0) : null;

  return {
    at: Date.now(),
    currency: 'USD',
    budgetUsd: BUDGET_USD || null,
    thisMonth,
    lastMonth,
    forecastMonthUsd: rest === null ? null : thisMonth.usd + rest,
    daily: (daily.ResultsByTime ?? []).map((r) => ({ day: r.TimePeriod?.Start ?? '', usd: Number(r.Total?.UnblendedCost?.Amount ?? 0) })),
  };
}

/** GET /api/costs[?refresh=1] */
export async function costs(req: Req): Promise<Res> {
  const cached = (await ddb.send(new GetCommand({ TableName: env.table, Key: { pk: 'STATS', sk: 'COSTS' } }))).Item;
  const refresh = req.query.refresh === '1';
  if (cached && !refresh && Date.now() - cached.data.at < CACHE_MS) return json(200, { ...cached.data, cached: true });
  // Refreshing costs money (a little): at most 6 times an hour.
  if (refresh) await rateLimit('console-costs-refresh', 6, 'Costs were refreshed recently. They update a few times a day anyway.');
  const data = await compute();
  await ddb.send(new PutCommand({ TableName: env.table, Item: { pk: 'STATS', sk: 'COSTS', data } }));
  return json(200, data);
}
