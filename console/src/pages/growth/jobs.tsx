// What the growth agent is doing right now (GET /growth/jobs). One live status for every growth page:
// the bar at the top, buttons that wait while their job runs, and pages that refresh when it ends.
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { get } from "../../api";
import { when } from "../../ui";

type Job = { at: number; by: string };
/** A reel being made, and the stage its builder reached (GET /growth/jobs). */
export type ReelJob = Job & {
  postId: string;
  stage:
    "photos" | "directing" | "footage" | "frames" | "scoring" | "saving" | null;
  step: number;
  steps: number;
};

// Rough share of the run each stage takes, so the bar moves at an even pace.
const STAGES = {
  writing: [0, 8, "Writing the reel"],
  directing: [0, 8, "Planning the scenes"],
  voice: [8, 12, "Recording the voice"],
  photos: [12, 18, "Finding photos that fit"],
  footage: [18, 26, "Finding footage"],
  designing: [26, 42, "Designing every scene"],
  checking: [42, 48, "Checking the design"],
  frames: [48, 88, "Drawing frames"],
  scoring: [88, 95, "Scoring the reel"],
  saving: [95, 100, "Saving"],
  improving: [0, 30, "Redesigning weak scenes"],
} as const;

/** "Drawing frames 45%", "Finding footage 3/6", and how far along the whole reel is (0–100). */
export function reelStage(r: ReelJob): { label: string; pct: number } {
  if (!r.stage) return { label: "Starting", pct: 0 };
  const [from, to, name] = STAGES[r.stage];
  const part = r.steps > 0 ? Math.min(1, r.step / r.steps) : 0;
  const count =
    r.steps > 0
      ? r.stage === "frames"
        ? ` ${Math.round(part * 100)}%`
        : ` ${Math.min(r.step + 1, r.steps)}/${r.steps}`
      : "";
  return { label: name + count, pct: Math.round(from + (to - from) * part) };
}

/** 1:42 */
export const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export type Jobs = {
  analyst:
    (Job & { kind: "report" | "draft" | "monthly"; ref: string | null }) | null;
  seoAudit: Job | null;
  competitors: Job | null;
  reel: ReelJob | null;
  lastError: { message: string; at: number } | null;
  /** When this status was fetched (so the page needn't read the clock while drawing). */
  checkedAt?: number;
};
const NONE: Jobs = {
  analyst: null,
  seoAudit: null,
  competitors: null,
  reel: null,
  lastError: null,
};

const Ctx = createContext<{ jobs: Jobs; refresh: () => void }>({
  jobs: NONE,
  refresh: () => {},
});

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<Jobs>(NONE);
  const prev = useRef(jobs);
  const refresh = useCallback(() => {
    get<Jobs>("/growth/jobs").then(
      (j) => setJobs({ ...j, checkedAt: Date.now() }),
      () => {},
    );
  }, []);
  // A reel only speeds up the polling: its own section reloads it (a page reload could drop unsaved edits).
  const busy = !!(
    jobs.analyst ||
    jobs.seoAudit ||
    jobs.competitors ||
    jobs.reel
  );
  // Every 10 s while something runs, every minute otherwise (a scheduled run shows up too).
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, busy ? 10_000 : 60_000);
    return () => clearInterval(t);
  }, [busy, refresh]);
  // A job just ended: reload the page's data so its result shows without a manual reload.
  useEffect(() => {
    const was = prev.current;
    prev.current = jobs;
    if (
      (was.analyst && !jobs.analyst) ||
      (was.seoAudit && !jobs.seoAudit) ||
      (was.competitors && !jobs.competitors)
    )
      dispatchEvent(new Event("growth-reload"));
  }, [jobs]);
  return <Ctx.Provider value={{ jobs, refresh }}>{children}</Ctx.Provider>;
}

export const useJobs = () => useContext(Ctx);

/** A number that goes up whenever growth data should be reloaded (add it to useLoad deps). */
export function useGrowthReload() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((x) => x + 1);
    addEventListener("growth-reload", f);
    return () => removeEventListener("growth-reload", f);
  }, []);
  return n;
}

const who = (by: string) =>
  by === "schedule" ? "the weekly schedule" : by.split("@")[0];

/** The bar under the page title while the agent works. */
export function AgentBar({
  taskTitle,
}: {
  taskTitle: (id: string) => string | undefined;
}) {
  const { jobs } = useJobs();
  // "OK" hides this failure for the rest of the visit (remembered per browser).
  const [hidden, setHiddenState] = useState(() => {
    try {
      return Number(sessionStorage.getItem("growth-agent-note") ?? 0);
    } catch {
      return 0;
    }
  });
  const setHidden = (at: number) => {
    setHiddenState(at);
    try {
      sessionStorage.setItem("growth-agent-note", String(at));
    } catch {
      /* private mode: hidden for this page only */
    }
  };
  const lines: string[] = [];
  const a = jobs.analyst;
  if (a)
    lines.push(
      `${
        a.kind === "draft"
          ? `Drafting “${(a.ref && taskTitle(a.ref)) || a.ref || "a task"}”`
          : a.kind === "monthly"
            ? `Writing the ${a.ref ?? ""} month in review`
            : "Running the analysis"
      } · started ${when(a.at)} by ${who(a.by)} · usually about 10 minutes`,
    );
  if (jobs.seoAudit)
    lines.push(`SEO audit · started ${when(jobs.seoAudit.at)} · 1–3 minutes`);
  if (jobs.competitors)
    lines.push(
      `Checking competitors · started ${when(jobs.competitors.at)} · about 2 minutes`,
    );
  if (jobs.reel)
    lines.push(
      `Making a reel · ${reelStage(jobs.reel).label} · ${elapsed((jobs.checkedAt ?? jobs.reel.at) - jobs.reel.at)} so far · usually 20–40 minutes`,
    );
  // No job running, but the last one failed in the past hour: say so (otherwise people just wait).
  const err = jobs.lastError;
  if (
    !lines.length &&
    err &&
    err.at !== hidden &&
    (jobs.checkedAt ?? 0) - err.at < 3_600_000
  )
    return (
      <div className="notice gw-agentnote" role="status">
        <span>
          <strong>The agent’s last job stopped</strong> ({when(err.at)}):{" "}
          {agentError(err.message)}
        </span>
        <button
          className="btn ghost small"
          onClick={() => setHidden(err.at)}
          aria-label="Hide this note"
        >
          OK
        </button>
      </div>
    );
  if (!lines.length) return null;
  return (
    <div className="gw-agentbar" role="status">
      <span className="gw-spinner" aria-hidden="true" />
      <div>
        <strong>The agent is working</strong>
        {lines.map((l) => (
          <div key={l} className="small">
            {l}
          </div>
        ))}
        <div className="muted small">
          This page updates by itself when it’s done.
        </div>
      </div>
    </div>
  );
}

/** An agent failure in plain words (the Claude usage limit gets its own explanation). */
export function agentError(message: string) {
  const limit = /hit your .*limit.*?resets ([^\n]+?)\s*$/i.exec(message);
  if (limit)
    return `the agent has used up its Claude allowance for now. It resets at ${limit[1].trim()}; press the button again after that.`;
  return message
    .replace(/^Draft T-\d+:\s*/, "")
    .replace(/^claude exited \d+:\s*/, "");
}

/** Label and disabled state for a button that starts an analyst job. */
export function analystButton(
  jobs: Jobs,
  mine: (a: NonNullable<Jobs["analyst"]>) => boolean,
  idle: string,
  running: string,
) {
  const a = jobs.analyst;
  if (!a) return { label: idle, disabled: false };
  return { label: mine(a) ? running : "Agent busy…", disabled: true };
}
