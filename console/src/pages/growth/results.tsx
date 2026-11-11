// Results (docs/growth/content-engine.md, "the brain"): what happened to our Instagram posts, and what the weekly
// brain learned from it. GET /growth/results (growth-brain.ts).
import { get } from "../../api";
import { Loaded, useLoad, when } from "../../ui";
import { Chip } from "./shared";

type Stats = {
  at: number;
  ageHours: number;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  avgWatchSec?: number;
  watchedPct?: number;
};
type ResultsPage = {
  playbook: {
    at: number;
    status: "ok" | "not-enough-data" | "failed";
    summary: string;
    dropOff: string;
    message?: string;
    posts: number;
    lessons: {
      lesson: string;
      evidence: string;
      confidence: "low" | "medium" | "high";
      applyTo: string;
    }[];
    experiments: { idea: string; how: string; measure: string }[];
  } | null;
  posts: {
    id: string;
    title: string;
    kind: string;
    at: number;
    url: string;
    seconds: number | null;
    ourScore: number | null;
    stats: Stats | null;
  }[];
  sounds: {
    at: number;
    styles: { style: string; mood: string; why: string; source: string }[];
  } | null;
  days: {
    day: string;
    followers: number;
    reach: number;
    profileViews: number;
    websiteClicks: number;
  }[];
};

const APPLIES: Record<string, string> = {
  writer: "Script",
  designer: "Design",
  scorer: "Scoring",
  schedule: "When to post",
};

export function Results() {
  const state = useLoad(() => get<ResultsPage>("/growth/results"), []);
  return (
    <Loaded state={state}>
      {(r) => (
        <div className="gw-results">
          <section className="gw-callout">
            <strong>What the brain learned</strong>
            {!r.playbook ? (
              <span className="muted small">
                The brain reads every post’s results each Monday and writes
                lessons here. The script writer, designer and scorer follow them
                on every new reel.
              </span>
            ) : r.playbook.status !== "ok" ? (
              <span className="muted small">
                {r.playbook.message ?? "No lessons yet."} Last checked{" "}
                {when(r.playbook.at)}.
              </span>
            ) : (
              <>
                <p>{r.playbook.summary}</p>
                {r.playbook.dropOff && (
                  <p className="small">
                    <strong>Where people leave:</strong> {r.playbook.dropOff}
                  </p>
                )}
                <ul className="small">
                  {r.playbook.lessons.map((l, i) => (
                    <li key={i}>
                      <Chip tone="acc">{APPLIES[l.applyTo] ?? l.applyTo}</Chip>{" "}
                      {l.lesson}{" "}
                      <span className="muted">
                        ({l.evidence}; confidence {l.confidence})
                      </span>
                    </li>
                  ))}
                </ul>
                {r.playbook.experiments.length > 0 && (
                  <>
                    <strong className="small">Try next</strong>
                    <ul className="small">
                      {r.playbook.experiments.map((e, i) => (
                        <li key={i}>
                          {e.idea}{" "}
                          <span className="muted">
                            {e.how} Measure: {e.measure}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <span className="muted small">
                  From {r.playbook.posts} posts · {when(r.playbook.at)}
                </span>
              </>
            )}
          </section>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Post</th>
                  <th>Views</th>
                  <th>Reached</th>
                  <th>Watched</th>
                  <th>Saves</th>
                  <th>Shares</th>
                  <th>Comments</th>
                  <th>Our score</th>
                </tr>
              </thead>
              <tbody>
                {r.posts.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      Nothing published yet. Approve a post and press{" "}
                      <strong>Post to Instagram now</strong>.
                    </td>
                  </tr>
                )}
                {r.posts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <a href={p.url} target="_blank" rel="noreferrer">
                        {p.title || p.kind}
                      </a>
                      <div className="muted small">
                        {p.kind} · {new Date(p.at).toLocaleString()}
                        {p.stats
                          ? ` · after ${p.stats.ageHours} h`
                          : " · numbers after 1 h"}
                      </div>
                    </td>
                    <td>{p.stats?.views ?? "—"}</td>
                    <td>{p.stats?.reach ?? "—"}</td>
                    <td>
                      {p.stats?.avgWatchSec !== undefined
                        ? `${p.stats.avgWatchSec} s${p.stats.watchedPct !== undefined ? ` (${p.stats.watchedPct}%)` : ""}`
                        : "—"}
                    </td>
                    <td>{p.stats?.saved ?? "—"}</td>
                    <td>{p.stats?.shares ?? "—"}</td>
                    <td>{p.stats?.comments ?? "—"}</td>
                    <td>{p.ourScore ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {r.sounds && r.sounds.styles.length > 0 && (
            <section className="small">
              <strong>Sounds trending on Reels this week</strong>{" "}
              <span className="muted">
                (reels’ music is searched in these styles first ·{" "}
                {when(r.sounds.at)})
              </span>
              <ul>
                {r.sounds.styles.map((x) => (
                  <li key={x.style}>
                    <a href={x.source} target="_blank" rel="noreferrer">
                      {x.style}
                    </a>{" "}
                    <span className="muted">
                      ({x.mood}) {x.why}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {r.days.length > 0 && (
            <p className="muted small">
              Account, last {r.days.length} days: followers{" "}
              {r.days[0].followers} → {r.days[r.days.length - 1].followers} ·
              reach {r.days.reduce((a, d) => a + d.reach, 0)} · profile views{" "}
              {r.days.reduce((a, d) => a + d.profileViews, 0)} · website clicks{" "}
              {r.days.reduce((a, d) => a + d.websiteClicks, 0)}
            </p>
          )}
        </div>
      )}
    </Loaded>
  );
}
