import { useState } from 'react';

import { api, get, post } from '../api';
import { Badge, Card, date, Empty, Loaded, n, Page, Tabs, useLoad } from '../ui';

type Fact = { id: string; area: string; label: string; value: number | null; unit: string; window: string; previous?: number | null; change?: number | null };
type Finding = { severity: 'high' | 'medium' | 'low'; title: string; detail: string; facts: string[] };
type Rec = {
  id?: string;
  title: string;
  hypothesis: string;
  expectedImpact: string;
  effort: string;
  cost: string;
  timeToResult: string;
  risk: string;
  metric: string;
  stopRule: string;
  facts: string[];
  status?: string;
  note?: string;
  report?: string;
};
type Report = {
  date: string;
  at: number;
  by: string;
  facts: Fact[];
  rules: Finding[];
  notes?: string[];
  ai?: { summary: string; findings: Finding[]; recommendations: Rec[]; reviewOfPrevious: { id: string; verdict: string; facts: string[] }[] };
  aiProblems?: string[];
  aiError?: string;
  model?: string;
};
type GrowthData = { dates: string[]; report: Report | null; recommendations: Rec[]; running: { at: number; by: string } | null };

const STATUSES = ['proposed', 'approved', 'shipped', 'measured', 'kept', 'dropped'];
const AREAS: Record<string, string> = { search: 'Google search', website: 'Website', app: 'App', channels: 'Install channels', money: 'Money', loops: 'Growth loops' };
const tone = (s: string) => (s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'plain');

function value(f: Fact, x: number | null | undefined) {
  if (x === null || x === undefined) return '—';
  if (f.unit === 'pct') return `${Math.round(x * 1000) / 10}%`;
  if (f.unit === 'usd') return `$${x.toFixed(2)}`;
  if (f.unit === 'gb') return `${x} GB`;
  if (f.unit === 'position') return x.toFixed(1);
  return n(x);
}

function FactChips({ ids, facts }: { ids: string[]; facts: Map<string, Fact> }) {
  return (
    <div className="chips">
      {ids.map((id) => {
        const f = facts.get(id);
        return (
          <span key={id} className="chip" title={f ? `${f.label} (${f.window})` : 'unknown fact'}>
            {id}
            {f ? `: ${value(f, f.value)}` : ''}
          </span>
        );
      })}
    </div>
  );
}

export function Growth({ canWrite }: { canWrite: boolean }) {
  const [day, setDay] = useState<string>('');
  const [reload, setReload] = useState(0);
  const [area, setArea] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const state = useLoad(() => get<GrowthData>(`/growth${day ? `?date=${day}` : ''}`), [day, reload]);

  const run = async () => {
    setBusy(true);
    try {
      await post('/growth/run', { ai: true });
      setReload((r) => r + 1);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (id: string, status: string) => {
    const note = status === 'kept' || status === 'dropped' || status === 'measured' ? (prompt('Note (optional): what happened?') ?? undefined) : undefined;
    await api('PUT', `/growth/recs/${encodeURIComponent(id)}`, { status, ...(note ? { note } : {}) });
    setReload((r) => r + 1);
  };

  return (
    <Page
      title="Growth"
      actions={
        <>
          {state.data && state.data.dates.length > 1 && (
            <select value={day || state.data.report?.date || ''} onChange={(e) => setDay(e.target.value)}>
              {state.data.dates.map((d) => (
                <option key={d} value={d}>
                  Report of {d}
                </option>
              ))}
            </select>
          )}
          {canWrite && (
            <button className="btn" disabled={busy || !!state.data?.running} onClick={run}>
              {state.data?.running ? 'Running… (a few minutes)' : busy ? 'Starting…' : 'Run report now'}
            </button>
          )}
        </>
      }
    >
      <p className="muted small">
        Weekly, Mondays 08:00 IST. Numbers are computed by code from Search Console, the website, the app and payments; the AI analyst only explains them, and every number it writes must come from a fact it cites (checked automatically). It changes nothing: recommendations wait for you here.
      </p>
      <Loaded state={state}>
        {(g) => {
          const r = g.report;
          if (!r) return <Empty>No report yet. {canWrite ? 'Press “Run report now”, or wait for Monday.' : 'The first one arrives on Monday.'}</Empty>;
          const facts = new Map(r.facts.map((f) => [f.id, f]));
          const areas = ['all', ...new Set(r.facts.map((f) => f.area))];
          return (
            <>
              <p className="muted small">
                Report of {r.date} · made {date(r.at)} by {r.by}
                {r.model ? ` · analyst ${r.model}` : ''}
              </p>

              {r.ai ? (
                <Card title="Summary">
                  <p>{r.ai.summary}</p>
                  {r.aiProblems && (
                    <p className="small">
                      <Badge tone="warn">Check</Badge> Some numbers in this report could not be matched to a cited fact: {r.aiProblems.join('; ')}
                    </p>
                  )}
                </Card>
              ) : (
                <Card title="Summary">
                  <p className="muted">The AI analysis didn’t run for this report{r.aiError ? `: ${r.aiError}` : ''}. The rule-based findings below still apply.</p>
                </Card>
              )}

              {r.ai && r.ai.recommendations.length > 0 && (
                <>
                  <div className="row-head">
                    <h2>Recommended experiments</h2>
                  </div>
                  {r.ai.recommendations.map((x, i) => (
                    <Card key={i} title={`${i + 1}. ${x.title}`}>
                      <dl className="kv">
                        <dt>Hypothesis</dt>
                        <dd>{x.hypothesis}</dd>
                        <dt>Expected impact</dt>
                        <dd>{x.expectedImpact}</dd>
                        <dt>Effort · cost · time</dt>
                        <dd>
                          {x.effort} · {x.cost} · {x.timeToResult}
                        </dd>
                        <dt>Risk</dt>
                        <dd>{x.risk}</dd>
                        <dt>Measure</dt>
                        <dd>{x.metric}</dd>
                        <dt>Stop if</dt>
                        <dd>{x.stopRule}</dd>
                      </dl>
                      <FactChips ids={x.facts} facts={facts} />
                    </Card>
                  ))}
                </>
              )}

              <div className="row-head">
                <h2>Findings</h2>
              </div>
              <Card>
                <ul className="list">
                  {[...(r.ai?.findings ?? []), ...r.rules].map((x, i) => (
                    <li key={i}>
                      <Badge tone={tone(x.severity)}>{x.severity}</Badge> <strong>{x.title}</strong>
                      <div className="small">{x.detail}</div>
                      <FactChips ids={x.facts} facts={facts} />
                    </li>
                  ))}
                </ul>
                {r.notes?.length ? <p className="muted small">{r.notes.join(' ')}</p> : null}
              </Card>

              {r.ai && r.ai.reviewOfPrevious.length > 0 && (
                <Card title="Did earlier recommendations work?">
                  <ul className="list">
                    {r.ai.reviewOfPrevious.map((x) => (
                      <li key={x.id}>
                        <strong>{x.id}</strong>: {x.verdict}
                        <FactChips ids={x.facts} facts={facts} />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <div className="row-head">
                <h2>Recommendation ledger</h2>
              </div>
              <Card>
                {g.recommendations.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Id</th>
                          <th>Recommendation</th>
                          <th>Measure</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.recommendations.map((x) => (
                          <tr key={x.id}>
                            <td className="nowrap">{x.id}</td>
                            <td>
                              {x.title}
                              {x.note ? <div className="muted small">{x.note}</div> : null}
                            </td>
                            <td className="small">{x.metric}</td>
                            <td>
                              {canWrite ? (
                                <select value={x.status} onChange={(e) => void setStatus(x.id!, e.target.value)}>
                                  {STATUSES.map((s) => (
                                    <option key={s}>{s}</option>
                                  ))}
                                </select>
                              ) : (
                                <Badge>{x.status}</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>No recommendations yet.</Empty>
                )}
                <p className="muted small">Move each one along as it happens: approved → shipped → measured → kept or dropped. The analyst reviews shipped ones every week.</p>
              </Card>

              <div className="row-head">
                <h2>Facts</h2>
                <Tabs value={area} onChange={setArea} options={areas.map((a) => ({ value: a, label: a === 'all' ? 'All' : (AREAS[a] ?? a) }))} />
              </div>
              <Card>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Fact</th>
                        <th className="num">Now</th>
                        <th className="num">Before</th>
                        <th className="num">Change</th>
                        <th>Window</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.facts
                        .filter((f) => area === 'all' || f.area === area)
                        .map((f) => (
                          <tr key={f.id} title={f.id}>
                            <td>{f.label}</td>
                            <td className="num">{value(f, f.value)}</td>
                            <td className="num">{f.previous !== undefined ? value(f, f.previous) : ''}</td>
                            <td className="num">{f.change === null || f.change === undefined ? '' : `${f.change > 0 ? '+' : ''}${Math.round(f.change * 100)}%`}</td>
                            <td className="muted small">{f.window}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          );
        }}
      </Loaded>
    </Page>
  );
}
