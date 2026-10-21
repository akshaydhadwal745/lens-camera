import { useState } from 'react';

import { get } from '../api';
import { Badge, Bars, bytes, Card, Empty, Loaded, n, Page, Stat, Tabs, useLoad, when } from '../ui';

type Check = { name: string; status: 'good' | 'warn' | 'bad'; detail: string };
type Health = {
  at: number;
  overall: Check['status'];
  checks: Check[];
  functions: { label: string; invocations24h: number; errors24h: number; errorRate24h: number; invocations7d: number; errors7d: number; throttles7d: number; p95Ms24h: number; hourly: { t: number; calls: number; errors: number }[] }[];
  cdn: { requests7d: number; bytes7d: number; hourly: { t: number; requests: number }[] } | null;
};

const hour = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const OVERALL = { good: 'Everything is working', warn: 'Working, with something to watch', bad: 'Something needs attention' };

export function Health() {
  const [refresh, setRefresh] = useState(0);
  const state = useLoad(() => get<Health>(`/health${refresh ? '?refresh=1' : ''}`), [refresh]);
  return (
    <Page
      title="System health"
      actions={
        <>
          {state.data && <span className="muted small">Updated {when(state.data.at)}</span>}
          <button className="btn" disabled={state.loading} onClick={() => setRefresh((r) => r + 1)}>
            {state.loading ? 'Loading…' : 'Refresh'}
          </button>
        </>
      }
    >
      <Loaded state={state}>
        {(h) => (
          <>
            <Card>
              <div className="overall">
                <span className={`dot ${h.overall}`} /> {OVERALL[h.overall]}
              </div>
              {h.checks.map((c) => (
                <div key={c.name} className="check-row">
                  <span className={`dot ${c.status}`} />
                  <div>
                    <strong>{c.name}</strong>
                    <div className="muted small">{c.detail}</div>
                  </div>
                </div>
              ))}
            </Card>
            <div className="grid2">
              {h.functions.map((f) => (
                <Card key={f.label} title={f.label}>
                  <Bars
                    caption={
                      <>
                        Calls per hour (24 h) · <strong>{n(f.invocations24h)}</strong> · {f.errors24h ? <Badge tone="bad">{n(f.errors24h)} errors</Badge> : <Badge tone="good">no errors</Badge>}
                      </>
                    }
                    rows={f.hourly.map((x) => ({ label: hour(x.t), value: x.calls, bad: x.errors }))}
                  />
                  <p className="muted small">
                    7 days: {n(f.invocations7d)} calls · {n(f.errors7d)} errors · {n(f.throttles7d)} throttled · slowest hour p95 {n(f.p95Ms24h)} ms
                  </p>
                </Card>
              ))}
              {h.cdn && (
                <Card title="Website & media CDN">
                  <Bars caption={<>Requests per hour (24 h)</>} rows={h.cdn.hourly.map((x) => ({ label: hour(x.t), value: x.requests }))} />
                  <p className="muted small">
                    7 days: {n(Math.round(h.cdn.requests7d))} requests · {bytes(h.cdn.bytes7d)} served
                  </p>
                </Card>
              )}
            </div>
          </>
        )}
      </Loaded>
    </Page>
  );
}

type Issue = { id: string; shortId: string; title: string; culprit?: string; level?: string; events: number; users: number; firstSeen: number; lastSeen: number; unhandled: boolean; link: string };
type Errors = { connected: false; org: string; project: string } | { connected: true; at: number; period: string; issues: Issue[] };

export function Errors() {
  const [period, setPeriod] = useState<'24h' | '14d' | '90d'>('14d');
  const state = useLoad(() => get<Errors>(`/errors?period=${period}`), [period]);
  return (
    <Page
      title="App errors"
      actions={
        <Tabs
          value={period}
          onChange={setPeriod}
          options={[
            { value: '24h', label: '24 hours' },
            { value: '14d', label: '14 days' },
            { value: '90d', label: '90 days' },
          ]}
        />
      }
    >
      <p className="muted small">Crashes and errors from the Lens app (Sentry). Reports carry no account or personal details.</p>
      <Loaded state={state}>
        {(e) =>
          !e.connected ? (
            <Empty>Sentry isn’t connected yet. An owner adds a read-only Sentry token to finish this page.</Empty>
          ) : e.issues.length ? (
            <>
              <div className="stats">
                <Stat label="Open issues" value={n(e.issues.length)} />
                <Stat label="Events" value={n(e.issues.reduce((s, i) => s + i.events, 0))} sub={`in ${period}`} />
                <Stat label="Crashes" value={n(e.issues.filter((i) => i.unhandled).length)} sub="unhandled issues" />
              </div>
              <Card>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Issue</th>
                        <th className="num">Events</th>
                        <th className="num">Phones</th>
                        <th>Last seen</th>
                        <th>First seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.issues.map((i) => (
                        <tr key={i.id}>
                          <td>
                            <a href={i.link} target="_blank" rel="noopener noreferrer">
                              {i.title}
                            </a>{' '}
                            {i.unhandled && <Badge tone="bad">crash</Badge>} {i.level && i.level !== 'error' && <Badge>{i.level}</Badge>}
                            <div className="muted small">
                              {i.shortId}
                              {i.culprit ? ` · ${i.culprit}` : ''}
                            </div>
                          </td>
                          <td className="num">{n(i.events)}</td>
                          <td className="num">{n(i.users)}</td>
                          <td>{when(i.lastSeen)}</td>
                          <td>{when(i.firstSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          ) : (
            <Empty>No open errors in this period. 🎉</Empty>
          )
        }
      </Loaded>
    </Page>
  );
}

type Month = { month: string; usd: number; services: { service: string; usd: number }[]; estimated: boolean };
type Costs = { at: number; budgetUsd: number | null; thisMonth: Month; lastMonth: Month | null; forecastMonthUsd: number | null; daily: { day: string; usd: number }[] };

const usd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `$${v.toFixed(v < 10 ? 2 : 0)}`);
const SHORT: Record<string, string> = {
  'Amazon Simple Storage Service': 'S3 storage',
  'Amazon CloudFront': 'CloudFront (CDN)',
  'AWS Lambda': 'Lambda (API)',
  'Amazon DynamoDB': 'DynamoDB (database)',
  'Amazon Elastic Container Service': 'Fargate (video processing)',
  'Amazon Simple Email Service': 'SES (email)',
  'AmazonCloudWatch': 'CloudWatch (logs, metrics)',
  'AWS Key Management Service': 'KMS',
  'Amazon EC2 Container Registry (ECR)': 'ECR (container images)',
  'AWS Cost Explorer': 'Cost Explorer',
  Tax: 'Tax',
};

export function Costs() {
  const [refresh, setRefresh] = useState(0);
  const state = useLoad(() => get<Costs>(`/costs${refresh ? '?refresh=1' : ''}`), [refresh]);
  return (
    <Page
      title="AWS costs"
      actions={
        <>
          {state.data && <span className="muted small">Updated {when(state.data.at)}</span>}
          <button className="btn" disabled={state.loading} onClick={() => setRefresh((r) => r + 1)}>
            Refresh
          </button>
        </>
      }
    >
      <p className="muted small">From AWS Cost Explorer, in US dollars. AWS updates it a few times a day; the latest day is still incomplete.</p>
      <Loaded state={state}>
        {(c) => {
          const over = c.budgetUsd && c.forecastMonthUsd ? c.forecastMonthUsd > c.budgetUsd : false;
          return (
            <>
              <div className="stats">
                <Stat label={`This month (${c.thisMonth.month})`} value={usd(c.thisMonth.usd)} sub="so far" />
                <Stat label="Month-end forecast" value={usd(c.forecastMonthUsd)} sub={c.budgetUsd ? <span className={over ? 'bad-text' : ''}>budget {usd(c.budgetUsd)}</span> : undefined} />
                <Stat label="Last month" value={usd(c.lastMonth?.usd)} sub={c.lastMonth?.month} />
              </div>
              <div className="grid2">
                <Card>
                  <Bars caption={<>Per day (30 days)</>} rows={c.daily.map((d) => ({ label: d.day, value: d.usd }))} format={(v) => usd(v)} />
                </Card>
                <Card title="This month by service">
                  {c.thisMonth.services.length ? (
                    <ul className="breakdown">
                      {c.thisMonth.services.map((s) => (
                        <li key={s.service}>
                          <span className="b-label" title={s.service}>
                            {SHORT[s.service] ?? s.service}
                          </span>
                          <span className="b-track">
                            <span className="b-fill" style={{ width: `${(s.usd / Math.max(0.01, c.thisMonth.services[0].usd)) * 100}%` }} />
                          </span>
                          <span className="b-num">{usd(s.usd)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>No charges yet this month.</Empty>
                  )}
                </Card>
              </div>
            </>
          );
        }}
      </Loaded>
    </Page>
  );
}
