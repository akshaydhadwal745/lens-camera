import { useState } from "react";

import { api, get, post } from "../api";
import {
  Badge,
  Card,
  date,
  Empty,
  Loaded,
  n,
  Page,
  Tabs,
  useLoad,
} from "../ui";

type Fact = {
  id: string;
  area: string;
  label: string;
  value: number | null;
  unit: string;
  window: string;
  previous?: number | null;
  change?: number | null;
};
type Finding = {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  facts: string[];
};
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
  ai?: {
    summary: string;
    findings: Finding[];
    recommendations: Rec[];
    reviewOfPrevious: { id: string; verdict: string; facts: string[] }[];
    seoInvestigations?: Investigation[];
  };
  commit?: string;
  toolCalls?: number;
  aiProblems?: string[];
  aiError?: string;
  model?: string;
};
type Investigation = {
  title: string;
  evidence: "measured" | "likely-cause" | "hypothesis";
  data: string;
  cause: string;
  codeLocations: { file: string; line: number; excerpt: string }[];
  recommendation: string;
  validation: string;
  measurement: string;
  facts: string[];
};
type Proposal = {
  id: string;
  title: string;
  evidence: string;
  files: string[];
  change: string;
  validation: string;
  measurement: string;
  status: string;
  report: string;
  decidedBy?: string;
  note?: string;
};
type Opp = {
  id: string;
  topic: string;
  targetKeyword: string;
  intent: string;
  audience: string;
  lensFeatures: string[];
  relevance: number;
  relevanceReason: string;
  demand: string;
  demandEvidence: string;
  trend: string;
  winnability: string;
  competition: string;
  action: string;
  existingPage: string;
  brief: {
    url: string;
    title: string;
    metaDescription: string;
    h1: string;
    outline: string[];
    questions: string[];
    supportingKeywords: string[];
    internalLinksFrom: string[];
    internalLinksTo: string[];
    searchResultsToday: string;
  };
  businessValue: string;
  measurement: string;
  score: number;
  status: string;
  firstSeen: string;
  lastSeen: string;
  note?: string;
  pr?: { url: string };
};
const ACTION: Record<string, string> = {
  "improve-page": "Improve existing page",
  "new-guide": "New guide",
  "landing-page": "New landing page",
  "faq-and-links": "FAQ + internal links",
  "conversion-fix": "Conversion fix",
  "social-post": "Social post",
  experiment: "Experiment",
};
type Watch = { path: string; reason: string; since: string };
type Activity = {
  at: number;
  tool: string;
  level?: number;
  args: Record<string, unknown>;
  ok: boolean;
  refused?: boolean;
  error?: string;
  ms: number;
  report: string;
};
type GrowthData = {
  dates: string[];
  report: Report | null;
  recommendations: Rec[];
  proposals: Proposal[];
  opportunities?: Opp[];
  watching: Watch[];
  activity: Activity[];
  tools: { available: string[]; enabled: string[] };
  running: { at: number; by: string } | null;
  lastError: { message: string; at: number } | null;
};
const EVIDENCE: Record<
  string,
  { label: string; tone: "good" | "warn" | "plain" }
> = {
  measured: { label: "measured", tone: "good" },
  "likely-cause": { label: "likely cause", tone: "warn" },
  hypothesis: { label: "hypothesis", tone: "plain" },
};
const REPO = "https://github.com/akshaydhadwal745/lens-camera/blob";

const STATUSES = [
  "proposed",
  "approved",
  "shipped",
  "measured",
  "kept",
  "dropped",
];
const AREAS: Record<string, string> = {
  search: "Google search",
  website: "Website",
  app: "App",
  channels: "Install channels",
  money: "Money",
  loops: "Growth loops",
  demand: "Demand and interest",
  ga4: "Google Analytics",
};
const tone = (s: string) =>
  s === "high" ? "bad" : s === "medium" ? "warn" : "plain";

function value(f: Fact, x: number | null | undefined) {
  if (x === null || x === undefined) return "—";
  if (f.unit === "pct") return `${Math.round(x * 1000) / 10}%`;
  if (f.unit === "usd") return `$${x.toFixed(2)}`;
  if (f.unit === "gb") return `${x} GB`;
  if (f.unit === "position") return x.toFixed(1);
  return n(x);
}

function FactChips({
  ids,
  facts,
}: {
  ids: string[];
  facts: Map<string, Fact>;
}) {
  return (
    <div className="chips">
      {ids.map((id) => {
        const f = facts.get(id);
        return (
          <span
            key={id}
            className="chip"
            title={f ? `${f.label} (${f.window})` : "unknown fact"}
          >
            {id}
            {f ? `: ${value(f, f.value)}` : ""}
          </span>
        );
      })}
    </div>
  );
}

export function Growth({ canWrite }: { canWrite: boolean }) {
  const [day, setDay] = useState<string>("");
  const [reload, setReload] = useState(0);
  const [area, setArea] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const state = useLoad(
    () => get<GrowthData>(`/growth${day ? `?date=${day}` : ""}`),
    [day, reload],
  );

  const run = async () => {
    setBusy(true);
    try {
      await post("/growth/run", { ai: true });
      setReload((r) => r + 1);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const decide = async (id: string, decision: "approved" | "rejected") => {
    const note =
      prompt(
        decision === "approved"
          ? "Approve: any note for the change?"
          : "Reject: why? (helps the analyst learn)",
      ) ?? undefined;
    await api("PUT", `/growth/proposals/${encodeURIComponent(id)}`, {
      decision,
      ...(note ? { note } : {}),
    });
    setReload((r) => r + 1);
  };
  const setOpp = async (id: string, status: string) => {
    const note =
      status === "rejected"
        ? (prompt("Why not? (the analyst learns from it)") ?? undefined)
        : undefined;
    await api("PUT", `/growth/opportunities/${encodeURIComponent(id)}`, {
      status,
      ...(note ? { note } : {}),
    });
    setReload((r) => r + 1);
  };
  const setTools = async (enabled: string[]) => {
    await api("PUT", "/growth/tools", { enabled });
    setReload((r) => r + 1);
  };
  const unwatch = async (path: string) => {
    await api("DELETE", "/growth/watch", { path });
    setReload((r) => r + 1);
  };
  const setStatus = async (id: string, status: string) => {
    const note =
      status === "kept" || status === "dropped" || status === "measured"
        ? (prompt("Note (optional): what happened?") ?? undefined)
        : undefined;
    await api("PUT", `/growth/recs/${encodeURIComponent(id)}`, {
      status,
      ...(note ? { note } : {}),
    });
    setReload((r) => r + 1);
  };

  return (
    <Page
      title="Growth"
      actions={
        <>
          {state.data && state.data.dates.length > 1 && (
            <select
              value={day || state.data.report?.date || ""}
              onChange={(e) => setDay(e.target.value)}
            >
              {state.data.dates.map((d) => (
                <option key={d} value={d}>
                  Report of {d}
                </option>
              ))}
            </select>
          )}
          {canWrite && (
            <button
              className="btn"
              disabled={busy || !!state.data?.running}
              onClick={run}
            >
              {state.data?.running
                ? "Running… (a few minutes)"
                : busy
                  ? "Starting…"
                  : "Run report now"}
            </button>
          )}
        </>
      }
    >
      <p className="muted small">
        Weekly, Mondays 08:00 IST. Numbers are computed by code from Search
        Console, the website, the app and payments; the AI analyst only explains
        them, and every number it writes must come from a fact it cites (checked
        automatically). It changes nothing: recommendations wait for you here.
      </p>
      <Loaded state={state}>
        {(g) => {
          const r = g.report;
          const failed =
            g.lastError && (!r || g.lastError.at > r.at) ? (
              <Card title="The last run failed">
                <p className="muted">
                  {date(g.lastError.at)}: {g.lastError.message}. Owners were
                  emailed. Run it again, or wait for Monday.
                </p>
              </Card>
            ) : null;
          if (!r)
            return (
              failed ?? (
                <Empty>
                  No report yet.{" "}
                  {canWrite
                    ? "Press “Run report now”, or wait for Monday."
                    : "The first one arrives on Monday."}
                </Empty>
              )
            );
          const facts = new Map(r.facts.map((f) => [f.id, f]));
          const areas = ["all", ...new Set(r.facts.map((f) => f.area))];
          return (
            <>
              {failed}
              <p className="muted small">
                Report of {r.date} · made {date(r.at)} by {r.by}
                {r.model ? ` · analyst ${r.model}` : ""}
              </p>

              {r.ai ? (
                <Card title="Summary">
                  <p>{r.ai.summary}</p>
                  {r.aiProblems && (
                    <p className="small">
                      <Badge tone="warn">Check</Badge> Some numbers in this
                      report could not be matched to a cited fact:{" "}
                      {r.aiProblems.join("; ")}
                    </p>
                  )}
                </Card>
              ) : (
                <Card title="Summary">
                  <p className="muted">
                    The AI analysis didn’t run for this report
                    {r.aiError ? `: ${r.aiError}` : ""}. The rule-based findings
                    below still apply.
                  </p>
                </Card>
              )}

              {(r.ai?.seoInvestigations ?? []).length > 0 && (
                <>
                  <div className="row-head">
                    <h2>SEO investigations</h2>
                  </div>
                  {r.ai!.seoInvestigations!.map((x, i) => (
                    <Card key={i} title={x.title}>
                      <p>
                        <Badge tone={EVIDENCE[x.evidence]?.tone ?? "plain"}>
                          {EVIDENCE[x.evidence]?.label ?? x.evidence}
                        </Badge>
                      </p>
                      <dl className="kv">
                        <dt>Data</dt>
                        <dd>{x.data}</dd>
                        <dt>Cause</dt>
                        <dd>{x.cause}</dd>
                        <dt>Code</dt>
                        <dd>
                          {x.codeLocations.length
                            ? x.codeLocations.map((l, k) => (
                                <div key={k} className="small">
                                  <a
                                    href={`${REPO}/${r.commit ?? "main"}/${l.file}#L${l.line}`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {l.file}:{l.line}
                                  </a>{" "}
                                  <code>{l.excerpt}</code>
                                </div>
                              ))
                            : "—"}
                        </dd>
                        <dt>Recommendation</dt>
                        <dd>{x.recommendation}</dd>
                        <dt>Validate</dt>
                        <dd>{x.validation}</dd>
                        <dt>Measure</dt>
                        <dd>{x.measurement}</dd>
                      </dl>
                      <FactChips ids={x.facts} facts={facts} />
                    </Card>
                  ))}
                </>
              )}

              {g.proposals.some((p) => p.status === "proposed") && (
                <>
                  <div className="row-head">
                    <h2>Changes waiting for your approval</h2>
                  </div>
                  {g.proposals
                    .filter((p) => p.status === "proposed")
                    .map((p) => (
                      <Card key={p.id} title={p.title}>
                        <dl className="kv">
                          <dt>Evidence</dt>
                          <dd>{p.evidence}</dd>
                          <dt>Files</dt>
                          <dd className="small">{p.files.join(", ")}</dd>
                          <dt>Change</dt>
                          <dd>{p.change}</dd>
                          <dt>Validate</dt>
                          <dd>{p.validation}</dd>
                          <dt>Measure</dt>
                          <dd>{p.measurement}</dd>
                        </dl>
                        {canWrite && (
                          <div className="actions">
                            <button
                              className="btn"
                              onClick={() => void decide(p.id, "approved")}
                            >
                              Approve
                            </button>{" "}
                            <button
                              className="btn ghost"
                              onClick={() => void decide(p.id, "rejected")}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        <p className="muted small">
                          Approving records your decision; the change is made as
                          a pull request you review and merge (nothing changes
                          on the site by itself).
                        </p>
                      </Card>
                    ))}
                </>
              )}

              {!!g.opportunities?.length && (
                <>
                  <div className="row-head">
                    <h2>Content opportunities</h2>
                  </div>
                  <p className="muted small">
                    What people are interested in that Lens genuinely helps
                    with, ranked by score = relevance × demand × trend ×
                    winnability. Demand sources differ (Bing searches, Wikipedia
                    interest, our Search Console and website); each brief says
                    which. Plan one to have it written as a pull request you
                    review.
                  </p>
                  {g.opportunities
                    .filter((o) => o.status !== "rejected")
                    .map((o) => (
                      <Card
                        key={o.id}
                        title={`${o.score} · ${o.brief.title || o.topic}`}
                      >
                        <p className="small">
                          <span className="chip">{o.status}</span>{" "}
                          <span className="chip">
                            {ACTION[o.action] ?? o.action}
                          </span>{" "}
                          <span className="chip">“{o.targetKeyword}”</span>{" "}
                          <span className="chip">
                            relevance {o.relevance}/3 · demand {o.demand} ·{" "}
                            {o.trend} · winnable {o.winnability}
                          </span>
                          {o.pr?.url && (
                            <>
                              {" "}
                              <a
                                href={o.pr.url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                pull request
                              </a>
                            </>
                          )}
                        </p>
                        <details>
                          <summary>Brief and evidence</summary>
                          <dl className="kv">
                            <dt>Who and why</dt>
                            <dd>
                              {o.audience} {o.relevanceReason}
                            </dd>
                            <dt>Demand</dt>
                            <dd>{o.demandEvidence}</dd>
                            <dt>Competition</dt>
                            <dd>{o.competition}</dd>
                            <dt>Lens features</dt>
                            <dd>{o.lensFeatures.join(", ")}</dd>
                            <dt>Page</dt>
                            <dd>
                              {o.existingPage
                                ? `Improve ${o.existingPage}`
                                : o.brief.url}
                            </dd>
                            <dt>Title</dt>
                            <dd>{o.brief.title}</dd>
                            <dt>Description</dt>
                            <dd>{o.brief.metaDescription}</dd>
                            <dt>H1</dt>
                            <dd>{o.brief.h1}</dd>
                            <dt>Outline</dt>
                            <dd>
                              <ol>
                                {o.brief.outline.map((h) => (
                                  <li key={h}>{h}</li>
                                ))}
                              </ol>
                            </dd>
                            <dt>Questions</dt>
                            <dd>{o.brief.questions.join(" · ")}</dd>
                            <dt>Keywords</dt>
                            <dd>{o.brief.supportingKeywords.join(", ")}</dd>
                            <dt>Links</dt>
                            <dd className="small">
                              from {o.brief.internalLinksFrom.join(", ") || "—"}
                              ; to {o.brief.internalLinksTo.join(", ") || "—"}
                            </dd>
                            <dt>Ranks today</dt>
                            <dd>{o.brief.searchResultsToday}</dd>
                            <dt>Value</dt>
                            <dd>{o.businessValue}</dd>
                            <dt>Measure</dt>
                            <dd>{o.measurement}</dd>
                          </dl>
                        </details>
                        {canWrite && (
                          <div className="actions">
                            {o.status === "idea" && (
                              <button
                                className="btn"
                                onClick={() => void setOpp(o.id, "planned")}
                              >
                                Plan it
                              </button>
                            )}{" "}
                            {o.status === "pr-open" && (
                              <button
                                className="btn"
                                onClick={() => void setOpp(o.id, "published")}
                              >
                                Mark published
                              </button>
                            )}{" "}
                            {o.status !== "rejected" && (
                              <button
                                className="btn ghost"
                                onClick={() => void setOpp(o.id, "rejected")}
                              >
                                Not for us
                              </button>
                            )}
                          </div>
                        )}
                      </Card>
                    ))}
                </>
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
                      <Badge tone={tone(x.severity)}>{x.severity}</Badge>{" "}
                      <strong>{x.title}</strong>
                      <div className="small">{x.detail}</div>
                      <FactChips ids={x.facts} facts={facts} />
                    </li>
                  ))}
                </ul>
                {r.notes?.length ? (
                  <p className="muted small">{r.notes.join(" ")}</p>
                ) : null}
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
                              {x.note ? (
                                <div className="muted small">{x.note}</div>
                              ) : null}
                            </td>
                            <td className="small">{x.metric}</td>
                            <td>
                              {canWrite ? (
                                <select
                                  value={x.status}
                                  onChange={(e) =>
                                    void setStatus(x.id!, e.target.value)
                                  }
                                >
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
                <p className="muted small">
                  Move each one along as it happens: approved → shipped →
                  measured → kept or dropped. The analyst reviews shipped ones
                  every week.
                </p>
              </Card>

              <div className="grid2">
                <Card title="Watched pages">
                  {g.watching.length ? (
                    <ul className="list">
                      {g.watching.map((w) => (
                        <li key={w.path}>
                          <strong>{w.path}</strong>{" "}
                          <span className="muted small">since {w.since}</span>
                          <div className="small">{w.reason}</div>
                          {canWrite && (
                            <button
                              className="btn ghost small"
                              onClick={() => void unwatch(w.path)}
                            >
                              Stop watching
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty>
                      No watched pages yet. The analyst adds pages it recommends
                      changing; their numbers appear in the facts below.
                    </Empty>
                  )}
                </Card>
                <Card title="Analyst tools">
                  <p className="small muted">
                    Read-only tools (Search Console data, URL inspection, page
                    audits, the website code) are always on. Proposals never
                    change anything without your approval.
                  </p>
                  {g.tools.available.map((t) => (
                    <label key={t} className="small">
                      <input
                        type="checkbox"
                        disabled={!canWrite}
                        checked={g.tools.enabled.includes(t)}
                        onChange={(e) =>
                          void setTools(
                            e.target.checked
                              ? [...g.tools.enabled, t]
                              : g.tools.enabled.filter((x) => x !== t),
                          )
                        }
                      />{" "}
                      {t === "submit_sitemap"
                        ? "Allow resubmitting the sitemap to Google (level 2, reversible)"
                        : t}
                    </label>
                  ))}
                </Card>
              </div>

              <Card
                title={`Tool activity${r.toolCalls !== undefined ? ` (this report: ${r.toolCalls} calls${r.commit ? `, code at ${r.commit.slice(0, 7)}` : ""})` : ""}`}
              >
                {g.activity.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>When</th>
                          <th>Tool</th>
                          <th>Level</th>
                          <th>Input</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.activity.map((a, i) => (
                          <tr key={i}>
                            <td className="nowrap small">{date(a.at)}</td>
                            <td>{a.tool}</td>
                            <td className="num">{a.level ?? ""}</td>
                            <td className="small">
                              {JSON.stringify(a.args).slice(0, 90)}
                            </td>
                            <td className="small">
                              {a.ok ? (
                                <Badge tone="good">ok</Badge>
                              ) : (
                                <Badge tone={a.refused ? "warn" : "bad"}>
                                  {a.refused ? "refused" : "error"}
                                </Badge>
                              )}{" "}
                              {a.error ?? ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>No tool calls yet.</Empty>
                )}
              </Card>

              <div className="row-head">
                <h2>Facts</h2>
                <Tabs
                  value={area}
                  onChange={setArea}
                  options={areas.map((a) => ({
                    value: a,
                    label: a === "all" ? "All" : (AREAS[a] ?? a),
                  }))}
                />
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
                        .filter((f) => area === "all" || f.area === area)
                        .map((f) => (
                          <tr key={f.id} title={f.id}>
                            <td>{f.label}</td>
                            <td className="num">{value(f, f.value)}</td>
                            <td className="num">
                              {f.previous !== undefined
                                ? value(f, f.previous)
                                : ""}
                            </td>
                            <td className="num">
                              {f.change === null || f.change === undefined
                                ? ""
                                : `${f.change > 0 ? "+" : ""}${Math.round(f.change * 100)}%`}
                            </td>
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
