// SEO tools: tracked keywords, technical audit, page speed, backlinks and link building.
import { useState } from "react";

import { api, get } from "../../api";
import { Card, date, Empty, Loaded, Stat, useLoad } from "../../ui";
import { useGrowthReload, useJobs } from "./jobs";
import {
  can,
  CardTable,
  Chip,
  Person,
  Sparkline,
  type Workspace,
} from "./shared";

type Issue = {
  code: string;
  severity: "error" | "warn" | "info";
  message: string;
};
type Seo = {
  keywords: {
    keyword: string;
    page: string;
    google: {
      impressions: number;
      clicks: number;
      position: number | null;
    } | null;
    weekly: (number | null)[];
    bing: { position: number; impressions: number } | null;
  }[];
  queries: {
    query: string;
    clicks: number;
    impressions: number;
    position: number | null;
  }[];
  audit: null | {
    at: number;
    pages: {
      path: string;
      status: number;
      title: string;
      description: string;
      words: number;
      issues: Issue[];
      bytes: number;
      ms: number;
    }[];
    speed: {
      path: string;
      strategy: string;
      scores: Record<string, number>;
      lcp?: string;
      cls?: string;
      tbt?: string;
      fcp?: string;
      field?: Record<string, string>;
    }[];
    links: {
      counts: { page: string; count: number }[];
      linking: { page: string; from: string; anchor: string }[];
    };
    notes: string[];
    summary: {
      pages: number;
      errors: number;
      warnings: number;
      score: number;
      brokenLinks: number;
      backlinks: number;
    };
  };
  history: { sk: string; score: number; errors: number; warnings: number }[];
  prospects: {
    id: string;
    site: string;
    url: string;
    type: string;
    how: string;
    status: string;
    owner: string;
    notes: string;
    linkFound: boolean;
    checkedAt?: number;
  }[];
};
type Tab = "keywords" | "audit" | "meta" | "speed" | "links";
const TONE: Record<string, "bad" | "warn" | "plain"> = {
  error: "bad",
  warn: "warn",
  info: "plain",
};
const LABEL: Record<string, string> = {
  status: "Page doesn't load (error status)",
  redirect: "Sitemap lists a redirect",
  "title-missing": "No title",
  "title-long": "Title too long (over 60 characters)",
  "title-short": "Title very short",
  "description-missing": "No meta description",
  "description-long": "Description too long (over 155 characters)",
  "description-short": "Description short (under 70 characters)",
  "h1-missing": "No H1 heading",
  "h1-many": "More than one H1",
  noindex: "Tells Google not to index it",
  "canonical-missing": "No canonical link",
  "canonical-other": "Canonical points to another page",
  "lang-missing": "No language set",
  "hreflang-missing": "Language alternates missing",
  "jsonld-missing": "No structured data",
  "og-image-missing": "No social preview image",
  thin: "Thin page (under 300 words)",
  "img-alt": "Images without alt text",
  "broken-links": "Links to missing pages",
  "not-indexed": "Not indexed by Google yet",
  fetch: "Couldn't load the page",
};

export function SeoTools({
  ws,
  search,
}: {
  ws: Workspace;
  search: URLSearchParams;
}) {
  const [tab, setTab] = useState<Tab>((search.get("tab") as Tab) || "keywords");
  const [n, setN] = useState(0);
  const reloadKey = useGrowthReload();
  const state = useLoad(() => get<Seo>("/growth/seo"), [n, reloadKey]);
  const reload = () => setN((x) => x + 1);
  return (
    <>
      <div className="tabs" role="tablist">
        {(
          [
            ["keywords", "Keywords"],
            ["audit", "Technical audit"],
            ["meta", "Titles & descriptions"],
            ["speed", "Speed"],
            ["links", "Backlinks & link building"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? "tab on" : "tab"}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      <Loaded state={state}>
        {(s) => (
          <>
            {tab === "keywords" && (
              <Keywords ws={ws} s={s} onChanged={reload} />
            )}
            {tab === "audit" && <Audit ws={ws} s={s} />}
            {tab === "meta" && <MetaEditor ws={ws} s={s} />}
            {tab === "speed" && <Speed s={s} />}
            {tab === "links" && <Links ws={ws} s={s} onChanged={reload} />}
          </>
        )}
      </Loaded>
    </>
  );
}

function Keywords({
  ws,
  s,
  onChanged,
}: {
  ws: Workspace;
  s: Seo;
  onChanged: () => void;
}) {
  const [kw, setKw] = useState("");
  const add = async () => {
    await api("PUT", "/growth/keywords", { keyword: kw }).catch((e: Error) =>
      alert(e.message),
    );
    setKw("");
    onChanged();
  };
  const remove = async (keyword: string) => {
    await api("DELETE", "/growth/keywords", { keyword }).catch((e: Error) =>
      alert(e.message),
    );
    onChanged();
  };
  const demand = (k: string) =>
    ws.facts.filter(
      (f) =>
        f.id.startsWith("demand.bing.") &&
        f.label.toLowerCase().includes(`"${k}"`),
    );
  return (
    <>
      <Card
        title="Tracked keywords"
        actions={
          can(ws, "growth.contribute") && (
            <span className="btns">
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="Add a keyword"
                aria-label="Keyword to track"
                onKeyDown={(e) => e.key === "Enter" && kw.trim() && void add()}
              />
              <button
                className="btn"
                disabled={!kw.trim()}
                onClick={() => void add()}
              >
                Track
              </button>
            </span>
          )
        }
      >
        <CardTable>
          <table>
            <thead>
              <tr>
                <th>Keyword</th>
                <th className="num">Google position</th>
                <th>12 weeks</th>
                <th className="num">Impressions, 28 d</th>
                <th className="num">Clicks</th>
                <th className="num">Bing position</th>
                <th className="num">Bing searches, 12 wk</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.keywords
                .sort(
                  (a, b) =>
                    (b.google?.impressions ?? 0) - (a.google?.impressions ?? 0),
                )
                .map((k) => (
                  <tr key={k.keyword}>
                    <td>{k.keyword}</td>
                    <td className="num">{k.google?.position ?? "—"}</td>
                    <td style={{ width: 120 }}>
                      {k.weekly.some((x) => x !== null) ? (
                        <Sparkline
                          values={k.weekly.map((x) =>
                            x === null ? 0 : 100 - x,
                          )}
                        />
                      ) : (
                        <span className="muted small">not ranking yet</span>
                      )}
                    </td>
                    <td className="num">{k.google?.impressions ?? 0}</td>
                    <td className="num">{k.google?.clicks ?? 0}</td>
                    <td className="num">
                      {k.bing?.position ? k.bing.position.toFixed(1) : "—"}
                    </td>
                    <td className="num small">
                      {demand(k.keyword)
                        .map(
                          (d) =>
                            `${d.id.split(".")[2].toUpperCase()} ${d.value?.toLocaleString("en-IN")}`,
                        )
                        .join(" · ") || "—"}
                    </td>
                    <td>
                      {can(ws, "growth.contribute") && (
                        <button
                          className="btn ghost small"
                          onClick={() => void remove(k.keyword)}
                          aria-label={`Stop tracking ${k.keyword}`}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </CardTable>
        <p className="muted small">
          Google position = average position in results over 28 days (lower is
          better), from Search Console's daily data. A keyword shows once Google
          shows Lens for it. Bing searches = demand in India (IN) and the US.
        </p>
      </Card>
      <Card
        title={`Every search Google showed Lens for (28 days): ${s.queries.length}`}
      >
        {s.queries.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Search</th>
                  <th className="num">Impressions</th>
                  <th className="num">Clicks</th>
                  <th className="num">Position</th>
                </tr>
              </thead>
              <tbody>
                {s.queries.slice(0, 50).map((q) => (
                  <tr key={q.query}>
                    <td>{q.query}</td>
                    <td className="num">{q.impressions}</td>
                    <td className="num">{q.clicks}</td>
                    <td className="num">{q.position ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            Google hasn't shown Lens in any search yet. Pages were indexed on
            29–30 October; impressions usually start within a few weeks.
          </Empty>
        )}
      </Card>
    </>
  );
}

function AuditRun({ ws, at }: { ws: Workspace; at?: number }) {
  const [busy, setBusy] = useState(false);
  const { jobs, refresh } = useJobs();
  if (!can(ws, "growth.write")) return null;
  return (
    <button
      className="btn"
      disabled={busy || !!jobs.seoAudit}
      onClick={() => {
        setBusy(true);
        void api("POST", "/growth/seo/audit")
          .then(refresh)
          .catch((e: Error) => alert(e.message))
          .finally(() => setBusy(false));
      }}
    >
      {jobs.seoAudit
        ? "Audit running…"
        : at
          ? "Run audit again"
          : "Run the first audit"}
    </button>
  );
}

function Audit({ ws, s }: { ws: Workspace; s: Seo }) {
  const [only, setOnly] = useState<"all" | "error" | "warn">("all");
  const a = s.audit;
  if (!a)
    return (
      <Card>
        <Empty>
          No audit yet. It runs every Monday with the analysis.{" "}
          <AuditRun ws={ws} />
        </Empty>
      </Card>
    );
  const byCode = new Map<
    string,
    { severity: string; pages: string[]; message: string }
  >();
  for (const p of a.pages)
    for (const i of p.issues) {
      const e = byCode.get(i.code) ?? {
        severity: i.severity,
        pages: [],
        message: i.message,
      };
      e.pages.push(p.path);
      byCode.set(i.code, e);
    }
  const makeTask = async (
    code: string,
    e: { severity: string; pages: string[]; message: string },
  ) => {
    try {
      const r = await api<{ task: { id: string } }>("POST", "/growth/tasks", {
        title:
          `Fix SEO: ${(LABEL[code] ?? e.message).toLowerCase()} on ${e.pages.length} page${e.pages.length > 1 ? "s" : ""}`.slice(
            0,
            160,
          ),
        description: `From the technical audit (${date(a.at)}): ${e.message}\n\nPages:\n${e.pages.join("\n")}`,
        workstream: "search",
        type: "fix",
        impact: e.severity === "error" ? 3 : 2,
        confidence: 3,
        effortHours: Math.min(16, 1 + Math.ceil(e.pages.length / 4)),
        metric: {
          label: `Technical SEO ${e.severity === "error" ? "errors" : "warnings"} (${code})`,
          fact:
            e.severity === "error" ? "seo.audit_errors" : "seo.audit_warnings",
          baseline: String(
            e.severity === "error" ? a.summary.errors : a.summary.warnings,
          ),
          baselineAt: new Date().toISOString().slice(0, 10),
          target: "0",
          checkOn: "",
        },
      });
      location.assign(`/growth/tasks?task=${r.task.id}`);
    } catch (err) {
      alert((err as Error).message);
    }
  };
  const pages = a.pages.filter(
    (p) => only === "all" || p.issues.some((i) => i.severity === only),
  );
  return (
    <>
      <div className="stats">
        <Stat
          label="SEO health"
          value={`${a.summary.score} / 100`}
          sub={
            s.history.length > 1
              ? `was ${s.history[s.history.length - 2].score}`
              : "first audit"
          }
        />
        <Stat
          label="Errors"
          value={a.summary.errors}
          sub="cost rankings: fix first"
        />
        <Stat label="Warnings" value={a.summary.warnings} />
        <Stat
          label="Pages checked"
          value={a.summary.pages}
          sub={`${a.summary.brokenLinks} broken internal links · ${date(a.at)}`}
        />
      </div>
      <Card title="Issues by type" actions={<AuditRun ws={ws} at={a.at} />}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Issue</th>
                <th className="num">Pages</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...byCode.entries()]
                .sort(
                  (x, y) =>
                    ["error", "warn", "info"].indexOf(x[1].severity) -
                      ["error", "warn", "info"].indexOf(y[1].severity) ||
                    y[1].pages.length - x[1].pages.length,
                )
                .map(([code, e]) => (
                  <tr key={code}>
                    <td>
                      <Chip tone={TONE[e.severity]}>{e.severity}</Chip>{" "}
                      {LABEL[code] ?? e.message}
                    </td>
                    <td className="num">{e.pages.length}</td>
                    <td>
                      {can(ws, "growth.contribute") &&
                        e.severity !== "info" && (
                          <button
                            className="btn ghost small"
                            onClick={() => void makeTask(code, e)}
                          >
                            Make it a task
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {a.notes.map((n) => (
          <p key={n} className="muted small">
            {n}
          </p>
        ))}
      </Card>
      <Card
        title="Every page"
        actions={
          <span className="chips">
            {(["all", "error", "warn"] as const).map((k) => (
              <button
                key={k}
                className={`chip ${only === k ? "on" : ""}`}
                onClick={() => setOnly(k)}
              >
                {k === "all"
                  ? "All"
                  : k === "error"
                    ? "With errors"
                    : "With warnings"}
              </button>
            ))}
          </span>
        }
      >
        <CardTable>
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Title</th>
                <th className="num">Words</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.path}>
                  <td>
                    <a
                      href={`https://lens.instagrowapp.com${p.path}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {p.path}
                    </a>
                  </td>
                  <td className="small">
                    {p.title} <span className="muted">({p.title.length})</span>
                  </td>
                  <td className="num">{p.words}</td>
                  <td className="small">
                    {p.issues.length ? (
                      p.issues.map((i) => (
                        <div key={i.code}>
                          <Chip tone={TONE[i.severity]}>{i.severity}</Chip>{" "}
                          {i.message}
                        </div>
                      ))
                    ) : (
                      <Chip tone="good">OK</Chip>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardTable>
      </Card>
    </>
  );
}

/** Edit page titles and descriptions; the agent turns them into one pull request for review. */
function MetaEditor({ ws, s }: { ws: Workspace; s: Seo }) {
  const [edits, setEdits] = useState<
    Record<string, { title: string; description: string }>
  >({});
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const a = s.audit;
  if (!a)
    return (
      <Card>
        <Empty>
          Run the technical audit first: it reads every page’s title and
          description.
        </Empty>
      </Card>
    );
  const edit = can(ws, "growth.contribute");
  const pages = a.pages.filter(
    (p) => p.status === 200 && p.path.includes(filter.trim()),
  );
  const changed = Object.entries(edits).filter(([path, e]) => {
    const p = a.pages.find((x) => x.path === path);
    return p && (e.title !== p.title || e.description !== p.description);
  });
  const set = (path: string, k: "title" | "description", v: string) => {
    const p = a.pages.find((x) => x.path === path)!;
    setEdits({
      ...edits,
      [path]: {
        title: edits[path]?.title ?? p.title,
        description: edits[path]?.description ?? p.description,
        [k]: v,
      },
    });
  };
  const count = (v: string, lo: number, hi: number) => (
    <span
      className={`small ${v.length < lo || v.length > hi ? "gw-bad" : "muted"}`}
    >
      {v.length}/{hi}
    </span>
  );
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ task: { id: string } }>(
        "POST",
        "/growth/seo/meta",
        {
          changes: changed.map(([path, e]) => {
            const p = a.pages.find((x) => x.path === path)!;
            return {
              path,
              title: e.title !== p.title ? e.title : "",
              description: e.description !== p.description ? e.description : "",
              oldTitle: p.title,
              oldDescription: p.description,
            };
          }),
        },
      );
      location.assign(`/growth/tasks?task=${r.task.id}`);
    } catch (e) {
      alert((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Card
      title="Titles & descriptions"
      actions={
        <span className="btns">
          <input
            placeholder="Filter pages"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter pages"
          />
          {edit && (
            <button
              className="btn primary"
              disabled={!changed.length || busy}
              onClick={() => void submit()}
            >
              Send {changed.length || ""} change
              {changed.length === 1 ? "" : "s"} to the agent
            </button>
          )}
        </span>
      }
    >
      <p className="muted small">
        Titles 15–60 characters, descriptions 70–155. Changes become one task;
        the agent edits the site’s content files and opens a pull request that
        someone reviews and merges. Nothing changes on the website until then.
      </p>
      <CardTable>
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th>Title</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => {
              const e = edits[p.path] ?? {
                title: p.title,
                description: p.description,
              };
              return (
                <tr key={p.path}>
                  <td className="small">{p.path}</td>
                  <td>
                    <input
                      className="gw-meta-in"
                      value={e.title}
                      disabled={!edit}
                      onChange={(x) => set(p.path, "title", x.target.value)}
                      aria-label={`Title of ${p.path}`}
                    />
                    {count(e.title, 15, 60)}
                  </td>
                  <td>
                    <textarea
                      className="gw-meta-in"
                      rows={2}
                      value={e.description}
                      disabled={!edit}
                      onChange={(x) =>
                        set(p.path, "description", x.target.value)
                      }
                      aria-label={`Description of ${p.path}`}
                    />
                    {count(e.description, 70, 155)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardTable>
    </Card>
  );
}

function Speed({ s }: { s: Seo }) {
  const sp = s.audit?.speed ?? [];
  if (!sp.length)
    return (
      <Card>
        <Empty>
          {s.audit?.notes.find((n) => n.includes("speed")) ??
            "Speed checks run with the weekly audit."}
        </Empty>
      </Card>
    );
  const tone = (v: number) => (v >= 90 ? "good" : v >= 50 ? "warn" : "bad");
  return (
    <Card title={`Page speed and Core Web Vitals · ${date(s.audit!.at)}`}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Page</th>
              <th>Device</th>
              <th className="num">Performance</th>
              <th className="num">SEO</th>
              <th className="num">Accessibility</th>
              <th className="num">Best practices</th>
              <th>LCP</th>
              <th>CLS</th>
              <th>Blocking</th>
              <th>Real users</th>
            </tr>
          </thead>
          <tbody>
            {sp.map((x) => (
              <tr key={x.path + x.strategy}>
                <td>{x.path}</td>
                <td className="muted">{x.strategy}</td>
                {["performance", "seo", "accessibility", "best-practices"].map(
                  (k) => (
                    <td key={k} className="num">
                      <Chip tone={tone(x.scores[k] ?? 0)}>
                        {x.scores[k] ?? "—"}
                      </Chip>
                    </td>
                  ),
                )}
                <td>{x.lcp ?? "—"}</td>
                <td>{x.cls ?? "—"}</td>
                <td>{x.tbt ?? "—"}</td>
                <td className="small muted">
                  {x.field
                    ? Object.entries(x.field)
                        .map(
                          ([k, v]) =>
                            `${k.replace(/_/g, " ").toLowerCase()}: ${v.toLowerCase()}`,
                        )
                        .join(" · ")
                    : "not enough visitors yet"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Lab scores from Google PageSpeed Insights (Lighthouse). Google ranks on
        real-user Core Web Vitals, which appear once the site has enough Chrome
        visitors. LCP under 2.5 s and CLS under 0.1 are "good".
      </p>
    </Card>
  );
}

const STAGES = ["idea", "contacted", "submitted", "live", "rejected"];

function Links({
  ws,
  s,
  onChanged,
}: {
  ws: Workspace;
  s: Seo;
  onChanged: () => void;
}) {
  const [edit, setEdit] = useState<Seo["prospects"][number] | "new" | null>(
    null,
  );
  const linking = s.audit?.links.linking ?? [];
  return (
    <>
      <div className="stats">
        <Stat
          label="Links found by Bing"
          value={s.audit?.summary.backlinks ?? 0}
        />
        <Stat
          label="Link building: live"
          value={s.prospects.filter((p) => p.status === "live").length}
          sub="checked weekly on their page"
        />
        <Stat
          label="In progress"
          value={
            s.prospects.filter((p) =>
              ["contacted", "submitted"].includes(p.status),
            ).length
          }
        />
        <Stat
          label="Ideas"
          value={s.prospects.filter((p) => p.status === "idea").length}
        />
      </div>
      <Card
        title="Link building"
        actions={
          can(ws, "growth.contribute") && (
            <button className="btn" onClick={() => setEdit("new")}>
              + Add a place
            </button>
          )
        }
      >
        <div className="gw-board">
          {STAGES.map((st) => (
            <div key={st} className="gw-col">
              <h3>
                {st}
                <span>{s.prospects.filter((p) => p.status === st).length}</span>
              </h3>
              {s.prospects
                .filter((p) => p.status === st)
                .map((p) => (
                  <button
                    key={p.id}
                    className="gw-card"
                    onClick={() => setEdit(p)}
                  >
                    <span className="gw-task-title">{p.site}</span>
                    <span className="muted small">{p.type}</span>
                    {p.status === "live" && <Chip tone="good">link found</Chip>}
                    <Person email={p.owner} small />
                  </button>
                ))}
            </div>
          ))}
        </div>
        <p className="muted small">
          Each place has how to get listed. When you mark one "submitted", the
          weekly audit opens its page and moves it to "live" once it links to
          lens.instagrowapp.com.
        </p>
      </Card>
      <Card title="Who links to us (Bing)">
        {linking.length ? (
          <ul className="gw-list">
            {linking.map((l, i) => (
              <li key={i}>
                <a href={l.from} target="_blank" rel="noreferrer">
                  {l.from}
                </a>{" "}
                → {l.page} <span className="muted small">“{l.anchor}”</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>
            Bing hasn't found links to the site yet. Listings from the
            link-building board are the fastest way to get the first ones.
          </Empty>
        )}
      </Card>
      {edit && (
        <ProspectForm
          ws={ws}
          p={edit === "new" ? undefined : edit}
          onDone={() => (setEdit(null), onChanged())}
        />
      )}
    </>
  );
}

function ProspectForm({
  ws,
  p,
  onDone,
}: {
  ws: Workspace;
  p?: Seo["prospects"][number];
  onDone: () => void;
}) {
  const [v, setV] = useState({
    site: p?.site ?? "",
    url: p?.url ?? "",
    type: p?.type ?? "directory",
    how: p?.how ?? "",
    status: p?.status ?? "idea",
    owner: p?.owner ?? ws.me.email,
    notes: p?.notes ?? "",
  });
  const [error, setError] = useState("");
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  const save = async () => {
    try {
      await api("PUT", `/growth/prospects/${p?.id ?? "new"}`, v);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <div className="gw-scrim" onClick={onDone} />
      <aside className="gw-drawer" aria-label="Link building place">
        <div className="gw-drawer-head">
          <h2 className="gw-drawer-title">
            {p ? p.site : "New place to get a link"}
          </h2>
          <button className="btn ghost" onClick={onDone}>
            Close
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {p?.checkedAt && (
          <div className="gw-callout">
            Last checked {date(p.checkedAt)}:{" "}
            {p.linkFound
              ? "a link to Lens is on the page."
              : "no link to Lens on the page yet."}
          </div>
        )}
        <div className="gw-form">
          <label className="gw-field">
            <span>Site</span>
            <input value={v.site} onChange={set("site")} />
          </label>
          <label className="gw-field">
            <span>Page where the link should appear (https://…)</span>
            <input value={v.url} onChange={set("url")} />
          </label>
          <div className="gw-form-row">
            <label className="gw-field">
              <span>Type</span>
              <select value={v.type} onChange={set("type")}>
                {[
                  "directory",
                  "community",
                  "launch",
                  "press",
                  "partner",
                  "guest-post",
                  "other",
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>Status</span>
              <select value={v.status} onChange={set("status")}>
                {STAGES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="gw-field">
              <span>Owner</span>
              <select value={v.owner} onChange={set("owner")}>
                <option value="">Unassigned</option>
                {ws.team.map((m) => (
                  <option key={m.email}>{m.email}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="gw-field">
            <span>How to get listed</span>
            <textarea rows={3} value={v.how} onChange={set("how")} />
          </label>
          <label className="gw-field">
            <span>Notes</span>
            <textarea rows={3} value={v.notes} onChange={set("notes")} />
          </label>
          <div className="btns">
            <button
              className="btn primary"
              disabled={!v.site.trim()}
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
