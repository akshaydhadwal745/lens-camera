// Today, Goals & roadmap and Tasks.
import { useMemo, useState } from "react";

import { api } from "../../api";
import { Card, Empty, Link, Stat } from "../../ui";
import {
  BOARD,
  can,
  Chip,
  dueSoon,
  fmt,
  GoalChip,
  isOpen,
  isOverdue,
  KRBar,
  openTask,
  Person,
  Pri,
  shortDate,
  Sparkline,
  STATUS,
  StatusChip,
  TaskRow,
  todayStr,
  VERDICT,
  WS,
  type Goal,
  type Task,
  type Workspace,
} from "./shared";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

export function Today({ ws, onNew }: { ws: Workspace; onNew: () => void }) {
  const me = ws.me.email;
  const manage = can(ws, "growth.write");
  // In progress first, then overdue, then due soonest, then priority: what to do today is at the top.
  const rank = (t: Task) =>
    t.status === "in_progress"
      ? 0
      : isOverdue(t)
        ? 1
        : t.status === "in_review" && t.reviewer === me
          ? 2
          : dueSoon(t, 3)
            ? 3
            : 4;
  const mine = ws.tasks
    .filter((t) => isOpen(t) && t.status !== "blocked" && t.owner === me)
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.priority - b.priority ||
        (a.due || "9").localeCompare(b.due || "9"),
    );
  const toReview = ws.tasks.filter(
    (t) => t.status === "in_review" && t.reviewer === me,
  );
  const suggested = ws.tasks.filter((t) => t.status === "suggested");
  const decisions = ws.tasks.filter(
    (t) => isOpen(t) && t.type === "decision" && (t.owner === me || manage),
  );
  const overdue = ws.tasks.filter(isOverdue);
  const unassigned = ws.tasks.filter((t) => t.status === "ready" && !t.owner);
  const wins = ws.tasks
    .filter((t) => t.status === "measured" || t.status === "done")
    .sort(
      (a, b) =>
        (b.measuredAt ?? b.doneAt ?? b.updatedAt) -
        (a.measuredAt ?? a.doneAt ?? a.updatedAt),
    )
    .slice(0, 5);
  const now = ws.goals.filter((g) => g.horizon === "now");
  const notable = ws.facts
    .filter(
      (f) =>
        f.change !== null &&
        f.change !== undefined &&
        Math.abs(f.change) >= 0.5 &&
        Math.max(f.value ?? 0, f.previous ?? 0) >= 3,
    )
    .slice(0, 4);
  const wf = (id: string) => ws.facts.find((f) => f.id === id);
  return (
    <div className="gw-today">
      <div className="gw-hello">
        <div>
          <h2>
            {greeting()}, {me.split("@")[0]}
          </h2>
          {ws.settings.focus.text && (
            <p className="muted">
              This month: <strong>{ws.settings.focus.text}</strong>
            </p>
          )}
        </div>
        <div className="btns">
          {can(ws, "growth.contribute") && (
            <button className="btn" onClick={onNew}>
              + New task
            </button>
          )}
          <Link to="/growth/insights" className="btn primary">
            This week's brief
          </Link>
        </div>
      </div>

      <div className="stats gw-today-stats">
        <Stat
          label="Weekly backup users · north star"
          value={fmt(ws.northStar.value, "count")}
          sub={
            <>
              <Sparkline values={ws.northStar.series.map((s) => s.users)} />
              {ws.northStar.previous !== null
                ? `${fmt(ws.northStar.previous, "count")} the week before`
                : "people who backed up a photo or video in 7 days"}
            </>
          }
        />
        <Stat
          label="Installs, 30 days"
          value={fmt(wf("app.installs")?.value, "count")}
          sub={`${fmt(wf("app.upload_rate")?.value, "pct")} backed up a photo`}
        />
        <Stat
          label="Website visits, 30 days"
          value={fmt(wf("web.visits_30d")?.value, "count")}
          sub={`${fmt(wf("web.get_lens_rate")?.value, "pct")} clicked Get Lens`}
        />
        <Stat
          label="Google: pages indexed"
          value={`${fmt(wf("search.indexed_pages")?.value, "count")} / ${fmt(wf("search.sitemap_pages")?.value, "count")}`}
          sub={`${fmt(wf("search.impressions")?.value, "count")} search impressions in 28 days`}
        />
      </div>

      <div className="grid2 gw-today-work">
        <Card
          title="My work"
          actions={<Link to="/growth/tasks?view=mine">All my tasks →</Link>}
        >
          {mine.length ? (
            mine.slice(0, 6).map((t) => <TaskRow key={t.id} t={t} />)
          ) : (
            <Empty>
              Nothing assigned to you.{" "}
              {manage
                ? "Pick from the Ready column or triage suggestions."
                : "Ask your growth lead, or create a task."}
            </Empty>
          )}
        </Card>
        <Card
          title="Goals this month"
          actions={<Link to="/growth/goals">Roadmap →</Link>}
        >
          {now.map((g) => (
            <div key={g.id} className="gw-goal-mini">
              <div className="gw-row">
                <strong>{g.title}</strong>
                <GoalChip g={g} />
              </div>
              {g.krs.map((k) => (
                <KRBar key={k.id} kr={k} elapsed={g.elapsed} />
              ))}
            </div>
          ))}
          <p className="muted small">
            The tick shows where we should be by today. Bars move only when the
            metric moves.
          </p>
        </Card>
      </div>

      <div className="grid3 gw-today-more">
        <Card title="Needs a decision">
          <ul className="gw-list">
            {toReview.map((t) => (
              <li key={t.id}>
                <button className="gw-linkbtn" onClick={() => openTask(t.id)}>
                  Review: {t.title}
                </button>
                {t.links.pr && (
                  <span className="muted small">
                    {" "}
                    · PR #{t.links.pr.number}
                  </span>
                )}
              </li>
            ))}
            {manage && suggested.length > 0 && (
              <li>
                <Link to="/growth/insights">
                  Triage {suggested.length} suggestion
                  {suggested.length > 1 ? "s" : ""} from the agent
                </Link>
              </li>
            )}
            {decisions.map((t) => (
              <li key={t.id}>
                <button className="gw-linkbtn" onClick={() => openTask(t.id)}>
                  {t.title}
                </button>
              </li>
            ))}
            {manage && unassigned.length > 0 && (
              <li>
                <Link to="/growth/tasks?owner=none">
                  {unassigned.length} ready tasks have no owner
                </Link>
              </li>
            )}
            {!toReview.length &&
              !suggested.length &&
              !decisions.length &&
              !unassigned.length && (
                <li className="muted">Nothing waiting on you.</li>
              )}
          </ul>
        </Card>
        <Card title="What changed this week">
          <ul className="gw-list">
            {overdue.length > 0 && (
              <li>
                <Link to="/growth/tasks?due=overdue">
                  {overdue.length} overdue task{overdue.length > 1 ? "s" : ""}
                </Link>
              </li>
            )}
            {notable.map((f) => (
              <li key={f.id}>
                {f.label.replace(/ \(.*\)$/, "")}: {fmt(f.previous, f.unit)} →{" "}
                {fmt(f.value, f.unit)}{" "}
                <span className="muted small">({f.window})</span>
              </li>
            ))}
            {(ws.report?.findings ?? []).slice(0, 2).map((x, i) => (
              <li key={i}>{x.title}</li>
            ))}
            {!overdue.length &&
              !notable.length &&
              !(ws.report?.findings ?? []).length && (
                <li className="muted">No big moves this week.</li>
              )}
          </ul>
        </Card>
        <Card title="Recent results">
          <ul className="gw-list">
            {wins.map((t) => (
              <li key={t.id}>
                <button className="gw-linkbtn" onClick={() => openTask(t.id)}>
                  {t.title}
                </button>{" "}
                {t.result ? (
                  <Chip tone={VERDICT[t.result.verdict].tone}>
                    {VERDICT[t.result.verdict].label}
                  </Chip>
                ) : (
                  <Chip>
                    measuring
                    {t.metric.checkOn
                      ? ` · ${shortDate(t.metric.checkOn)}`
                      : ""}
                  </Chip>
                )}
                {t.result?.value && (
                  <div className="muted small">{t.result.value}</div>
                )}
              </li>
            ))}
            {!wins.length && (
              <li className="muted">
                Finished work and its measured results show here.
              </li>
            )}
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ---------- Goals & roadmap ----------

const HORIZON: Record<Goal["horizon"], string> = {
  now: "Now",
  d30: "30 days after launch",
  d90: "90 days after launch",
  health: "Health · always",
};

export function Goals({
  ws,
  onChanged,
}: {
  ws: Workspace;
  onChanged: () => void;
}) {
  const manage = can(ws, "growth.write");
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <>
      <Card>
        <div className="gw-row">
          <div>
            <h2 style={{ margin: 0 }}>
              This month: {ws.settings.focus.text || "no focus set yet"}
            </h2>
            <p className="muted small">
              {ws.settings.focus.by ? `Set by ${ws.settings.focus.by}` : ""}
              {ws.settings.focus.reviewOn
                ? ` · review on ${shortDate(ws.settings.focus.reviewOn)}`
                : ""}
              {ws.settings.launchDate
                ? ` · Play launch ${shortDate(ws.settings.launchDate)}`
                : " · Play launch date not set: the 30- and 90-day goals start when it is"}
            </p>
          </div>
          {manage && (
            <Link to="/growth/settings">Change focus or launch date</Link>
          )}
        </div>
      </Card>
      <div className="gw-roadmap">
        {(["now", "d30", "d90", "health"] as const).map((h) => (
          <div key={h} className="gw-rm-col">
            <h3>{HORIZON[h]}</h3>
            {ws.goals
              .filter((g) => g.horizon === h)
              .map((g) => (
                <div key={g.id} className="card gw-goal">
                  <div className="gw-row">
                    <strong>
                      {g.horizon === "health" ? "" : `${g.id} · `}
                      {g.title}
                    </strong>
                    <GoalChip g={g} />
                  </div>
                  {g.why && <p className="muted small">{g.why}</p>}
                  {g.period && (
                    <p className="muted small">
                      {shortDate(g.period.start)} → {shortDate(g.period.end)}
                      {g.elapsed !== null
                        ? ` · ${Math.round(g.elapsed * 100)}% of the time gone`
                        : ""}
                    </p>
                  )}
                  {g.krs.map((k) => (
                    <KRBar key={k.id} kr={k} elapsed={g.elapsed} />
                  ))}
                  {ws.milestones
                    .filter((m) => m.goalId === g.id)
                    .map((m) => (
                      <div key={m.id} className="gw-ms">
                        <Link to={`/growth/tasks?milestone=${m.id}`}>
                          Milestone {m.id}: {m.title}
                        </Link>
                        <span className="muted small">
                          {" "}
                          · {m.done} of {m.total} tasks done
                          {m.share !== null
                            ? ` (${Math.round(m.share * 100)}% of the effort)`
                            : ""}
                        </span>
                        {m.blocked.map((b) => (
                          <div key={b.id} className="small">
                            <button
                              className="gw-linkbtn bad"
                              onClick={() => openTask(b.id)}
                            >
                              Blocked: {b.title}
                            </button>
                            <span className="muted"> · {b.blockedBy}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  <div className="gw-row">
                    <Link to={`/growth/tasks?goal=${g.id}`}>
                      {g.tasks} tasks →
                    </Link>
                    {manage && g.krs.some((k) => k.source === "manual") && (
                      <button
                        className="btn ghost small"
                        onClick={() =>
                          setEditing(editing === g.id ? null : g.id)
                        }
                      >
                        Update numbers
                      </button>
                    )}
                  </div>
                  {editing === g.id && (
                    <ManualKRs
                      goal={g}
                      onDone={() => (setEditing(null), onChanged())}
                    />
                  )}
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="grid2">
        <Card title="Blockers">
          <ul className="gw-list">
            {ws.tasks
              .filter((t) => t.status === "blocked")
              .map((t) => (
                <li key={t.id}>
                  <button className="gw-linkbtn" onClick={() => openTask(t.id)}>
                    {t.title}
                  </button>
                  <span className="muted small"> · {t.blockedBy}</span>
                </li>
              ))}
            {ws.tasks
              .filter((t) => t.type === "decision" && isOpen(t))
              .map((t) => (
                <li key={t.id}>
                  <button className="gw-linkbtn" onClick={() => openTask(t.id)}>
                    Open decision: {t.title.replace(/^Decide: /, "")}
                  </button>
                </li>
              ))}
            {!ws.tasks.some(
              (t) =>
                t.status === "blocked" || (t.type === "decision" && isOpen(t)),
            ) && <li className="muted">Nothing is blocked.</li>}
          </ul>
        </Card>
        <Card title="How progress is calculated">
          <p className="small">
            Key result = (current − baseline) ÷ (target − baseline), read from
            the metrics (live for the app and website, weekly for search and
            demand). "Entered" numbers come from a person, with their history.
          </p>
          <p className="small">
            A goal is on track when its average key-result progress keeps up
            with the share of its period gone; at risk when 10–25 points behind;
            behind beyond that. Milestones count tasks verified done (merged,
            posted or with proof), weighted by effort.
          </p>
        </Card>
      </div>
    </>
  );
}

function ManualKRs({ goal, onDone }: { goal: Goal; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(
    Object.fromEntries(
      goal.krs
        .filter((k) => k.source === "manual")
        .map((k) => [k.id, String(k.current ?? "")]),
    ),
  );
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await api("PUT", `/growth/goals/${goal.id}`, {
        krs: Object.entries(vals).map(([id, v]) => ({ id, value: Number(v) })),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="gw-form">
      {error && <div className="notice error">{error}</div>}
      {goal.krs
        .filter((k) => k.source === "manual")
        .map((k) => (
          <label key={k.id} className="gw-field">
            <span>{k.label}</span>
            <input
              type="number"
              value={vals[k.id]}
              onChange={(e) => setVals({ ...vals, [k.id]: e.target.value })}
            />
          </label>
        ))}
      <div className="btns">
        <button className="btn primary" onClick={() => void save()}>
          Save
        </button>
      </div>
    </div>
  );
}

// ---------- Tasks ----------

export function Tasks({
  ws,
  search,
  onNew,
}: {
  ws: Workspace;
  search: URLSearchParams;
  onNew: () => void;
}) {
  const view = (search.get("view") as "board" | "list" | "mine") || "board";
  const [wsF, setWsF] = useState(search.get("ws") ?? "all");
  const owner = search.get("owner");
  const goal = search.get("goal");
  const ms = search.get("milestone");
  const due = search.get("due");
  const filtered = useMemo(
    () =>
      ws.tasks.filter(
        (t) =>
          (wsF === "all" || t.workstream === wsF) &&
          (view !== "mine" ||
            t.owner === ws.me.email ||
            t.reviewer === ws.me.email) &&
          (!owner || (owner === "none" ? !t.owner : t.owner === owner)) &&
          (!goal || t.goalId === goal) &&
          (!ms || t.milestoneId === ms) &&
          (due !== "overdue" || isOverdue(t)),
      ),
    [ws.tasks, wsF, view, owner, goal, ms, due, ws.me.email],
  );
  const setView = (v: string) => {
    const u = new URL(location.href);
    u.searchParams.set("view", v);
    history.replaceState(null, "", u);
    dispatchEvent(new PopStateEvent("popstate"));
  };
  return (
    <>
      <div className="gw-row">
        <div className="tabs" role="tablist">
          {(["board", "list", "mine"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={view === v ? "tab on" : "tab"}
              onClick={() => setView(v)}
            >
              {{ board: "Board", list: "List", mine: "Mine" }[v]}
            </button>
          ))}
        </div>
        {can(ws, "growth.contribute") && (
          <button className="btn primary" onClick={onNew}>
            + New task
          </button>
        )}
      </div>
      <div className="chips">
        <button
          className={`chip ${wsF === "all" ? "on" : ""}`}
          onClick={() => setWsF("all")}
        >
          All workstreams
        </button>
        {Object.entries(WS).map(([k, v]) => (
          <button
            key={k}
            className={`chip ${wsF === k ? "on" : ""}`}
            onClick={() => setWsF(k)}
          >
            {v.label} ·{" "}
            {ws.tasks.filter((t) => t.workstream === k && isOpen(t)).length}
          </button>
        ))}
        {(owner || goal || ms || due) && (
          <Link to="/growth/tasks" className="chip on">
            Clear filter ✕
          </Link>
        )}
      </div>
      {view === "board" ? (
        <div className="gw-board">
          {BOARD.map((s) => {
            const col = filtered.filter((t) => t.status === s);
            return (
              <div key={s} className="gw-col">
                <h3>
                  {STATUS[s].label}
                  <span>{col.length}</span>
                </h3>
                {col.map((t) => (
                  <button
                    key={t.id}
                    className="gw-card"
                    onClick={() => openTask(t.id)}
                  >
                    <span className="gw-row">
                      <Pri p={t.priority} />
                      <span className="muted small">
                        {WS[t.workstream]?.label}
                      </span>
                    </span>
                    <span className="gw-task-title">{t.title}</span>
                    <span className="gw-row">
                      <Person email={t.owner} small />
                      <span className="muted small">
                        {isOverdue(t) ? (
                          <Chip tone="bad">Overdue</Chip>
                        ) : t.due ? (
                          shortDate(t.due)
                        ) : t.links.pr ? (
                          `PR #${t.links.pr.number}`
                        ) : (
                          ""
                        )}
                      </span>
                    </span>
                  </button>
                ))}
                {!col.length && (
                  <span className="muted small">Nothing here</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Workstream</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Due</th>
                  <th>Metric</th>
                </tr>
              </thead>
              <tbody>
                {filtered
                  .filter((t) => view === "mine" || t.status !== "wontdo")
                  .map((t) => (
                    <tr
                      key={t.id}
                      className="gw-click"
                      onClick={() => openTask(t.id)}
                    >
                      <td>
                        <Pri p={t.priority} /> {t.title}
                      </td>
                      <td className="muted">{WS[t.workstream]?.label}</td>
                      <td>
                        <StatusChip t={t} />
                      </td>
                      <td>
                        <Person email={t.owner} />
                      </td>
                      <td
                        className={
                          isOverdue(t) ? "gw-bad" : dueSoon(t) ? "gw-warn" : ""
                        }
                      >
                        {t.due ? shortDate(t.due) : "—"}
                      </td>
                      <td className="muted small">
                        {t.result
                          ? VERDICT[t.result.verdict].label
                          : t.metric.label || "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && <Empty>No tasks match.</Empty>}
        </Card>
      )}
      <p className="muted small">
        {filtered.filter(isOpen).length} open ·{" "}
        {filtered.filter(isOverdue).length} overdue ·{" "}
        {filtered.filter((t) => t.status === "suggested").length} suggested ·
        today is {shortDate(todayStr())}
      </p>
    </>
  );
}

export type { Task };
