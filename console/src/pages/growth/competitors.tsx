// Competitors: weekly snapshots of their websites, what changed, and AI research briefs.
import { useState } from "react";

import { api, get } from "../../api";
import { Card, date, Empty, Loaded, Stat, useLoad } from "../../ui";
import { analystButton, useGrowthReload, useJobs } from "./jobs";
import { can, CardTable, Chip, openTask, type Workspace } from "./shared";

type Comp = {
  id: string;
  name: string;
  site: string;
  kind: string;
  notes: string;
  latest?: {
    title: string;
    description: string;
    headings: string[];
    prices: string[];
    words: number;
    status: number;
    error?: string;
    sitemapUrls: number | null;
    needsBrowser?: boolean;
    at: number;
  };
  lastChanges?: string[];
  lastNewPages?: string[];
  checkedAt?: number;
  brief?: string;
  briefAt?: number;
  briefTask?: string;
};
type Data = {
  competitors: Comp[];
  timeline: { id: string; at: number; changes: string[]; newPages: string[] }[];
};
const KIND: Record<string, string> = {
  backup: "Photo backup",
  "event-sharing": "Event photo sharing",
  camera: "Camera",
  other: "Other",
};

export function Competitors({ ws }: { ws: Workspace }) {
  const [n, setN] = useState(0);
  const { jobs, refresh } = useJobs();
  const reloadKey = useGrowthReload();
  const state = useLoad(() => get<Data>("/growth/competitors"), [n, reloadKey]);
  const researchBtn = analystButton(
    jobs,
    (a) => a.kind === "draft",
    "Research with the agent",
    "Agent busy…",
  );
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<Comp | "new" | null>(null);
  const manage = can(ws, "growth.write");
  const research = async (c: Comp) => {
    try {
      const r = await api<{ taskId: string; started: string }>(
        "POST",
        `/growth/competitors/${c.id}/research`,
      );
      if (r.started !== "started")
        alert(
          `Task ${r.taskId} created. The agent is busy: press "Ask agent to draft" on the task when it's free.`,
        );
      refresh();
      setN((x) => x + 1);
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const check = async () => {
    await api("POST", "/growth/competitors/check")
      .then(refresh)
      .catch((e: Error) => alert(e.message));
  };
  return (
    <Loaded state={state}>
      {(d) => {
        const changed = d.competitors.filter(
          (c) =>
            (c.lastChanges?.length ?? 0) > 0 ||
            (c.lastNewPages?.length ?? 0) > 0,
        );
        return (
          <>
            <div className="stats">
              <Stat
                label="Competitors watched"
                value={d.competitors.length}
                sub="checked every Monday"
              />
              <Stat label="Changed this week" value={changed.length} />
              <Stat
                label="New pages this week"
                value={d.competitors.reduce(
                  (s, c) => s + (c.lastNewPages?.length ?? 0),
                  0,
                )}
              />
              <Stat
                label="Research briefs"
                value={d.competitors.filter((c) => c.brief).length}
              />
            </div>
            <Card
              title="Competitors"
              actions={
                manage && (
                  <span className="btns">
                    <button
                      className="btn"
                      disabled={!!jobs.competitors}
                      onClick={() => void check()}
                    >
                      {jobs.competitors ? "Checking…" : "Check now"}
                    </button>
                    <button className="btn" onClick={() => setEdit("new")}>
                      + Add
                    </button>
                  </span>
                )
              }
            >
              <CardTable>
                <table>
                  <thead>
                    <tr>
                      <th>Competitor</th>
                      <th>What their homepage says</th>
                      <th>Prices on the page</th>
                      <th className="num">Pages</th>
                      <th>This week</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {d.competitors.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <a href={c.site} target="_blank" rel="noreferrer">
                            {c.name}
                          </a>
                          <div className="muted small">
                            {KIND[c.kind] ?? c.kind}
                          </div>
                        </td>
                        <td className="small">
                          {c.latest?.error ? (
                            <Chip tone="warn">
                              couldn't load: {c.latest.error}
                            </Chip>
                          ) : c.latest ? (
                            <>
                              <strong>{c.latest.title}</strong>
                              {c.latest.headings[0] && (
                                <div className="muted">
                                  “{c.latest.headings[0]}”
                                </div>
                              )}
                              {c.latest.needsBrowser && (
                                <Chip tone="warn">needs a browser crawler</Chip>
                              )}
                            </>
                          ) : (
                            <span className="muted">not checked yet</span>
                          )}
                        </td>
                        <td className="small">
                          {c.latest?.prices.slice(0, 4).join(", ") || "—"}
                        </td>
                        <td className="num">
                          {c.latest?.sitemapUrls?.toLocaleString("en-IN") ??
                            "—"}
                        </td>
                        <td className="small">
                          {(c.lastChanges?.length ?? 0) +
                          (c.lastNewPages?.length ?? 0) ? (
                            <Chip tone="acc">
                              {(c.lastChanges?.length ?? 0) > 0
                                ? `${c.lastChanges!.length} change${c.lastChanges!.length > 1 ? "s" : ""}`
                                : ""}
                              {(c.lastChanges?.length ?? 0) > 0 &&
                              (c.lastNewPages?.length ?? 0) > 0
                                ? " · "
                                : ""}
                              {(c.lastNewPages?.length ?? 0) > 0
                                ? `${c.lastNewPages!.length} new page${c.lastNewPages!.length > 1 ? "s" : ""}`
                                : ""}
                            </Chip>
                          ) : (
                            <span className="muted">
                              {c.checkedAt ? "no change" : "—"}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className="btns">
                            <button
                              className="btn ghost small"
                              onClick={() =>
                                setOpen(open === c.id ? null : c.id)
                              }
                            >
                              {open === c.id ? "Hide" : "Details"}
                            </button>
                            {manage && (
                              <button
                                className="btn small"
                                disabled={researchBtn.disabled}
                                onClick={() => void research(c)}
                              >
                                {researchBtn.disabled
                                  ? researchBtn.label
                                  : c.brief
                                    ? "Research again"
                                    : "Research with the agent"}
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardTable>
              <p className="muted small">
                Each Monday the analysis reads every competitor's homepage and
                sitemap and notes what changed. The agent can read their public
                pages (only these sites) when it researches or analyses.
              </p>
            </Card>
            {open &&
              (() => {
                const c = d.competitors.find((x) => x.id === open)!;
                return (
                  <Card
                    title={c.name}
                    actions={
                      manage && (
                        <button
                          className="btn ghost small"
                          onClick={() => setEdit(c)}
                        >
                          Edit
                        </button>
                      )
                    }
                  >
                    {c.notes && <p className="small">{c.notes}</p>}
                    {c.latest && !c.latest.error && (
                      <dl className="gw-kv">
                        <dt>Description</dt>
                        <dd>{c.latest.description || "—"}</dd>
                        <dt>Headlines</dt>
                        <dd>{c.latest.headings.join(" · ") || "—"}</dd>
                        <dt>Checked</dt>
                        <dd>{date(c.latest.at)}</dd>
                      </dl>
                    )}
                    {(c.lastChanges ?? []).length > 0 && (
                      <>
                        <h3 className="small">What changed</h3>
                        <ul className="gw-list">
                          {c.lastChanges!.map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {(c.lastNewPages ?? []).length > 0 && (
                      <>
                        <h3 className="small">New pages</h3>
                        <ul className="gw-list">
                          {c.lastNewPages!.map((u) => (
                            <li key={u}>
                              <a href={u} target="_blank" rel="noreferrer">
                                {u}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <h3 className="small">Research brief</h3>
                    {c.brief ? (
                      <>
                        <p className="muted small">
                          {date(c.briefAt)} by the growth agent ·{" "}
                          {c.briefTask && (
                            <button
                              className="gw-linkbtn"
                              onClick={() => openTask(c.briefTask!)}
                            >
                              task {c.briefTask}
                            </button>
                          )}
                        </p>
                        <div className="gw-brief">{c.brief}</div>
                      </>
                    ) : (
                      <Empty>
                        No brief yet. "Research with the agent" writes one from
                        their public pages (5–10 minutes).
                      </Empty>
                    )}
                  </Card>
                );
              })()}
            <Card title="Timeline">
              {d.timeline.length ? (
                <ul className="gw-list">
                  {d.timeline.slice(0, 40).map((t, i) => (
                    <li key={i}>
                      <span className="muted small">{date(t.at)}</span> ·{" "}
                      <strong>
                        {d.competitors.find((c) => c.id === t.id)?.name ?? t.id}
                      </strong>
                      :{" "}
                      {[
                        ...t.changes,
                        ...(t.newPages.length
                          ? [
                              `${t.newPages.length} new page${t.newPages.length > 1 ? "s" : ""}`,
                            ]
                          : []),
                      ].join(" · ")}
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>
                  Changes show here from the second weekly check on.
                </Empty>
              )}
            </Card>
            {edit && (
              <CompForm
                c={edit === "new" ? undefined : edit}
                onDone={() => (setEdit(null), setN((x) => x + 1))}
              />
            )}
          </>
        );
      }}
    </Loaded>
  );
}

function CompForm({ c, onDone }: { c?: Comp; onDone: () => void }) {
  const [v, setV] = useState({
    name: c?.name ?? "",
    site: c?.site ?? "https://",
    kind: c?.kind ?? "backup",
    notes: c?.notes ?? "",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <>
      <div className="gw-scrim" onClick={onDone} />
      <aside className="gw-drawer" aria-label="Competitor">
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">{c ? c.name : "New competitor"}</h2>
          <button className="btn ghost" onClick={onDone}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        <div className="gw-form">
          <label className="gw-field">
            <span>Name</span>
            <input value={v.name} onChange={set("name")} />
          </label>
          <label className="gw-field">
            <span>Website (homepage, https://…)</span>
            <input value={v.site} onChange={set("site")} />
          </label>
          <label className="gw-field">
            <span>Kind</span>
            <select value={v.kind} onChange={set("kind")}>
              {Object.entries(KIND).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="gw-field">
            <span>Notes</span>
            <textarea rows={3} value={v.notes} onChange={set("notes")} />
          </label>
          <div className="btns">
            <button
              className="btn primary"
              disabled={!v.name.trim()}
              onClick={() =>
                void api("PUT", `/growth/competitors/${c?.id ?? "new"}`, v)
                  .then(onDone)
                  .catch((e: Error) => setError(e.message))
              }
            >
              Save
            </button>
            {c && (
              <button
                className="btn danger"
                onClick={() =>
                  void api("DELETE", `/growth/competitors/${c.id}`)
                    .then(onDone)
                    .catch((e: Error) => setError(e.message))
                }
              >
                Stop watching
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
