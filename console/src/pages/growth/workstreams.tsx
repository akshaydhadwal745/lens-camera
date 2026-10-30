// Workstream pages: one template (outcome, numbers, work, suggestions, results) plus each one's evidence.
import { ReactNode, useState } from "react";

import { api } from "../../api";
import { Card, Empty, Stat } from "../../ui";
import {
  can,
  Chip,
  fmt,
  isOpen,
  isOverdue,
  openTask,
  Person,
  shortDate,
  TaskRow,
  VERDICT,
  WS,
  type Partner,
  type Post,
  type Workspace,
  type Workstream,
} from "./shared";

const f = (ws: Workspace, id: string) => ws.facts.find((x) => x.id === id);
const fv = (ws: Workspace, id: string) =>
  fmt(f(ws, id)?.value, f(ws, id)?.unit ?? "count");

export function WorkstreamPage({
  ws,
  k,
  onNew,
}: {
  ws: Workspace;
  k: Workstream;
  onNew: () => void;
}) {
  const tasks = ws.tasks.filter((t) => t.workstream === k);
  const open = tasks.filter(isOpen);
  const suggested = tasks.filter((t) => t.status === "suggested");
  const finished = tasks.filter(
    (t) => t.status === "done" || t.status === "measured",
  );
  const owner = ws.settings.wsOwners[k];
  return (
    <>
      <Card>
        <div className="gw-row">
          <div>
            <p style={{ margin: 0 }}>
              <strong>Outcome:</strong> {WS[k].outcome}
            </p>
            <p className="muted small" style={{ margin: 0 }}>
              Owner:{" "}
              {owner ? <Person email={owner} /> : "not set (Growth settings)"} ·{" "}
              {open.length} open ·{" "}
              {tasks.filter((t) => t.status === "blocked").length} blocked ·{" "}
              {tasks.filter(isOverdue).length} overdue · {finished.length} done
            </p>
          </div>
          {can(ws, "growth.contribute") && (
            <button className="btn primary" onClick={onNew}>
              + New task
            </button>
          )}
        </div>
      </Card>
      <div className="stats">{STATS[k](ws)}</div>
      {k === "partners" && <Pipeline ws={ws} />}
      {k === "social" && <Calendar ws={ws} />}
      <div className="grid2">
        <Card title="Work">
          {open.length ? (
            open.map((t) => <TaskRow key={t.id} t={t} />)
          ) : (
            <Empty>No open work. Accept a suggestion or create a task.</Empty>
          )}
        </Card>
        <Card title="Suggested by the agent">
          {suggested.length ? (
            suggested.map((t) => <TaskRow key={t.id} t={t} />)
          ) : (
            <Empty>No suggestions waiting.</Empty>
          )}
        </Card>
      </div>
      {EVIDENCE[k]?.(ws)}
      <Card title="Finished work and results">
        {finished.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Finished</th>
                  <th>Metric</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {finished.map((t) => (
                  <tr
                    key={t.id}
                    className="gw-click"
                    onClick={() => openTask(t.id)}
                  >
                    <td>{t.title}</td>
                    <td className="muted">
                      {t.doneAt
                        ? new Date(t.doneAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })
                        : "—"}
                    </td>
                    <td className="muted small">{t.metric.label || "—"}</td>
                    <td>
                      {t.result ? (
                        <Chip
                          tone={VERDICT[t.result.verdict].tone}
                        >{`${VERDICT[t.result.verdict].label}${t.result.value ? `: ${t.result.value}` : ""}`}</Chip>
                      ) : (
                        <Chip>
                          measuring
                          {t.metric.checkOn
                            ? ` until ${shortDate(t.metric.checkOn)}`
                            : ""}
                        </Chip>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Finished tasks and what they achieved show here.</Empty>
        )}
      </Card>
    </>
  );
}

const STATS: Record<Workstream, (ws: Workspace) => ReactNode> = {
  launch: (ws) => {
    const o1 = ws.goals.find((g) => g.id === "O1");
    return (o1?.krs ?? []).map((k) => (
      <Stat
        key={k.id}
        label={k.label}
        value={`${fmt(k.current, k.unit)} / ${fmt(k.target, k.unit)}`}
        sub={k.source === "manual" ? "entered by a person" : "measured"}
      />
    ));
  },
  search: (ws) => (
    <>
      <Stat
        label="Search impressions, 28 days"
        value={fv(ws, "search.impressions")}
        sub={`${fv(ws, "search.clicks")} clicks`}
      />
      <Stat
        label="Pages indexed by Google"
        value={`${fv(ws, "search.indexed_pages")} / ${fv(ws, "search.sitemap_pages")}`}
      />
      <Stat
        label="Average position"
        value={fv(ws, "search.position")}
        sub="lower is better"
      />
      <Stat
        label="Visits from search, 30 days"
        value={fmt(
          (
            (ws.analytics.website?.sources ?? []) as {
              label: string;
              count: number;
            }[]
          )
            .filter((s) => /google|bing|duckduckgo|yahoo/.test(s.label))
            .reduce((a, s) => a + s.count, 0),
          "count",
        )}
      />
    </>
  ),
  social: (ws) => (
    <>
      <Stat
        label="Posts published, 30 days"
        value={
          ws.posts.filter(
            (p) =>
              p.status === "published" &&
              p.date >=
                new Date(Date.now() - 30 * 86_400_000)
                  .toISOString()
                  .slice(0, 10),
          ).length
        }
      />
      <Stat
        label="Posts planned"
        value={ws.posts.filter((p) => p.status !== "published").length}
        sub="ideas, drafts and approved"
      />
      <Stat
        label="Visits from posts"
        value={ws.posts.reduce((a, p) => a + p.visits, 0)}
        sub="through each post's tagged link"
      />
      <Stat
        label="Visits from social, 30 days"
        value={fmt(
          (
            (ws.analytics.website?.sources ?? []) as {
              label: string;
              count: number;
            }[]
          )
            .filter((s) =>
              /instagram|youtube|reddit|whatsapp|linkedin|facebook|t\.co|x\.com/.test(
                s.label,
              ),
            )
            .reduce((a, s) => a + s.count, 0),
          "count",
        )}
      />
    </>
  ),
  store: (ws) => (
    <>
      <Stat label="Website visits, 30 days" value={fv(ws, "web.visits_30d")} />
      <Stat label="Visits → Get Lens" value={fv(ws, "web.get_lens_rate")} />
      <Stat
        label="Engaged visits"
        value={fv(ws, "web.engaged_rate")}
        sub="2+ pages or 10+ seconds"
      />
      <Stat
        label="Play listing"
        value="—"
        sub="store visitors and ratings appear once Play reports are readable"
      />
    </>
  ),
  retain: (ws) => (
    <>
      <Stat
        label="Backed up a photo"
        value={fv(ws, "app.upload_rate")}
        sub="of installs, 30 days"
      />
      <Stat label="Signed in" value={fv(ws, "app.signin_rate")} />
      <Stat
        label="Came back 7+ days later"
        value={fv(ws, "app.came_back_7d_rate")}
      />
      <Stat label="Paying Plus users" value={fv(ws, "money.paying")} />
    </>
  ),
  loops: (ws) => (
    <>
      <Stat
        label="Made event albums"
        value={fv(ws, "loops.server_event_album")}
        sub="people, 30 days"
      />
      <Stat label="Joined an event album" value={fv(ws, "loops.event_join")} />
      <Stat label="Invited friends" value={fv(ws, "loops.server_invite")} />
      <Stat
        label="Made share links"
        value={fv(ws, "loops.server_share_link")}
      />
    </>
  ),
  partners: (ws) => (
    <>
      <Stat
        label="In the pipeline"
        value={
          ws.partners.filter((p) => !["won", "lost"].includes(p.stage)).length
        }
      />
      <Stat
        label="Pilots running"
        value={ws.partners.filter((p) => p.stage === "pilot").length}
      />
      <Stat
        label="Live partners"
        value={
          ws.partners.filter((p) => p.stage === "live" || p.stage === "won")
            .length
        }
        sub="90-day goal: 5"
      />
      <Stat
        label="Visits from partner links"
        value={ws.partners.reduce((a, p) => a + p.visits, 0)}
      />
    </>
  ),
};

const EVIDENCE: Partial<Record<Workstream, (ws: Workspace) => ReactNode>> = {
  search: (ws) => {
    const demand = ws.facts
      .filter((x) => x.id.startsWith("demand.bing.") && (x.value ?? 0) > 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const wiki = ws.facts.filter((x) => x.id.startsWith("demand.wiki."));
    return (
      <div className="grid2">
        <Card title="What people search for (Bing)">
          {demand.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Search</th>
                    <th className="num">12 weeks</th>
                    <th className="num">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {demand.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {d.label
                          .replace(/^Bing searches for /, "")
                          .replace(/ \(Bing only.*$/, "")}
                      </td>
                      <td className="num">{fmt(d.value, "count")}</td>
                      <td
                        className={`num ${(d.change ?? 0) > 0 ? "gw-good" : (d.change ?? 0) < 0 ? "gw-bad" : ""}`}
                      >
                        {d.change === null || d.change === undefined
                          ? "—"
                          : `${d.change > 0 ? "+" : ""}${Math.round(d.change * 100)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>Demand data arrives with the weekly analysis.</Empty>
          )}
          <p className="muted small">
            Real search counts on Bing only (small in India). Google Trends
            joins when the alpha API is approved.
          </p>
        </Card>
        <Card title="Long-term interest (Wikipedia views)">
          <ul className="gw-list">
            {wiki.map((w) => (
              <li key={w.id}>
                {w.label
                  .replace(/^Wikipedia views of /, "")
                  .replace(/ \(English.*$/, "")}
                : {fmt(w.value, "count")}{" "}
                {w.change !== null && w.change !== undefined && (
                  <span
                    className={w.change > 0 ? "gw-good" : "gw-bad"}
                  >{`${w.change > 0 ? "+" : ""}${Math.round(w.change * 100)}% a year`}</span>
                )}
              </li>
            ))}
          </ul>
          {(ws.report?.investigations ?? []).length > 0 && (
            <>
              <h3 className="small">This week's SEO investigations</h3>
              <ul className="gw-list">
                {(
                  ws.report!.investigations as {
                    title: string;
                    evidence: string;
                  }[]
                ).map((x, i) => (
                  <li key={i}>
                    {x.title} <Chip>{x.evidence}</Chip>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
    );
  },
  store: (ws) => {
    const landing = (ws.analytics.website?.landing ?? []) as {
      path: string;
      visits: number;
      engaged: number;
      getLens: number;
    }[];
    return (
      <Card title="Landing pages: what visits that start there do">
        {landing.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Landing page</th>
                  <th className="num">Visits</th>
                  <th className="num">Engaged</th>
                  <th className="num">Get Lens</th>
                </tr>
              </thead>
              <tbody>
                {landing.map((l) => (
                  <tr key={l.path}>
                    <td>{l.path}</td>
                    <td className="num">{l.visits}</td>
                    <td className="num">
                      {fmt(l.visits ? l.engaged / l.visits : null, "pct")}
                    </td>
                    <td className="num">
                      {fmt(l.visits ? l.getLens / l.visits : null, "pct")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Counted from 30 October; fills as visits arrive.</Empty>
        )}
      </Card>
    );
  },
  retain: (ws) => (
    <Card title="Funnel, installs in the last 30 days">
      <div className="table-wrap">
        <table>
          <tbody>
            {ws.analytics.funnel.map((s) => (
              <tr key={s.key}>
                <td>{s.label}</td>
                <td className="num">{s.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Retention by install channel is on the Analytics page.
      </p>
    </Card>
  ),
};

// ---------- partnerships pipeline ----------

const STAGES: { k: string; label: string }[] = [
  { k: "lead", label: "Lead" },
  { k: "contacted", label: "Contacted" },
  { k: "meeting", label: "Meeting" },
  { k: "pilot", label: "Pilot" },
  { k: "live", label: "Live" },
  { k: "won", label: "Won" },
  { k: "lost", label: "Lost" },
];

function Pipeline({ ws }: { ws: Workspace }) {
  const [edit, setEdit] = useState<Partner | "new" | null>(null);
  return (
    <Card
      title="Pipeline"
      actions={
        can(ws, "growth.contribute") && (
          <button className="btn" onClick={() => setEdit("new")}>
            + Add partner
          </button>
        )
      }
    >
      <div className="gw-board">
        {STAGES.map((s) => {
          const ps = ws.partners.filter((p) => p.stage === s.k);
          return (
            <div key={s.k} className="gw-col">
              <h3>
                {s.label}
                <span>{ps.length}</span>
              </h3>
              {ps.map((p) => (
                <button
                  key={p.id}
                  className="gw-card"
                  onClick={() => setEdit(p)}
                >
                  <span className="gw-task-title">{p.name}</span>
                  <span className="muted small">
                    {p.type}
                    {p.city ? ` · ${p.city}` : ""}
                  </span>
                  {p.nextStep && (
                    <span className="small">
                      Next: {p.nextStep}
                      {p.nextDate ? ` · ${shortDate(p.nextDate)}` : ""}
                    </span>
                  )}
                  <span className="gw-row">
                    <Person email={p.owner} small />
                    <span className="muted small">{p.visits} visits</span>
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {!ws.partners.length && (
        <Empty>
          No partners yet. Add photographers, planners, colleges or creators you
          want to work with.
        </Empty>
      )}
      {edit && (
        <PartnerForm
          ws={ws}
          p={edit === "new" ? undefined : edit}
          onDone={() => setEdit(null)}
        />
      )}
    </Card>
  );
}

function PartnerForm({
  ws,
  p,
  onDone,
}: {
  ws: Workspace;
  p?: Partner;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    name: p?.name ?? "",
    type: p?.type ?? "photographer",
    city: p?.city ?? "",
    contact: p?.contact ?? "",
    stage: p?.stage ?? "lead",
    value: p?.value ?? "",
    nextStep: p?.nextStep ?? "",
    nextDate: p?.nextDate ?? "",
    owner: p?.owner ?? ws.me.email,
    notes: p?.notes ?? "",
    lostReason: p?.lostReason ?? "",
  });
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await api("PUT", `/growth/partners/${p?.id ?? "new"}`, v);
      onDone();
      dispatchEvent(new Event("growth-reload"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <>
      <div className="gw-scrim" onClick={onDone} />
      <aside className="gw-drawer" aria-label="Partner">
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">{p ? p.name : "New partner"}</h2>
          <button className="btn ghost" onClick={onDone}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {p && (
          <div className="gw-callout">
            <strong>Their tagged link</strong> (visits are counted: {p.visits}{" "}
            so far)
            <input
              readOnly
              value={p.link}
              onFocus={(e) => e.target.select()}
              aria-label="Partner link"
            />
          </div>
        )}
        <div className="gw-form">
          <label className="gw-field">
            <span>Name</span>
            <input value={v.name} onChange={set("name")} />
          </label>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Type</span>
              <select value={v.type} onChange={set("type")}>
                {[
                  "photographer",
                  "planner",
                  "venue",
                  "college",
                  "influencer",
                  "company",
                  "community",
                  "other",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>City</span>
              <input value={v.city} onChange={set("city")} />
            </label>
            <label className="gw-field">
              <span>Stage</span>
              <select value={v.stage} onChange={set("stage")}>
                {STAGES.map((s) => (
                  <option key={s.k} value={s.k}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="gw-field">
            <span>Contact (name, phone or email)</span>
            <input value={v.contact} onChange={set("contact")} />
          </label>
          <label className="gw-field">
            <span>What it's worth (events a month, audience, deal)</span>
            <input value={v.value} onChange={set("value")} />
          </label>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Next step</span>
              <input value={v.nextStep} onChange={set("nextStep")} />
            </label>
            <label className="gw-field">
              <span>By</span>
              <input
                type="date"
                value={v.nextDate}
                onChange={set("nextDate")}
              />
            </label>
          </div>
          <label className="gw-field">
            <span>Owner</span>
            <select value={v.owner} onChange={set("owner")}>
              <option value="">Unassigned</option>
              {ws.team.map((m) => (
                <option key={m.email}>{m.email}</option>
              ))}
            </select>
          </label>
          <label className="gw-field">
            <span>Notes</span>
            <textarea rows={4} value={v.notes} onChange={set("notes")} />
          </label>
          {v.stage === "lost" && (
            <label className="gw-field">
              <span>Why lost</span>
              <input value={v.lostReason} onChange={set("lostReason")} />
            </label>
          )}
          <div className="btns">
            <button
              className="btn primary"
              disabled={!v.name.trim()}
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ---------- social calendar ----------

const CHANNELS = [
  "instagram",
  "youtube",
  "reddit",
  "whatsapp",
  "linkedin",
  "x",
  "facebook",
  "blog",
  "other",
];

function Calendar({ ws }: { ws: Workspace }) {
  const [edit, setEdit] = useState<Post | "new" | null>(null);
  const start = new Date();
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 14 }, (_, i) =>
    new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  );
  const undated = ws.posts.filter((p) => !p.date);
  return (
    <Card
      title="Calendar: this week and next"
      actions={
        can(ws, "growth.contribute") && (
          <button className="btn" onClick={() => setEdit("new")}>
            + New post
          </button>
        )
      }
    >
      <div className="gw-cal">
        {days.map((d) => (
          <div
            key={d}
            className={`gw-day ${d === new Date().toISOString().slice(0, 10) ? "today" : ""}`}
          >
            <b>
              {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
                weekday: "short",
                day: "numeric",
              })}
            </b>
            {ws.posts
              .filter((p) => p.date === d)
              .map((p) => (
                <button
                  key={p.id}
                  className={`gw-post ${p.channel}`}
                  onClick={() => setEdit(p)}
                >
                  <strong>{p.channel}</strong>
                  <span>{p.title || p.body.slice(0, 50)}</span>
                  <span className="small">
                    {p.status}
                    {p.visits ? ` · ${p.visits} visits` : ""}
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>
      {undated.length > 0 && (
        <p className="small">
          Ideas without a date:{" "}
          {undated.map((p) => (
            <button
              key={p.id}
              className="gw-linkbtn"
              onClick={() => setEdit(p)}
            >
              {p.title || p.channel}
            </button>
          ))}
        </p>
      )}
      <p className="muted small">
        Every post gets a tagged link, so its visits are counted. The agent
        drafts posts; a person reviews and posts them.
      </p>
      {edit && (
        <PostForm
          ws={ws}
          p={edit === "new" ? undefined : edit}
          onDone={() => setEdit(null)}
        />
      )}
    </Card>
  );
}

function PostForm({
  ws,
  p,
  onDone,
}: {
  ws: Workspace;
  p?: Post;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    channel: p?.channel ?? "instagram",
    date: p?.date ?? "",
    title: p?.title ?? "",
    body: p?.body ?? "",
    status: p?.status ?? "idea",
    url: p?.url ?? "",
    page: p?.page ?? "/",
    owner: p?.owner ?? ws.me.email,
  });
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await api("PUT", `/growth/posts/${p?.id ?? "new"}`, v);
      onDone();
      dispatchEvent(new Event("growth-reload"));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  return (
    <>
      <div className="gw-scrim" onClick={onDone} />
      <aside className="gw-drawer" aria-label="Post">
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">{p ? "Post" : "New post"}</h2>
          <button className="btn ghost" onClick={onDone}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {p && (
          <div className="gw-callout">
            <strong>Link to use in the post</strong> ({p.visits} visits so far)
            <input
              readOnly
              value={p.link}
              onFocus={(e) => e.target.select()}
              aria-label="Post link"
            />
          </div>
        )}
        <div className="gw-form">
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Channel</span>
              <select value={v.channel} onChange={set("channel")}>
                {CHANNELS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>Date</span>
              <input type="date" value={v.date} onChange={set("date")} />
            </label>
            <label className="gw-field">
              <span>Status</span>
              <select value={v.status} onChange={set("status")}>
                {["idea", "drafted", "approved", "published"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="gw-field">
            <span>Title</span>
            <input value={v.title} onChange={set("title")} />
          </label>
          <label className="gw-field">
            <span>Post text</span>
            <textarea rows={7} value={v.body} onChange={set("body")} />
          </label>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Website page it links to</span>
              <input value={v.page} onChange={set("page")} />
            </label>
            <label className="gw-field">
              <span>Published post URL</span>
              <input value={v.url} onChange={set("url")} />
            </label>
          </div>
          <div className="btns">
            <button
              className="btn primary"
              disabled={!v.title.trim() && !v.body.trim()}
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

export { openTask };
