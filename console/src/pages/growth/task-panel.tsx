// The task panel: everything about one piece of growth work, editable by permission.
import { useEffect, useState } from "react";

import { api, get } from "../../api";
import { date } from "../../ui";
import { analystButton, useGrowthReload, useJobs } from "./jobs";
import {
  BOARD,
  can,
  Chip,
  closeTask,
  Person,
  Pri,
  STATUS,
  StatusChip,
  VERDICT,
  WS,
  type Status,
  type Task,
  type Workspace,
} from "./shared";

type LogEntry = {
  at: number;
  by: string;
  kind: "comment" | "change";
  text?: string;
  changes?: Record<string, [unknown, unknown]>;
};
const DRAFTABLE = ["page", "content", "fix"];
const TEXT_DRAFTS = ["social", "listing", "partner"];

export function TaskPanel({
  id,
  ws,
  onChanged,
}: {
  id: string;
  ws: Workspace;
  onChanged: () => void;
}) {
  const [data, setData] = useState<{ task: Task; log: LogEntry[] }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<Status | null>(null);
  const [extra, setExtra] = useState("");
  const { jobs, refresh } = useJobs();
  const reloadKey = useGrowthReload();
  const drafting = analystButton(
    jobs,
    (a) => a.kind === "draft" && a.ref === id,
    "Ask agent to draft",
    "Drafting…",
  );
  const load = () =>
    get<{ task: Task; log: LogEntry[] }>(
      `/growth/tasks/${encodeURIComponent(id)}`,
    ).then(setData, (e: Error) => setError(e.message));
  useEffect(() => {
    setData(undefined);
    setError("");
    setPending(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (reloadKey) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && closeTask();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);

  const manage = can(ws, "growth.write");
  const t = data?.task;
  const mine = !!t && (t.owner === ws.me.email || t.reviewer === ws.me.email);
  const editable = manage || (can(ws, "growth.contribute") && mine);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await api("PATCH", `/growth/tasks/${encodeURIComponent(id)}`, body);
      await load();
      onChanged();
      setPending(null);
      setExtra("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const changeStatus = (to: Status) => {
    const needs: Partial<Record<Status, string>> = {
      wontdo: "wontDoReason",
      blocked: "blockedBy",
      done: "proof",
      in_review: "reviewer",
    };
    const k = needs[to];
    if (k && !(t as any)?.[k] && !(to === "done" && t?.links.pr)) {
      setPending(to);
      setExtra(
        to === "in_review"
          ? t?.reviewer || ws.team.find((m) => m.role === "owner")?.email || ""
          : "",
      );
      return;
    }
    void save({ status: to });
  };
  const draft = async () => {
    setBusy(true);
    setError("");
    try {
      await api("POST", `/growth/tasks/${encodeURIComponent(id)}/draft`);
      refresh();
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const addComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      await api("POST", `/growth/tasks/${encodeURIComponent(id)}/comments`, {
        text: comment,
      });
      setComment("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const people = ["", "agent", ...ws.team.map((m) => m.email)];
  const goal = ws.goals.find((g) => g.id === t?.goalId);
  return (
    <>
      <div className="gw-scrim" onClick={closeTask} />
      <aside className="gw-drawer" aria-label="Task">
        <div className="gw-drawer-head">
          <span className="muted small">
            {id}
            {t
              ? ` · ${WS[t.workstream]?.label ?? t.workstream} · ${t.type}`
              : ""}
            {t?.source.kind === "ai"
              ? ` · suggested by the agent${t.source.report ? ` (${t.source.report})` : ""}`
              : ""}
          </span>
          <button className="btn ghost" onClick={closeTask}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {!t ? (
          <div className="muted">Loading…</div>
        ) : (
          <>
            <h2 className="gw-drawer-title">{t.title}</h2>
            <div className="gw-statuses">
              {BOARD.map((s) => (
                <button
                  key={s}
                  className={`gw-chip ${s === t.status ? STATUS[s].tone + " on" : "plain"}`}
                  disabled={
                    !editable || busy || s === t.status || s === "measured"
                  }
                  onClick={() => changeStatus(s)}
                >
                  {STATUS[s].label}
                </button>
              ))}
              <button
                className="gw-chip plain"
                disabled={!editable || busy || t.status === "wontdo"}
                onClick={() => changeStatus("wontdo")}
              >
                Won't do
              </button>
            </div>
            {pending && (
              <div className="gw-need">
                <label htmlFor="gw-extra">
                  {pending === "wontdo" && "Why not? The agent learns from it."}
                  {pending === "blocked" && "What blocks it?"}
                  {pending === "done" &&
                    "Proof: a link or a note on what shipped"}
                  {pending === "in_review" && "Who reviews it?"}
                </label>
                {pending === "in_review" ? (
                  <select
                    id="gw-extra"
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                  >
                    {ws.team.map((m) => (
                      <option key={m.email} value={m.email}>
                        {m.email}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="gw-extra"
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    autoFocus
                  />
                )}
                <div className="btns">
                  <button
                    className="btn primary"
                    disabled={!extra.trim() || busy}
                    onClick={() =>
                      void save({
                        status: pending,
                        [{
                          wontdo: "wontDoReason",
                          blocked: "blockedBy",
                          done: "proof",
                          in_review: "reviewer",
                        }[pending as "wontdo"]]: extra,
                      })
                    }
                  >
                    Move to{" "}
                    {pending === "wontdo" ? "Won't do" : STATUS[pending].label}
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => setPending(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {t.status === "suggested" && manage && (
              <div className="gw-callout">
                <strong>Suggested by the growth agent.</strong> Accept it to
                make it real work, or say why not.
                <div className="btns">
                  <button
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      void save({
                        status: "ready",
                        owner:
                          t.owner || ws.settings.wsOwners[t.workstream] || "",
                      })
                    }
                  >
                    Accept
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => changeStatus("wontdo")}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            {manage &&
              ["ready", "in_progress"].includes(t.status) &&
              (DRAFTABLE.includes(t.type) ||
                TEXT_DRAFTS.includes(t.type) ||
                !!t.spec) && (
                <div className="gw-callout">
                  {TEXT_DRAFTS.includes(t.type) ? (
                    <>
                      <strong>The agent can draft the text.</strong>{" "}
                      {t.type === "social"
                        ? "Post options land in the social calendar as drafts"
                        : t.type === "listing"
                          ? "Play listing options appear on this task"
                          : "Outreach message options appear on this task"}
                      ; you review, edit and post or send them yourself.
                    </>
                  ) : (
                    <>
                      <strong>
                        The agent can draft this as a pull request.
                      </strong>{" "}
                      It edits the website code, opens a PR on an agent/* branch
                      and emails you. Nothing ships until you merge.
                    </>
                  )}
                  <div className="btns">
                    <button
                      className="btn primary"
                      disabled={busy || drafting.disabled}
                      onClick={() => void draft()}
                    >
                      {drafting.label}
                    </button>
                  </div>
                </div>
              )}
            {t.links.pr && (
              <div className="gw-callout">
                <strong>Pull request #{t.links.pr.number}</strong>{" "}
                <a href={t.links.pr.url} target="_blank" rel="noreferrer">
                  Review on GitHub
                </a>
                <div className="small">
                  Approve and merge it there; the task moves to Done when it
                  merges.
                </div>
              </div>
            )}
            {t.status === "blocked" && t.blockedBy && (
              <div className="notice">Blocked: {t.blockedBy}</div>
            )}
            {t.status === "wontdo" && t.wontDoReason && (
              <div className="notice">Won't do: {t.wontDoReason}</div>
            )}

            <section className="gw-sec">
              <h3>What and why</h3>
              <TextEdit
                value={t.description}
                editable={editable}
                onSave={(v) => save({ description: v })}
                placeholder="What needs to happen"
              />
              {t.evidence.map((e, i) => (
                <div key={i} className="gw-evid">
                  {e.text}
                  {e.facts.length > 0 && (
                    <span className="muted small"> · {e.facts.join(", ")}</span>
                  )}
                  {e.link && (
                    <>
                      {" "}
                      <a href={e.link} target="_blank" rel="noreferrer">
                        link
                      </a>
                    </>
                  )}
                </div>
              ))}
              {t.expectedImpact && (
                <p className="small">Expected impact: {t.expectedImpact}</p>
              )}
            </section>

            <dl className="gw-kv">
              <dt>Priority</dt>
              <dd>
                {manage ? (
                  <select
                    value={t.priority}
                    onChange={(e) =>
                      void save({ priority: Number(e.target.value) })
                    }
                    aria-label="Priority"
                  >
                    {[0, 1, 2, 3].map((p) => (
                      <option key={p} value={p}>
                        P{p}
                        {p === 0 ? " · do now" : p === 3 ? " · someday" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Pri p={t.priority} />
                )}{" "}
                <span className="muted small">
                  impact {t.impact}/3 · confidence {t.confidence}/3 · effort{" "}
                  {t.effortHours} h
                </span>
              </dd>
              <dt>Owner</dt>
              <dd>
                {manage ? (
                  <select
                    value={t.owner}
                    onChange={(e) => void save({ owner: e.target.value })}
                    aria-label="Owner"
                  >
                    {people.map((p) => (
                      <option key={p} value={p}>
                        {p === ""
                          ? "Unassigned"
                          : p === "agent"
                            ? "Growth agent"
                            : p}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Person email={t.owner} />
                )}
              </dd>
              <dt>Reviewer</dt>
              <dd>
                {editable ? (
                  <select
                    value={t.reviewer}
                    onChange={(e) => void save({ reviewer: e.target.value })}
                    aria-label="Reviewer"
                  >
                    {people
                      .filter((p) => p !== "agent")
                      .map((p) => (
                        <option key={p} value={p}>
                          {p || "None"}
                        </option>
                      ))}
                  </select>
                ) : (
                  <Person email={t.reviewer} />
                )}
              </dd>
              <dt>Due</dt>
              <dd>
                {editable ? (
                  <input
                    type="date"
                    value={t.due}
                    onChange={(e) => void save({ due: e.target.value })}
                    aria-label="Due date"
                  />
                ) : (
                  t.due || "—"
                )}
              </dd>
              <dt>Goal</dt>
              <dd>
                {manage ? (
                  <select
                    value={t.goalId}
                    onChange={(e) => void save({ goalId: e.target.value })}
                    aria-label="Goal"
                  >
                    <option value="">None</option>
                    {ws.goals.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.id} · {g.title}
                      </option>
                    ))}
                  </select>
                ) : goal ? (
                  `${goal.id} · ${goal.title}`
                ) : (
                  "—"
                )}
              </dd>
              <dt>Milestone</dt>
              <dd>
                {manage ? (
                  <select
                    value={t.milestoneId}
                    onChange={(e) => void save({ milestoneId: e.target.value })}
                    aria-label="Milestone"
                  >
                    <option value="">None</option>
                    {ws.milestones.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id} · {m.title}
                      </option>
                    ))}
                  </select>
                ) : (
                  ws.milestones.find((m) => m.id === t.milestoneId)?.title ||
                  "—"
                )}
              </dd>
              <dt>Workstream</dt>
              <dd>
                {manage ? (
                  <select
                    value={t.workstream}
                    onChange={(e) => void save({ workstream: e.target.value })}
                    aria-label="Workstream"
                  >
                    {Object.entries(WS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  WS[t.workstream]?.label
                )}
              </dd>
            </dl>

            <section className="gw-sec">
              <h3>Success metric</h3>
              <MetricEdit
                t={t}
                editable={editable}
                onSave={(metric) => save({ metric })}
              />
              {(t.status === "done" || t.status === "measured" || t.result) && (
                <ResultEdit
                  t={t}
                  editable={editable}
                  onSave={(result, measured) =>
                    save({
                      result,
                      ...(measured ? { status: "measured" } : {}),
                    })
                  }
                />
              )}
            </section>

            {(t.links.page ||
              t.links.keyword ||
              t.links.campaign ||
              t.links.partner ||
              t.proof) && (
              <section className="gw-sec">
                <h3>Linked</h3>
                <dl className="gw-kv">
                  {t.links.page && (
                    <>
                      <dt>Page</dt>
                      <dd>
                        {t.links.page.startsWith("/") ? (
                          <a
                            href={`https://lens.instagrowapp.com${t.links.page}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t.links.page}
                          </a>
                        ) : (
                          t.links.page
                        )}
                      </dd>
                    </>
                  )}
                  {t.links.keyword && (
                    <>
                      <dt>Keyword</dt>
                      <dd>“{t.links.keyword}”</dd>
                    </>
                  )}
                  {t.links.campaign && (
                    <>
                      <dt>Campaign</dt>
                      <dd>{t.links.campaign}</dd>
                    </>
                  )}
                  {t.proof && (
                    <>
                      <dt>Proof</dt>
                      <dd>
                        {t.proof.startsWith("http") ? (
                          <a href={t.proof} target="_blank" rel="noreferrer">
                            {t.proof}
                          </a>
                        ) : (
                          t.proof
                        )}
                      </dd>
                    </>
                  )}
                </dl>
              </section>
            )}

            <section className="gw-sec">
              <h3>Discussion</h3>
              {data!.log
                .filter((l) => l.kind === "comment")
                .map((l, i) => (
                  <div key={i} className="gw-comment">
                    <Person email={l.by} small />
                    <div>
                      <strong>
                        {l.by === "agent" ? "Growth agent" : l.by}
                      </strong>{" "}
                      <span className="muted small">{date(l.at)}</span>
                      <div className="gw-comment-text">{l.text}</div>
                    </div>
                  </div>
                ))}
              {can(ws, "growth.contribute") && (
                <>
                  <label htmlFor="gw-comment" className="muted small">
                    Add a note. @name sends them an email.
                  </label>
                  <textarea
                    id="gw-comment"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={3}
                  />
                  <div className="btns">
                    <button
                      className="btn"
                      disabled={!comment.trim() || busy}
                      onClick={() => void addComment()}
                    >
                      Comment
                    </button>
                  </div>
                </>
              )}
            </section>

            <section className="gw-sec">
              <h3>History</h3>
              <div className="gw-history">
                {data!.log
                  .filter((l) => l.kind === "change")
                  .map((l, i) => (
                    <div key={i}>
                      <span className="muted">{date(l.at)}</span> ·{" "}
                      {l.by === "agent"
                        ? "Growth agent"
                        : l.by === "seed"
                          ? "From the strategy"
                          : l.by}
                      : {l.text ?? ""}
                      {l.changes &&
                        Object.entries(l.changes)
                          .map(
                            ([k, [, to]]) =>
                              ` ${k} → ${k === "status" ? (STATUS[to as Status]?.label ?? to) : typeof to === "object" ? "updated" : String(to || "—")}`,
                          )
                          .join(";")}
                    </div>
                  ))}
                <div>
                  <span className="muted">{date(t.createdAt)}</span> · created
                  by {t.createdBy === "seed" ? "the strategy" : t.createdBy}
                </div>
              </div>
            </section>
          </>
        )}
      </aside>
    </>
  );
}

function TextEdit({
  value,
  editable,
  onSave,
  placeholder,
}: {
  value: string;
  editable: boolean;
  onSave: (v: string) => void;
  placeholder: string;
}) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setV(value), [value]);
  if (!editing)
    return (
      <div className="gw-text">
        {value ? (
          <p style={{ whiteSpace: "pre-wrap" }}>{value}</p>
        ) : (
          <p className="muted">{placeholder}</p>
        )}
        {editable && (
          <button className="btn ghost small" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
    );
  return (
    <div className="gw-text">
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        rows={5}
        aria-label={placeholder}
      />
      <div className="btns">
        <button
          className="btn primary"
          onClick={() => {
            onSave(v);
            setEditing(false);
          }}
        >
          Save
        </button>
        <button className="btn ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MetricEdit({
  t,
  editable,
  onSave,
}: {
  t: Task;
  editable: boolean;
  onSave: (m: Task["metric"]) => void;
}) {
  const [m, setM] = useState(t.metric);
  const [editing, setEditing] = useState(false);
  useEffect(() => setM(t.metric), [t.metric]);
  if (!editing)
    return (
      <dl className="gw-kv">
        <dt>Metric</dt>
        <dd>
          {t.metric.label || (
            <span className="muted">Not set: how will we know it worked?</span>
          )}
        </dd>
        <dt>Baseline</dt>
        <dd>
          {t.metric.baseline || "—"}
          {t.metric.baselineAt ? (
            <span className="muted small"> · {t.metric.baselineAt}</span>
          ) : (
            ""
          )}
        </dd>
        <dt>Target</dt>
        <dd>{t.metric.target || "—"}</dd>
        <dt>Check on</dt>
        <dd>
          {t.metric.checkOn || "—"}{" "}
          {editable && (
            <button
              className="btn ghost small"
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
          )}
        </dd>
      </dl>
    );
  const field = (k: keyof Task["metric"], label: string, type = "text") => (
    <label className="gw-field">
      <span>{label}</span>
      <input
        type={type}
        value={m[k]}
        onChange={(e) => setM({ ...m, [k]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="gw-form">
      {field("label", "What we measure")}
      {field("fact", "Metric id (optional, e.g. web.get_lens_rate)")}
      {field("baseline", "Baseline")}
      {field("baselineAt", "Baseline date", "date")}
      {field("target", "Target")}
      {field("checkOn", "Check on", "date")}
      <div className="btns">
        <button
          className="btn primary"
          onClick={() => {
            onSave(m);
            setEditing(false);
          }}
        >
          Save
        </button>
        <button className="btn ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ResultEdit({
  t,
  editable,
  onSave,
}: {
  t: Task;
  editable: boolean;
  onSave: (
    r: { value: string; verdict: string; learning: string },
    measured: boolean,
  ) => void;
}) {
  const [r, setR] = useState({
    value: t.result?.value ?? "",
    verdict: t.result?.verdict ?? "too_early",
    learning: t.result?.learning ?? "",
  });
  const [editing, setEditing] = useState(false);
  if (!editing)
    return (
      <div className="gw-result">
        <strong>Result</strong>{" "}
        {t.result ? (
          <>
            {t.result.value}{" "}
            <Chip tone={VERDICT[t.result.verdict]?.tone}>
              {VERDICT[t.result.verdict]?.label}
            </Chip>
            {t.result.learning && (
              <p className="small">Learning: {t.result.learning}</p>
            )}
            <span className="muted small">
              {t.result.by === "agent"
                ? "Measured by the growth agent"
                : `Recorded by ${t.result.by}`}{" "}
              · {date(t.result.at)}
            </span>
          </>
        ) : (
          <span className="muted">
            Not measured yet
            {t.metric.checkOn
              ? `: the agent checks on ${t.metric.checkOn}`
              : ""}
            .
          </span>
        )}{" "}
        {editable && (
          <button className="btn ghost small" onClick={() => setEditing(true)}>
            {t.result ? "Edit" : "Record result"}
          </button>
        )}
      </div>
    );
  return (
    <div className="gw-form">
      <label className="gw-field">
        <span>Actual value</span>
        <input
          value={r.value}
          onChange={(e) => setR({ ...r, value: e.target.value })}
        />
      </label>
      <label className="gw-field">
        <span>Verdict</span>
        <select
          value={r.verdict}
          onChange={(e) => setR({ ...r, verdict: e.target.value as never })}
        >
          {Object.entries(VERDICT).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className="gw-field">
        <span>What we learned</span>
        <textarea
          rows={3}
          value={r.learning}
          onChange={(e) => setR({ ...r, learning: e.target.value })}
        />
      </label>
      <div className="btns">
        <button
          className="btn primary"
          disabled={!r.value.trim()}
          onClick={() => {
            onSave(r, r.verdict !== "too_early");
            setEditing(false);
          }}
        >
          Save result
        </button>
        <button className="btn ghost" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** New task form (a modal panel). */
export function NewTask({
  ws,
  defaults,
  onDone,
}: {
  ws: Workspace;
  defaults?: Partial<Task>;
  onDone: (id?: string) => void;
}) {
  const [f, setF] = useState({
    title: "",
    description: "",
    workstream: defaults?.workstream ?? "search",
    type: "ops",
    impact: 2,
    confidence: 2,
    effortHours: 2,
    owner: can(ws, "growth.write") ? "" : ws.me.email,
    due: "",
    goalId: defaults?.goalId ?? "",
    milestoneId: "",
    metricLabel: "",
    target: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ task: Task }>("POST", "/growth/tasks", {
        title: f.title,
        description: f.description,
        workstream: f.workstream,
        type: f.type,
        impact: f.impact,
        confidence: f.confidence,
        effortHours: f.effortHours,
        owner: f.owner,
        due: f.due,
        goalId: f.goalId,
        milestoneId: f.milestoneId,
        metric: {
          label: f.metricLabel,
          fact: "",
          baseline: "",
          baselineAt: new Date().toISOString().slice(0, 10),
          target: f.target,
          checkOn: "",
        },
      });
      onDone(r.task.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({
      ...f,
      [k]: ["impact", "confidence", "effortHours"].includes(k)
        ? Number(e.target.value)
        : e.target.value,
    });
  return (
    <>
      <div className="gw-scrim" onClick={() => onDone()} />
      <aside className="gw-drawer" aria-label="New task">
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">New task</h2>
          <button className="btn ghost" onClick={() => onDone()}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="gw-form">
          <label className="gw-field">
            <span>Title: the action to take</span>
            <input value={f.title} onChange={set("title")} autoFocus />
          </label>
          <label className="gw-field">
            <span>Why and what</span>
            <textarea
              rows={4}
              value={f.description}
              onChange={set("description")}
            />
          </label>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Workstream</span>
              <select value={f.workstream} onChange={set("workstream")}>
                {Object.entries(WS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>Type</span>
              <select value={f.type} onChange={set("type")}>
                {[
                  "page",
                  "content",
                  "social",
                  "listing",
                  "experiment",
                  "partner",
                  "fix",
                  "research",
                  "decision",
                  "ops",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Impact</span>
              <select value={f.impact} onChange={set("impact")}>
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </select>
            </label>
            <label className="gw-field">
              <span>Confidence</span>
              <select value={f.confidence} onChange={set("confidence")}>
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
              </select>
            </label>
            <label className="gw-field">
              <span>Effort (hours)</span>
              <input
                type="number"
                min={0}
                value={f.effortHours}
                onChange={set("effortHours")}
              />
            </label>
          </div>
          <div className="gw-form-row">
            {can(ws, "growth.write") && (
              <label className="gw-field">
                <span>Owner</span>
                <select value={f.owner} onChange={set("owner")}>
                  <option value="">Unassigned</option>
                  <option value="agent">Growth agent</option>
                  {ws.team.map((m) => (
                    <option key={m.email} value={m.email}>
                      {m.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="gw-field">
              <span>Due</span>
              <input type="date" value={f.due} onChange={set("due")} />
            </label>
          </div>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Goal</span>
              <select value={f.goalId} onChange={set("goalId")}>
                <option value="">None</option>
                {ws.goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.id} · {g.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>Milestone</span>
              <select value={f.milestoneId} onChange={set("milestoneId")}>
                <option value="">None</option>
                {ws.milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} · {m.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Success metric</span>
              <input
                value={f.metricLabel}
                onChange={set("metricLabel")}
                placeholder="e.g. visits from Reddit"
              />
            </label>
            <label className="gw-field">
              <span>Target</span>
              <input value={f.target} onChange={set("target")} />
            </label>
          </div>
          <div className="btns">
            <button
              className="btn primary"
              disabled={!f.title.trim() || busy}
              onClick={() => void submit()}
            >
              Create task
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export { StatusChip };
