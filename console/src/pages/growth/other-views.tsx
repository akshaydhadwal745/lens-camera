// Insights (the agent's weekly analysis), Growth settings and Start here.
import { useState } from "react";

import { api, get } from "../../api";
import { Card, date, Empty, Link, Loaded, useLoad } from "../../ui";
import {
  can,
  Chip,
  fmt,
  GoalChip,
  openTask,
  Person,
  TaskRow,
  WS,
  type Workspace,
  type Workstream,
  Prose,
} from "./shared";
import { analystButton, useGrowthReload, useJobs } from "./jobs";

type ReportPage = {
  dates: string[];
  report: {
    date: string;
    at: number;
    by: string;
    model?: string;
    facts: {
      id: string;
      area: string;
      label: string;
      value: number | null;
      unit: string;
      window: string;
    }[];
    notes?: string[];
    ai?: {
      summary: string;
      findings: { severity: string; title: string; detail: string }[];
      seoInvestigations?: {
        title: string;
        evidence: string;
        data: string;
        cause: string;
        recommendation: string;
        codeLocations: { file: string; line: number; excerpt: string }[];
      }[];
      reviewOfPrevious: { id: string; verdict: string }[];
    };
    aiError?: string;
    aiProblems?: string[];
    commit?: string;
  } | null;
  activity: {
    at: number;
    tool: string;
    level?: number;
    ok: boolean;
    refused?: boolean;
    error?: string;
    report: string;
  }[];
  tools: { available: string[]; enabled: string[] };
  running: { at: number; by: string } | null;
  lastError: { message: string; at: number } | null;
};
const REPO = "https://github.com/akshaydhadwal745/lens-camera/blob";

export function Insights({
  ws,
  onChanged,
}: {
  ws: Workspace;
  onChanged: () => void;
}) {
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const { jobs, refresh } = useJobs();
  const reloadKey = useGrowthReload();
  const state = useLoad(
    () => get<ReportPage>(`/growth${day ? `?date=${day}` : ""}`),
    [day, reloadKey],
  );
  const runBtn = analystButton(
    jobs,
    (a) => a.kind === "report",
    "Run analysis now",
    "Analysis running…",
  );
  const manage = can(ws, "growth.write");
  const suggested = ws.tasks.filter((t) => t.status === "suggested");
  const run = async () => {
    setBusy(true);
    try {
      await api("POST", "/growth/run", { ai: true });
      refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const triage = async (id: string, accept: boolean) => {
    const t = ws.tasks.find((x) => x.id === id)!;
    if (!accept) return openTask(id); // dismissing needs a reason: the panel asks for it
    await api("PATCH", `/growth/tasks/${id}`, {
      status: "ready",
      owner: t.owner || ws.settings.wsOwners[t.workstream] || ws.me.email,
    }).catch((e: Error) => alert(e.message));
    onChanged();
  };
  return (
    <Loaded state={state}>
      {(g) => {
        const r = g.report;
        return (
          <>
            <div className="gw-row">
              <p className="muted small" style={{ margin: 0 }}>
                {r
                  ? `Analysis of ${r.date} · ${date(r.at)} by ${r.by}${r.model ? ` · ${r.model}` : ""}.`
                  : "No analysis yet."}{" "}
                Every number in it is checked against the data before it's
                shown. Weekly, Mondays 08:00 IST.
              </p>
              <div className="btns">
                {g.dates.length > 1 && (
                  <select
                    value={day || r?.date || ""}
                    onChange={(e) => setDay(e.target.value)}
                    aria-label="Analysis date"
                  >
                    {g.dates.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                )}
                {manage && (
                  <button
                    className="btn primary"
                    disabled={busy || runBtn.disabled}
                    onClick={() => void run()}
                  >
                    {runBtn.label}
                  </button>
                )}
              </div>
            </div>
            {g.lastError && (!r || g.lastError.at > r.at) && (
              <div className="notice error">
                The last run failed ({date(g.lastError.at)}):{" "}
                {g.lastError.message}
              </div>
            )}
            <Card title="This week in one paragraph">
              {r?.ai ? (
                <Prose text={r.ai.summary} />
              ) : (
                <p className="muted">
                  The AI analysis didn't run{r?.aiError ? `: ${r.aiError}` : ""}
                  . Rule-based findings still apply.
                </p>
              )}
              {r?.aiProblems?.length ? (
                <p className="muted small">
                  Some numbers failed the check, so its suggestions were held
                  back: {r.aiProblems.join("; ")}
                </p>
              ) : null}
            </Card>
            <Card title={`Suggestions to triage (${suggested.length})`}>
              {suggested.length ? (
                suggested.map((t) => (
                  <div key={t.id} className="gw-triage">
                    <TaskRow t={t} />
                    {manage && (
                      <div className="btns">
                        <button
                          className="btn primary small"
                          onClick={() => void triage(t.id, true)}
                        >
                          Accept
                        </button>
                        <button
                          className="btn small"
                          onClick={() => void triage(t.id, false)}
                        >
                          Dismiss…
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <Empty>All suggestions are triaged.</Empty>
              )}
            </Card>
            <div className="grid2">
              <Card title="Findings">
                <ul className="gw-list">
                  {(r?.ai?.findings ?? []).map((x, i) => (
                    <li key={i}>
                      <Chip
                        tone={
                          x.severity === "high"
                            ? "bad"
                            : x.severity === "medium"
                              ? "warn"
                              : "plain"
                        }
                      >
                        {x.severity}
                      </Chip>{" "}
                      <strong>{x.title}</strong>
                      <div className="small">{x.detail}</div>
                    </li>
                  ))}
                </ul>
              </Card>
              <Card title="Did earlier work pay off?">
                <ul className="gw-list">
                  {(r?.ai?.reviewOfPrevious ?? [])
                    .filter((x) => x.id.startsWith("T-"))
                    .map((x) => (
                      <li key={x.id}>
                        {x.id.startsWith("T-") ? (
                          <button
                            className="gw-linkbtn"
                            onClick={() => openTask(x.id)}
                          >
                            {x.id}
                          </button>
                        ) : (
                          x.id
                        )}
                        : {x.verdict}
                      </li>
                    ))}
                  {!(r?.ai?.reviewOfPrevious ?? []).some((x) =>
                    x.id.startsWith("T-"),
                  ) && (
                    <li className="muted">
                      From the next analysis, the agent judges finished tasks
                      here (with links).
                    </li>
                  )}
                </ul>
              </Card>
            </div>
            {(r?.ai?.seoInvestigations ?? []).length > 0 && (
              <Card title="SEO investigations (down to the code)">
                {r!.ai!.seoInvestigations!.map((x, i) => (
                  <details key={i} className="gw-details">
                    <summary>
                      <Chip
                        tone={
                          x.evidence === "measured"
                            ? "good"
                            : x.evidence === "likely-cause"
                              ? "warn"
                              : "plain"
                        }
                      >
                        {x.evidence}
                      </Chip>{" "}
                      {x.title}
                    </summary>
                    <p className="small">
                      <strong>Data:</strong> {x.data}
                    </p>
                    <p className="small">
                      <strong>Cause:</strong> {x.cause}
                    </p>
                    <p className="small">
                      <strong>Recommendation:</strong> {x.recommendation}
                    </p>
                    {x.codeLocations.map((c, j) => (
                      <div key={j} className="small">
                        <a
                          href={`${REPO}/${r!.commit ?? "main"}/${c.file}#L${c.line}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {c.file}:{c.line}
                        </a>{" "}
                        <code>{c.excerpt.slice(0, 120)}</code>
                      </div>
                    ))}
                  </details>
                ))}
              </Card>
            )}
            <div className="grid2">
              <Card title="Data health">
                <ul className="gw-list">
                  {(r?.notes ?? []).map((n, i) => (
                    <li key={i} className="gw-warn">
                      {n}
                    </li>
                  ))}
                  <li>
                    Sources: Search Console, GA4, Bing keywords, Wikipedia,
                    Google Trending now, app and website analytics.
                  </li>
                  <li className="muted">
                    Waiting for access: Play Console reports (install and
                    listing data), Google Trends API (alpha applied 30 Oct).
                  </li>
                </ul>
              </Card>
              <Card title="All metrics this week">
                <details>
                  <summary>
                    {r?.facts.length ?? 0} metrics, computed by code
                  </summary>
                  <div className="table-wrap">
                    <table>
                      <tbody>
                        {(r?.facts ?? []).map((x) => (
                          <tr key={x.id}>
                            <td className="small">{x.label}</td>
                            <td className="num">{fmt(x.value, x.unit)}</td>
                            <td className="muted small">{x.window}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </Card>
            </div>
            {manage && (
              <Card title="What the agent did (tool activity)">
                <details>
                  <summary>{g.activity.length} recent tool calls</summary>
                  <div className="table-wrap">
                    <table>
                      <tbody>
                        {g.activity.map((a, i) => (
                          <tr key={i}>
                            <td className="muted small">{date(a.at)}</td>
                            <td>{a.tool}</td>
                            <td className="small">level {a.level ?? "—"}</td>
                            <td>
                              {a.refused ? (
                                <Chip tone="bad">refused</Chip>
                              ) : a.ok ? (
                                <Chip tone="good">ok</Chip>
                              ) : (
                                <Chip tone="warn">error</Chip>
                              )}
                            </td>
                            <td className="muted small">{a.report}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </Card>
            )}
          </>
        );
      }}
    </Loaded>
  );
}

export function GrowthSettings({
  ws,
  onChanged,
}: {
  ws: Workspace;
  onChanged: () => void;
}) {
  const manage = can(ws, "growth.write");
  const [s, setS] = useState({
    focus: ws.settings.focus.text,
    reviewOn: ws.settings.focus.reviewOn,
    launchDate: ws.settings.launchDate,
    northStar: ws.settings.northStar,
    wsOwners: { ...ws.settings.wsOwners },
  });
  const [msg, setMsg] = useState("");
  const tools = useLoad(() => get<ReportPage>("/growth"), []);
  const save = async () => {
    try {
      await api("PUT", "/growth/settings", {
        focus: { text: s.focus, reviewOn: s.reviewOn },
        launchDate: s.launchDate,
        northStar: s.northStar,
        wsOwners: s.wsOwners,
      });
      setMsg("Saved.");
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const counts = ws.facts.filter(
    (f) =>
      f.unit === "count" &&
      (f.area === "app" || f.area === "website" || f.area === "search"),
  );
  return (
    <>
      <div className="grid2">
        <Card title="Direction">
          <div className="gw-form">
            <label className="gw-field">
              <span>This month's focus (one sentence everyone can repeat)</span>
              <textarea
                rows={2}
                value={s.focus}
                onChange={(e) => setS({ ...s, focus: e.target.value })}
                disabled={!manage}
              />
            </label>
            <div className="gw-form-row">
              <label className="gw-field">
                <span>Review the focus on</span>
                <input
                  type="date"
                  value={s.reviewOn}
                  onChange={(e) => setS({ ...s, reviewOn: e.target.value })}
                  disabled={!manage}
                />
              </label>
              <label className="gw-field">
                <span>Play production launch date</span>
                <input
                  type="date"
                  value={s.launchDate}
                  onChange={(e) => setS({ ...s, launchDate: e.target.value })}
                  disabled={!manage}
                />
              </label>
            </div>
            <label className="gw-field">
              <span>North-star metric</span>
              <select
                value={s.northStar}
                onChange={(e) => setS({ ...s, northStar: e.target.value })}
                disabled={!manage}
              >
                {counts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Card>
        <Card title="Workstream owners (new tasks and accepted suggestions go to them)">
          <div className="gw-form">
            {(Object.keys(WS) as Workstream[]).map((k) => (
              <label key={k} className="gw-field gw-inline">
                <span>{WS[k].label}</span>
                <select
                  value={s.wsOwners[k] ?? ""}
                  onChange={(e) =>
                    setS({
                      ...s,
                      wsOwners: { ...s.wsOwners, [k]: e.target.value },
                    })
                  }
                  disabled={!manage}
                >
                  <option value="">Nobody</option>
                  <option value="agent">Growth agent</option>
                  {ws.team.map((m) => (
                    <option key={m.email}>{m.email}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Card>
      </div>
      {manage && (
        <div className="btns">
          <button className="btn primary" onClick={() => void save()}>
            Save settings
          </button>
          <span className="muted small">{msg}</span>
        </div>
      )}
      <div className="grid2">
        <Card title="Team">
          <ul className="gw-list">
            {ws.team.map((m) => (
              <li key={m.email}>
                <Person email={m.email} />{" "}
                <span className="muted small">
                  · {m.role.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
          <p className="small">
            Add people in <Link to="/team">Team</Link>:{" "}
            <strong>growth lead</strong> (goals, triage, assigning, agent
            drafts) or <strong>growth contributor</strong> (works on their
            tasks, creates tasks, comments).
          </p>
        </Card>
        <Card title="What the agent may do">
          <ul className="gw-list">
            <li>
              <Chip tone="good">always</Chip> Read Search Console, GA4, Bing
              keywords, Wikipedia, Trending now and the website code; suggest
              tasks with evidence.
            </li>
            <li>
              <Chip tone="good">after approval</Chip> Draft a website change as
              a pull request on an agent/* branch. It can't merge: main needs
              your approval.
            </li>
            <li>
              <Chip tone="bad">never</Chip> Merge, deploy, publish posts, spend
              money or contact anyone.
            </li>
          </ul>
          <Loaded state={tools}>
            {(g) => (
              <div className="small">
                Optional (level 2):{" "}
                {g.tools.available.map((t) => (
                  <label key={t} style={{ marginRight: 12 }}>
                    <input
                      type="checkbox"
                      disabled={!manage}
                      checked={g.tools.enabled.includes(t)}
                      onChange={(e) =>
                        void api("PUT", "/growth/tools", {
                          enabled: e.target.checked
                            ? [...g.tools.enabled, t]
                            : g.tools.enabled.filter((x) => x !== t),
                        }).then(tools.reload)
                      }
                    />{" "}
                    {t === "submit_sitemap"
                      ? "Resubmit the sitemap to Google"
                      : t}
                  </label>
                ))}
              </div>
            )}
          </Loaded>
          <p className="small">
            What it may claim about Lens:{" "}
            <a
              href="https://github.com/akshaydhadwal745/lens-camera/blob/main/docs/growth/product-facts.md"
              target="_blank"
              rel="noreferrer"
            >
              product facts
            </a>
            .
          </p>
        </Card>
      </div>
    </>
  );
}

export function StartHere({ ws }: { ws: Workspace }) {
  const me = ws.me.email;
  const myWs = (Object.keys(WS) as Workstream[]).filter(
    (k) => ws.settings.wsOwners[k] === me,
  );
  const mine = ws.tasks.filter(
    (t) =>
      t.owner === me &&
      ["ready", "in_progress", "in_review", "blocked"].includes(t.status),
  );
  const role = ws.me.role;
  return (
    <>
      <Card title="What we're building">
        <p>
          <strong>Lens</strong> is a camera app that backs up every photo and
          video in full quality, so people's phones never fill up, and lets
          anyone share full-quality photos and collect event photos from guests
          with a QR code. Our ambition: a large, loved and profitable product
          with millions of engaged users.
        </p>
        <p>
          <strong>The one number:</strong>{" "}
          {ws.northStar.label.replace(/ \(north star.*\)$/, "")}, now{" "}
          <strong>{fmt(ws.northStar.value, "count")}</strong>. It counts people
          who actually use Lens for what it's for, so it can't be gamed with
          installs alone.
        </p>
        {ws.settings.focus.text && (
          <p>
            <strong>This month:</strong> {ws.settings.focus.text}
          </p>
        )}
      </Card>
      <div className="grid2">
        <Card title="Our goals">
          <ul className="gw-list">
            {ws.goals.map((g) => (
              <li key={g.id}>
                <strong>{g.title}</strong> <GoalChip g={g} />
                <div className="muted small">
                  {g.krs
                    .map(
                      (k) =>
                        `${k.label}: ${fmt(k.current, k.unit)} of ${fmt(k.target, k.unit)}`,
                    )
                    .join(" · ")}
                </div>
              </li>
            ))}
          </ul>
          <Link to="/growth/goals">The full roadmap →</Link>
        </Card>
        <Card title="You">
          <p>
            You're signed in as <strong>{me}</strong>, role{" "}
            <strong>{role.replace("_", " ")}</strong>.{" "}
            {role === "growth_contributor"
              ? "You work on tasks assigned to you, create tasks and comment. Your growth lead triages and assigns."
              : can(ws, "growth.write")
                ? "You can set goals, triage the agent’s suggestions, assign work and ask the agent to draft changes."
                : "You can see everything here."}
          </p>
          {myWs.length > 0 && (
            <p>You own: {myWs.map((k) => WS[k].label).join(", ")}.</p>
          )}
          <p>
            You have <strong>{mine.length}</strong> open task
            {mine.length === 1 ? "" : "s"}.{" "}
            <Link to="/growth/tasks?view=mine">See them →</Link>
          </p>
        </Card>
      </div>
      <Card title="How this workspace works">
        <ol className="gw-steps">
          <li>
            <strong>Today</strong> shows what needs you: your tasks, decisions,
            reviews, and whether the goals are on track.
          </li>
          <li>
            <strong>Every piece of work is a task</strong>: why it matters (with
            evidence), who owns it, when it's due, and the metric that proves it
            worked. One lifecycle: Suggested → Ready → In progress → In review →
            Done → Measured.
          </li>
          <li>
            <strong>The growth agent</strong> analyses Search Console, GA4,
            demand and our app data every Monday and suggests tasks. Triage them
            in <Link to="/growth/insights">Insights</Link>: accept or dismiss
            with a reason.
          </li>
          <li>
            <strong>For website changes</strong>, press "Ask agent to draft" on
            a task: it opens a pull request. Review, approve and merge it on
            GitHub; nothing ships before that.
          </li>
          <li>
            <strong>Finish with proof</strong> (a link or what shipped). On the
            check date the result is measured against the baseline and written
            back, so we learn what works.
          </li>
          <li>
            <strong>Workstreams</strong> (Search, Social, Website & Play Store,
            Activation, Referrals & events, Partnerships) each show their
            outcome, numbers, work and results.
          </li>
        </ol>
        <p className="small">
          The strategy behind all this:{" "}
          <a
            href="https://github.com/akshaydhadwal745/lens-camera/blob/main/docs/growth/growth-strategy.md"
            target="_blank"
            rel="noreferrer"
          >
            growth strategy
          </a>
          . Questions: comment on any task and @mention someone.
        </p>
      </Card>
      {mine.length > 0 && (
        <Card title="Start with these">
          {mine.slice(0, 5).map((t) => (
            <TaskRow key={t.id} t={t} />
          ))}
        </Card>
      )}
    </>
  );
}

export { openTask };
