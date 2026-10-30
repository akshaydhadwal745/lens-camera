// Month-in-review (written on the 1st of each month; every number checked against the month's facts).
import { useState } from "react";

import { api, get } from "../../api";
import { Card, date, Empty, Loaded, useLoad } from "../../ui";
import { analystButton, useGrowthReload, useJobs } from "./jobs";
import { can, Chip, fmt, openTask, type Fact, type Workspace } from "./shared";

type Review = {
  month: string;
  at: number;
  by: string;
  ai?: {
    headline: string;
    summary: string;
    wins: string[];
    misses: string[];
    nextMonth: string[];
  };
  aiError?: string;
  aiProblems?: string[];
  data: {
    facts: Fact[];
    done: { id: string; title: string }[];
    measured: { id: string; title: string; verdict: string; value: string }[];
  };
};

export function MonthlyReviews({
  ws,
  search,
}: {
  ws: Workspace;
  search: URLSearchParams;
}) {
  const [month, setMonth] = useState(search.get("monthly") ?? "");
  const { jobs, refresh } = useJobs();
  const reloadKey = useGrowthReload();
  const btn = analystButton(
    jobs,
    (a) => a.kind === "monthly",
    "Write last month's review",
    "Writing the review…",
  );
  const state = useLoad(
    () =>
      get<{ months: string[]; review: Review | null }>(
        `/growth/monthly${month ? `?month=${month}` : ""}`,
      ),
    [month, reloadKey],
  );
  const run = () =>
    void api("POST", "/growth/monthly/run", {})
      .then(refresh)
      .catch((e: Error) => alert(e.message));
  return (
    <Loaded state={state}>
      {({ months, review: r }) => (
        <Card
          title={r ? `Month in review: ${r.month}` : "Month in review"}
          actions={
            <span className="btns">
              {months.length > 1 && (
                <select
                  value={month || r?.month || ""}
                  onChange={(e) => setMonth(e.target.value)}
                  aria-label="Month"
                >
                  {months.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              )}
              {can(ws, "growth.write") && (
                <button className="btn" disabled={btn.disabled} onClick={run}>
                  {btn.label}
                </button>
              )}
            </span>
          }
        >
          {!r ? (
            <Empty>
              The first review is written on 1 December (each 1st of the month,
              09:00 IST), or now with the button.
            </Empty>
          ) : (
            <details open={!!search.get("monthly")}>
              <summary>
                <strong>{r.ai?.headline ?? "The month in numbers"}</strong>{" "}
                <span className="muted small">· {date(r.at)}</span>
              </summary>
              {r.ai ? (
                <p>{r.ai.summary}</p>
              ) : (
                <p className="muted">
                  The AI write-up didn't run{r.aiError ? `: ${r.aiError}` : ""}.
                </p>
              )}
              {r.aiProblems && (
                <p className="muted small">
                  Some numbers in the write-up failed the check:{" "}
                  {r.aiProblems.join("; ")}
                </p>
              )}
              <div className="grid3">
                <div>
                  <h3 className="small">Wins</h3>
                  <ul className="gw-list">
                    {(r.ai?.wins ?? []).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="small">Misses</h3>
                  <ul className="gw-list">
                    {(r.ai?.misses ?? []).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="small">Next month</h3>
                  <ul className="gw-list">
                    {(r.ai?.nextMonth ?? []).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <h3 className="small">Numbers</h3>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {r.data.facts
                      .filter((f) => f.id.startsWith("month."))
                      .map((f) => (
                        <tr key={f.id}>
                          <td>{f.label}</td>
                          <td className="num">{fmt(f.value, f.unit)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {r.data.measured.length > 0 && (
                <>
                  <h3 className="small">Results measured</h3>
                  <ul className="gw-list">
                    {r.data.measured.map((t) => (
                      <li key={t.id}>
                        <button
                          className="gw-linkbtn"
                          onClick={() => openTask(t.id)}
                        >
                          {t.title}
                        </button>{" "}
                        <Chip
                          tone={
                            t.verdict === "worked"
                              ? "good"
                              : t.verdict === "worse"
                                ? "bad"
                                : "plain"
                          }
                        >
                          {t.verdict.replace("_", " ")}
                        </Chip>{" "}
                        <span className="muted small">{t.value}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </details>
          )}
        </Card>
      )}
    </Loaded>
  );
}
