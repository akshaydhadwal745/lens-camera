// Website analytics (GA4), the content calendar and account integrations (growth workspace, groups 4–5).
import { useState } from "react";

import { get } from "../../api";
import {
  Breakdown,
  Card,
  DailyBars,
  date,
  Empty,
  Loaded,
  Stat,
  useLoad,
} from "../../ui";
import { Chip, openTask } from "./shared";

type Row = Record<string, string | number>;
type Ga4 =
  | { connected: false }
  | {
      connected: true;
      at: number;
      daily: Row[];
      channels: Row[];
      landing: Row[];
      countries: Row[];
      devices: Row[];
      events: Row[];
    };

const num = (v: unknown) => Number(v ?? 0);
const pct = (v: unknown) => `${Math.round(num(v) * 100)}%`;
const day = (d: unknown) =>
  String(d).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");

export function Ga4Page() {
  const state = useLoad(() => get<Ga4>("/growth/ga4"), []);
  return (
    <Loaded state={state}>
      {(g) =>
        !g.connected ? (
          <Card>
            <Empty>
              Google Analytics data arrives with the next daily run (about 03:00
              IST). It counts only visitors who allow analytics on the website;
              our own website analytics (Analytics page) counts everyone.
            </Empty>
          </Card>
        ) : (
          <>
            <div className="stats">
              <Stat
                label="Sessions (28 days)"
                value={g.daily.reduce((s, r) => s + num(r.sessions), 0)}
              />
              <Stat
                label="Users"
                value={g.daily.reduce((s, r) => s + num(r.totalUsers), 0)}
              />
              <Stat
                label="Engaged sessions"
                value={g.daily.reduce((s, r) => s + num(r.engagedSessions), 0)}
              />
              <Stat
                label="Key events"
                value={g.daily.reduce((s, r) => s + num(r.keyEvents), 0)}
                sub="Play Store clicks, sign-ups…"
              />
            </div>
            <Card title={`Google Analytics · updated ${date(g.at)}`}>
              <DailyBars
                label="Sessions"
                days={28}
                data={g.daily.map((r) => ({
                  day: day(r.date),
                  count: num(r.sessions),
                }))}
              />
              <div className="grid3">
                <div>
                  <h3 className="small">Channels</h3>
                  <Breakdown
                    rows={g.channels.map((r) => ({
                      label: String(r.sessionDefaultChannelGroup),
                      count: num(r.sessions),
                    }))}
                  />
                </div>
                <div>
                  <h3 className="small">Countries</h3>
                  <Breakdown
                    rows={g.countries.map((r) => ({
                      label: String(r.country),
                      count: num(r.sessions),
                    }))}
                  />
                </div>
                <div>
                  <h3 className="small">Devices</h3>
                  <Breakdown
                    rows={g.devices.map((r) => ({
                      label: String(r.deviceCategory),
                      count: num(r.sessions),
                    }))}
                  />
                </div>
              </div>
            </Card>
            <Card title="Landing pages">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Page</th>
                      <th className="num">Sessions</th>
                      <th className="num">Engaged</th>
                      <th className="num">Avg time</th>
                      <th className="num">Key events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.landing.map((r) => (
                      <tr key={String(r.landingPage)}>
                        <td>{String(r.landingPage) || "(not set)"}</td>
                        <td className="num">{num(r.sessions)}</td>
                        <td className="num">{pct(r.engagementRate)}</td>
                        <td className="num">
                          {Math.round(num(r.averageSessionDuration))}s
                        </td>
                        <td className="num">{num(r.keyEvents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Events">
              <Breakdown
                rows={g.events.map((r) => ({
                  label: String(r.eventName),
                  count: num(r.eventCount),
                }))}
              />
            </Card>
          </>
        )
      }
    </Loaded>
  );
}

type CalItem = {
  date: string;
  kind: "task" | "post" | "partner" | "campaign-start" | "campaign-end";
  id: string;
  title: string;
  status: string;
  owner: string;
  channel?: string;
};
type Cal = {
  month: string;
  items: CalItem[];
  undated: { id: string; title: string; status: string; owner: string }[];
  ideas: { id: string; title: string; status: string; channel: string }[];
};
const KIND: Record<CalItem["kind"], string> = {
  task: "Task",
  post: "Post",
  partner: "Partner",
  "campaign-start": "Campaign",
  "campaign-end": "Campaign",
};

const shift = (month: string, by: number) => {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};

export function ContentCalendar() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [contentOnly, setContentOnly] = useState(false);
  const state = useLoad(
    () =>
      get<Cal>(
        `/growth/calendar?month=${month}${contentOnly ? "&content=1" : ""}`,
      ),
    [month, contentOnly],
  );
  const open = (i: CalItem) =>
    i.kind === "task"
      ? openTask(i.id)
      : i.kind === "post" || i.kind === "partner"
        ? location.assign(
            `/growth/ws/${i.kind === "post" ? "social" : "partners"}`,
          )
        : location.assign("/growth/money");
  return (
    <Loaded state={state}>
      {(c) => {
        const days = new Map<string, CalItem[]>();
        for (const i of c.items)
          days.set(i.date, [...(days.get(i.date) ?? []), i]);
        const label = new Date(`${c.month}-01T12:00:00Z`).toLocaleDateString(
          "en-GB",
          { month: "long", year: "numeric" },
        );
        return (
          <>
            <Card
              title={label}
              actions={
                <span className="btns">
                  <button
                    className="btn ghost small"
                    onClick={() => setMonth(shift(c.month, -1))}
                  >
                    ← Previous
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={() => setMonth(shift(c.month, 1))}
                  >
                    Next →
                  </button>
                  <label className="small">
                    <input
                      type="checkbox"
                      checked={contentOnly}
                      onChange={(e) => setContentOnly(e.target.checked)}
                    />{" "}
                    Content only
                  </label>
                </span>
              }
            >
              {days.size ? (
                <ul className="gw-list">
                  {[...days].map(([d, items]) => (
                    <li key={d}>
                      <strong>
                        {new Date(`${d}T12:00:00Z`).toLocaleDateString(
                          "en-GB",
                          { weekday: "short", day: "numeric", month: "short" },
                        )}
                      </strong>
                      <ul className="gw-list">
                        {items.map((i) => (
                          <li key={`${i.kind}${i.id}`}>
                            <Chip tone={i.kind === "task" ? "acc" : "plain"}>
                              {KIND[i.kind]}
                              {i.channel ? ` · ${i.channel}` : ""}
                            </Chip>{" "}
                            <button
                              className="gw-linkbtn"
                              onClick={() => open(i)}
                            >
                              {i.title}
                            </button>{" "}
                            <span className="muted small">
                              {i.status.replace("_", " ")}
                              {i.owner ? ` · ${i.owner}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>
                  Nothing dated in {label}. Give tasks a due date and posts a
                  date to see them here.
                </Empty>
              )}
            </Card>
            <div className="grid2">
              <Card title="Content work without a date">
                {c.undated.length ? (
                  <ul className="gw-list">
                    {c.undated.map((t) => (
                      <li key={t.id}>
                        <button
                          className="gw-linkbtn"
                          onClick={() => openTask(t.id)}
                        >
                          {t.title}
                        </button>{" "}
                        <span className="muted small">
                          {t.status.replace("_", " ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>Every open content task has a date.</Empty>
                )}
              </Card>
              <Card title="Post ideas without a date">
                {c.ideas.length ? (
                  <ul className="gw-list">
                    {c.ideas.map((p) => (
                      <li key={p.id}>
                        {p.title}{" "}
                        <span className="muted small">
                          {p.channel} · {p.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>No undated post ideas.</Empty>
                )}
              </Card>
            </div>
          </>
        );
      }}
    </Loaded>
  );
}

type Integration = {
  key: string;
  label: string;
  what: string;
  param: string;
  json: string;
  steps: string[];
  connected: boolean;
  checkedAt: number | null;
  metrics: Record<string, number | string>;
  recent: {
    title: string;
    url: string;
    at: string;
    stats: Record<string, number>;
  }[];
  error: string | null;
  note: string | null;
};

const words = (k: string) =>
  k
    .replace(/([A-Z])/g, " $1")
    .replace(/(\d+)d$/, " ($1 days)")
    .toLowerCase();

export function Integrations() {
  const state = useLoad(
    () => get<{ integrations: Integration[] }>("/growth/integrations"),
    [],
  );
  return (
    <Loaded state={state}>
      {({ integrations }) => (
        <>
          <div className="gw-stack">
            {integrations.map((i) => (
              <Card
                key={i.key}
                title={i.label}
                actions={
                  i.connected ? (
                    <Chip tone="good">connected</Chip>
                  ) : i.error ? (
                    <Chip tone="bad">error</Chip>
                  ) : (
                    <Chip tone="plain">not connected</Chip>
                  )
                }
              >
                <p className="small">{i.what}</p>
                {i.error && (
                  <div className="notice error">
                    Last check failed: {i.error}
                  </div>
                )}
                {i.note && <p className="muted small">{i.note}</p>}
                {i.connected ? (
                  <>
                    <div className="stats">
                      {Object.entries(i.metrics).map(([k, v]) => (
                        <Stat
                          key={k}
                          label={words(k)}
                          value={
                            typeof v === "number"
                              ? v.toLocaleString("en-IN")
                              : v
                          }
                        />
                      ))}
                    </div>
                    {i.recent.length > 0 && (
                      <ul className="gw-list">
                        {i.recent.map((r) => (
                          <li key={r.url}>
                            <a href={r.url} target="_blank" rel="noreferrer">
                              {r.title || "(no caption)"}
                            </a>{" "}
                            <span className="muted small">
                              {r.at} ·{" "}
                              {Object.entries(r.stats)
                                .map(([k, v]) => `${v} ${k}`)
                                .join(" · ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="muted small">
                      Updated {i.checkedAt ? date(i.checkedAt) : "—"} (daily).
                    </p>
                  </>
                ) : (
                  <details>
                    <summary className="small">How to connect</summary>
                    <ol className="small">
                      {i.steps.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                    <p className="small">
                      SSM parameter <code>{i.param}</code> (SecureString,
                      ap-south-1):
                    </p>
                    <pre className="small">{i.json}</pre>
                    <p className="muted small">
                      It shows here after the next daily run.
                    </p>
                  </details>
                )}
              </Card>
            ))}
          </div>
          <Card title="Also here already">
            <ul className="gw-list small">
              <li>
                Re-engagement: push campaigns to segments (for example signed in
                but no backup in 14 days) are on the{" "}
                <a href="/notifications">Notifications</a> page; each one needs
                an approval before it sends.
              </li>
              <li>
                Communities and creators: track them as partners (type
                “community” or “influencer”) on{" "}
                <a href="/growth/partners">Partners</a>, each with its own
                tagged link.
              </li>
              <li>
                Search Console, Bing and Google Analytics are connected (see SEO
                tools and Website analytics).
              </li>
            </ul>
          </Card>
        </>
      )}
    </Loaded>
  );
}
