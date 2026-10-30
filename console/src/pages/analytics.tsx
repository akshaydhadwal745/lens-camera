import { useState } from "react";

import { get } from "../api";
import {
  Bars,
  Breakdown,
  Card,
  Empty,
  Loaded,
  n,
  Page,
  Stat,
  Tabs,
  useLoad,
  when,
} from "../ui";

type Step = {
  key: string;
  label: string;
  count: number;
  medianHoursToReach: number | null;
};
type Feature = {
  name: string;
  users7: number;
  uses7: number;
  users30: number;
  uses30: number;
  weekly: { week: string; users: number }[];
};
type Count = { label: string; count: number }[];
type Rate = { reached: number; eligible: number; rate: number | null };
type Analytics = {
  at: number;
  windowDays: number;
  trackingSince: string | null;
  accounts: number;
  funnel: Step[];
  eligibleForReturn: number;
  active: {
    series: { day: string; dau: number; wau: number; mau: number }[];
    today: { dau: number; wau: number; mau: number };
    stickiness: number | null;
  };
  retention: { week: string; size: number; weeks: (number | null)[] }[];
  channels: {
    channel: string;
    installs: number;
    backedUp: Rate;
    signedIn: Rate;
    d1: Rate;
    d7: Rate;
    d30: Rate;
    paying: number;
    storageGB: number;
    storageUsdPerMonth: number;
  }[];
  features: Feature[];
  breakdowns: {
    build: Count;
    os: Count;
    tier: Count;
    region: Count;
    client: Count;
  };
  website?: {
    daily: {
      day: string;
      visits: number;
      pageviews: number;
      getLens: number;
    }[];
    visits: number;
    pageviews: number;
    getLens: number;
    getLensRate: number | null;
    pages: Count;
    sources: Count;
    events: Count;
    getLensFrom: Count;
    engagedVisits?: number;
    engagedRate?: number | null;
    landing?: {
      path: string;
      visits: number;
      engaged: number;
      getLens: number;
    }[];
    pageQuality?: {
      path: string;
      views: number;
      avgSeconds: number | null;
      engagedRate: number | null;
      scrollRate: number | null;
    }[];
    mediums?: Count;
    campaigns?: Count;
    countries?: Count;
    devices?: Count;
  };
};

/** What each counted feature is (app counts from src/lib/usage.ts, server ones from the database). */
export const FEATURES: Record<string, string> = {
  app_open: "Opened Lens",
  gallery_open: "Opened the library",
  edit_open: "Opened the editor",
  event_open: "Opened an event album",
  links_open: "Opened Share links",
  shares_open: "Opened Shared with me",
  share_open: "Opened Share",
  settings_open: "Opened Settings",
  scan_open: "Scanned a QR code",
  my_code_open: "Opened My Lens code",
  signin_open: "Opened Sign in",
  mode_photo: "Photo mode",
  mode_slowmo: "Slow motion",
  mode_timelapse: "Time-lapse",
  capture_photo: "Took a photo",
  capture_video: "Recorded a video",
  mode_pro: "PRO camera",
  mode_night: "Night mode",
  mode_portrait: "Portrait",
  mode_video: "Video mode",
  look_used: "Took a photo with a look",
  timer_used: "Self-timer",
  lens_switch: "Switched lens / zoom",
  front_camera: "Front camera",
  viewer_open: "Opened a photo",
  edit_saved: "Saved an edit",
  people_open: "Opened People",
  places_open: "Opened Places",
  albums_open: "Opened Albums",
  recap_open: "Opened a recap",
  recap_saved: "Saved a recap",
  event_join: "Joined an event album",
  share_sheet: "Shared via the phone’s share menu",
  share_link: "Made a share link",
  share_friend: "Sent to a friend in Lens",
  invite_open: "Opened Invite friends",
  storage_open: "Opened storage settings",
  trash_open: "Opened Trash",
  feedback_open: "Opened Feedback",
  download_original: "Downloaded an original",
  stream_video: "Played a video",
  server_upload: "Backed up a photo/video",
  server_share_link: "Share links made",
  server_share_friend: "Sent to friends",
  server_album: "Albums made",
  server_event_album: "Event albums made",
  server_invite: "Friends invited",
  server_own_storage: "Connected own storage",
  server_feedback: "Sent feedback",
};
const label = (name: string) => FEATURES[name] ?? name.replace(/_/g, " ");
const pct = (x: number | null | undefined) =>
  x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`;
const hours = (h: number | null) =>
  h === null
    ? ""
    : h < 1
      ? `${Math.round(h * 60)} min`
      : h < 48
        ? `${Math.round(h)} h`
        : `${Math.round(h / 24)} days`;

export function Analytics() {
  const [cohortWindow, setCohortWindow] = useState<"30" | "90" | "all">("90");
  const [refresh, setRefresh] = useState(0);
  const [range, setRange] = useState<"7" | "30">("30");
  const state = useLoad(
    () =>
      get<Analytics>(
        `/analytics?window=${cohortWindow}${refresh ? "&refresh=1" : ""}`,
      ),
    [cohortWindow, refresh],
  );
  return (
    <Page
      title="Analytics"
      actions={
        <>
          {state.data && (
            <span className="muted small">Updated {when(state.data.at)}</span>
          )}
          <button
            className="btn"
            disabled={state.loading}
            onClick={() => setRefresh((r) => r + 1)}
          >
            {state.loading ? "Loading…" : "Refresh"}
          </button>
        </>
      }
    >
      <p className="muted small">
        Our own analytics: counts from the Lens database and the app’s anonymous
        feature counts. Real accounts only (test accounts and emulators left
        out). No photos, places or messages are read.
      </p>
      <Loaded state={state}>
        {(a) => {
          const top = a.funnel[0]?.count || 0;
          const tracked = a.trackingSince
            ? `Daily activity recorded since ${new Date(a.trackingSince).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.`
            : "Daily activity recording starts with the next app use.";
          return (
            <>
              <div className="stats">
                <Stat label="Active today" value={n(a.active.today.dau)} />
                <Stat
                  label="Active this week"
                  value={n(a.active.today.wau)}
                  sub="last 7 days"
                />
                <Stat
                  label="Active this month"
                  value={n(a.active.today.mau)}
                  sub="last 30 days"
                />
                <Stat
                  label="Stickiness"
                  value={pct(a.active.stickiness)}
                  sub="daily ÷ monthly"
                />
              </div>
              <p className="muted small">{tracked}</p>

              <div className="row-head">
                <h2>Funnel</h2>
                <Tabs
                  value={cohortWindow}
                  onChange={setCohortWindow}
                  options={[
                    { value: "30", label: "Installed in 30 days" },
                    { value: "90", label: "90 days" },
                    { value: "all", label: "All time" },
                  ]}
                />
              </div>
              <Card>
                {top ? (
                  <ul className="funnel">
                    {a.funnel.map((s, i) => {
                      const prev = i ? a.funnel[i - 1].count : s.count;
                      const base =
                        s.key === "return" ? a.eligibleForReturn : top;
                      return (
                        <li key={s.key}>
                          <div className="f-head">
                            <span>{s.label}</span>
                            <span>
                              <strong>{n(s.count)}</strong>{" "}
                              <span className="muted">
                                {pct(base ? s.count / base : null)}
                              </span>
                            </span>
                          </div>
                          <span className="b-track">
                            <span
                              className="b-fill"
                              style={{
                                width: `${top ? (s.count / top) * 100 : 0}%`,
                              }}
                            />
                          </span>
                          <div className="muted small">
                            {i > 0 &&
                              s.key !== "return" &&
                              `${pct(prev ? s.count / prev : null)} of the step before`}
                            {s.medianHoursToReach !== null &&
                              ` · typically ${hours(s.medianHoursToReach)} after install`}
                            {s.key === "return" &&
                              `of ${n(a.eligibleForReturn)} who installed 7+ days ago`}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <Empty>No installs in this period.</Empty>
                )}
              </Card>

              <div className="grid2">
                <Card title="Active users per day">
                  <Bars
                    caption={<>Daily active (90 days)</>}
                    rows={a.active.series.map((d) => ({
                      label: d.day,
                      value: d.dau,
                    }))}
                  />
                </Card>
                <Card title="Monthly active">
                  <Bars
                    caption={<>Active in the 30 days up to each day</>}
                    rows={a.active.series.map((d) => ({
                      label: d.day,
                      value: d.mau,
                    }))}
                  />
                </Card>
              </div>

              <div className="row-head">
                <h2>Retention</h2>
              </div>
              <Card>
                {a.retention.length ? (
                  <div className="table-wrap">
                    <table className="retention">
                      <thead>
                        <tr>
                          <th>Installed (week of)</th>
                          <th className="num">People</th>
                          {Array.from({ length: 9 }, (_, k) => (
                            <th key={k} className="num">
                              {k === 0 ? "Week 0" : `+${k}`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {a.retention.map((c) => (
                          <tr key={c.week}>
                            <td className="nowrap">
                              {new Date(c.week).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                              })}
                            </td>
                            <td className="num">{n(c.size)}</td>
                            {c.weeks.map((v, k) => (
                              <td
                                key={k}
                                className="num cell"
                                data-level={
                                  v === null
                                    ? "none"
                                    : Math.min(4, Math.ceil(v * 4))
                                }
                              >
                                {v === null ? "" : pct(v)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>No installs in the last 12 weeks.</Empty>
                )}
                <p className="muted small">
                  Share of each week’s new users who used Lens in each later
                  week. Empty cells: that week hasn’t finished, or it was before
                  daily activity was recorded.
                </p>
              </Card>

              <div className="row-head">
                <h2>By install channel</h2>
              </div>
              <Card>
                {a.channels?.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Channel</th>
                          <th className="num">Installs</th>
                          <th className="num">Backed up</th>
                          <th className="num">Signed in</th>
                          <th className="num">D1</th>
                          <th className="num">D7</th>
                          <th className="num">D30</th>
                          <th className="num">Paying</th>
                          <th className="num">Storage</th>
                          <th className="num">Est. cost / month</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.channels.map((c) => (
                          <tr key={c.channel}>
                            <td>{c.channel}</td>
                            <td className="num">{n(c.installs)}</td>
                            <td className="num">{pct(c.backedUp.rate)}</td>
                            <td className="num">{pct(c.signedIn.rate)}</td>
                            {[c.d1, c.d7, c.d30].map((d, k) => (
                              <td
                                key={k}
                                className="num"
                                title={`${d.reached} of ${d.eligible} old enough`}
                              >
                                {pct(d.rate)}
                              </td>
                            ))}
                            <td className="num">{n(c.paying)}</td>
                            <td className="num">{c.storageGB} GB</td>
                            <td className="num">
                              ${c.storageUsdPerMonth.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>No installs in this period.</Empty>
                )}
                <p className="muted small">
                  Channel = where the install came from (Google Play’s install
                  referrer: organic Play, a tagged link, an invite; “web” for
                  website sign-ups). Recorded for installs from 29 Oct 2026.
                  D1/D7/D30 = used Lens on exactly that day after installing
                  (classic day-N), of installs from the last 90 days old enough
                  to count (hover for counts); “Came back 7+ days later” in the
                  funnel counts any later visit, so it reads higher. Cost =
                  storage held × $0.012 per GB-month, an estimate.
                </p>
              </Card>

              <div className="row-head">
                <h2>Feature use</h2>
                <Tabs
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: "7", label: "7 days" },
                    { value: "30", label: "30 days" },
                  ]}
                />
              </div>
              <Card>
                {a.features.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Feature</th>
                          <th className="num">People</th>
                          <th className="num">of active</th>
                          <th className="num">Uses</th>
                          <th>Weekly people (12 weeks)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...a.features]
                          .sort((x, y) =>
                            range === "7"
                              ? y.users7 - x.users7
                              : y.users30 - x.users30,
                          )
                          .map((f) => {
                            const users = range === "7" ? f.users7 : f.users30;
                            const activeN =
                              range === "7"
                                ? a.active.today.wau
                                : a.active.today.mau;
                            const max = Math.max(
                              1,
                              ...f.weekly.map((w) => w.users),
                            );
                            return (
                              <tr key={f.name}>
                                <td>
                                  {label(f.name)}
                                  {f.name.startsWith("server_") && (
                                    <span className="muted small">
                                      {" "}
                                      · server
                                    </span>
                                  )}
                                </td>
                                <td className="num">{n(users)}</td>
                                <td className="num">
                                  {activeN ? pct(users / activeN) : "—"}
                                </td>
                                <td className="num">
                                  {n(range === "7" ? f.uses7 : f.uses30)}
                                </td>
                                <td>
                                  <span
                                    className="spark"
                                    aria-label={`weekly people for ${label(f.name)}`}
                                  >
                                    {f.weekly.map((w) => (
                                      <span
                                        key={w.week}
                                        title={`${w.week}: ${w.users}`}
                                        style={{
                                          height: `${Math.max(6, (w.users / max) * 100)}%`,
                                        }}
                                        className={w.users ? "on" : ""}
                                      />
                                    ))}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>No feature use yet.</Empty>
                )}
                <p className="muted small">
                  “server” rows come straight from the database (exact, all app
                  versions). The others are counted by the app (from the update
                  of 21 Oct 2026) while “Help improve Lens” is on.
                </p>
              </Card>

              {a.website && (
                <>
                  <div className="row-head">
                    <h2>Website (last 30 days)</h2>
                  </div>
                  <div className="stats">
                    <Stat label="Visits" value={n(a.website.visits)} />
                    <Stat label="Page views" value={n(a.website.pageviews)} />
                    <Stat
                      label="Get Lens clicks"
                      value={n(a.website.getLens)}
                      sub="download, APK or Play"
                    />
                    <Stat
                      label="Visits → Get Lens"
                      value={pct(a.website.getLensRate)}
                    />
                    {a.website.engagedRate !== undefined && (
                      <Stat
                        label="Engaged visits"
                        value={pct(a.website.engagedRate)}
                        sub="2+ pages or 10+ s"
                      />
                    )}
                  </div>
                  {!!a.website.landing?.length && (
                    <Card title="Landing pages: what visits that start here do">
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
                            {a.website.landing.map((l) => (
                              <tr key={l.path}>
                                <td>{l.path}</td>
                                <td className="num">{n(l.visits)}</td>
                                <td
                                  className="num"
                                  title={`${l.engaged} visits`}
                                >
                                  {pct(l.visits ? l.engaged / l.visits : null)}
                                </td>
                                <td
                                  className="num"
                                  title={`${l.getLens} clicks`}
                                >
                                  {pct(l.visits ? l.getLens / l.visits : null)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                  {!!a.website.pageQuality?.some(
                    (p) => p.avgSeconds !== null,
                  ) && (
                    <Card title="Page quality: do people read it?">
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Page</th>
                              <th className="num">Views</th>
                              <th className="num">Avg time</th>
                              <th className="num">10+ s</th>
                              <th className="num">Scrolled 75%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.website.pageQuality.map((p) => (
                              <tr key={p.path}>
                                <td>{p.path}</td>
                                <td className="num">{n(p.views)}</td>
                                <td className="num">
                                  {p.avgSeconds === null
                                    ? "—"
                                    : `${p.avgSeconds} s`}
                                </td>
                                <td className="num">{pct(p.engagedRate)}</td>
                                <td className="num">{pct(p.scrollRate)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  )}
                  <div className="grid2">
                    <Card>
                      <Bars
                        caption={<>Visits per day</>}
                        rows={a.website.daily.map((d) => ({
                          label: d.day,
                          value: d.visits,
                        }))}
                      />
                    </Card>
                    <Card>
                      <Bars
                        caption={<>Get Lens clicks per day</>}
                        rows={a.website.daily.map((d) => ({
                          label: d.day,
                          value: d.getLens,
                        }))}
                      />
                    </Card>
                    <Card title="Where visits come from">
                      <Breakdown rows={a.website.sources} />
                    </Card>
                    <Card title="Top pages">
                      <Breakdown rows={a.website.pages} />
                    </Card>
                    <Card title="Pages people click Get Lens on">
                      <Breakdown rows={a.website.getLensFrom} />
                    </Card>
                    <Card title="Clicks">
                      <Breakdown rows={a.website.events} />
                    </Card>
                    {!!a.website.countries?.length && (
                      <Card title="Countries">
                        <Breakdown rows={a.website.countries} />
                      </Card>
                    )}
                    {!!a.website.devices?.length && (
                      <Card title="Devices">
                        <Breakdown rows={a.website.devices} />
                      </Card>
                    )}
                    {!!a.website.campaigns?.length && (
                      <Card title="Campaigns (utm_campaign)">
                        <Breakdown rows={a.website.campaigns} />
                      </Card>
                    )}
                    {!!a.website.mediums?.length && (
                      <Card title="Mediums (utm_medium)">
                        <Breakdown rows={a.website.mediums} />
                      </Card>
                    )}
                  </div>
                  <p className="muted small">
                    Counted by our own script: no cookies, no visitor IDs, daily
                    totals only. Landing pages, engagement, time, scroll,
                    countries, devices and campaigns are counted from 30 Oct
                    2026. Google Analytics (GA4) runs alongside with consent.
                    Search traffic details (queries, positions) are in Google
                    Search Console.
                  </p>
                </>
              )}

              <div className="row-head">
                <h2>Who uses Lens (last 30 days)</h2>
              </div>
              <div className="grid3">
                <Card title="App version">
                  <Breakdown rows={a.breakdowns.build} />
                </Card>
                <Card title="Android version">
                  <Breakdown rows={a.breakdowns.os} />
                </Card>
                <Card title="Region">
                  <Breakdown rows={a.breakdowns.region} />
                </Card>
                <Card title="App or website">
                  <Breakdown rows={a.breakdowns.client} />
                </Card>
              </div>
            </>
          );
        }}
      </Loaded>
    </Page>
  );
}
