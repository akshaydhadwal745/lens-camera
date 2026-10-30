// Growth workspace: shared types and small pieces (docs/growth/growth-workspace.md).
import { ReactNode, useLayoutEffect, useRef, useState } from "react";

import { navigate } from "../../ui";

export type Status =
  | "suggested"
  | "ready"
  | "in_progress"
  | "in_review"
  | "done"
  | "measured"
  | "blocked"
  | "wontdo";
export type Workstream =
  "launch" | "search" | "social" | "store" | "retain" | "loops" | "partners";
export type Task = {
  id: string;
  title: string;
  description: string;
  workstream: Workstream;
  type: string;
  status: Status;
  priority: 0 | 1 | 2 | 3;
  priorityReason?: string;
  impact: number;
  confidence: number;
  effortHours: number;
  expectedImpact: string;
  owner: string;
  reviewer: string;
  due: string;
  goalId: string;
  milestoneId: string;
  source: { kind: "ai" | "person"; by: string; report?: string; ref?: string };
  evidence: { text: string; facts: string[]; link: string }[];
  links: {
    page: string;
    keyword: string;
    campaign: string;
    partner: string;
    post: string;
    pr?: { url: string; number: number };
  };
  metric: {
    label: string;
    fact: string;
    baseline: string;
    baselineAt: string;
    target: string;
    checkOn: string;
  };
  result?: {
    value: string;
    verdict: "worked" | "no_change" | "worse" | "too_early";
    learning: string;
    at: number;
    by: string;
  };
  spec?: Record<string, unknown>;
  blockedBy: string;
  wontDoReason: string;
  proof: string;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  doneAt?: number;
  measuredAt?: number;
};
export type Fact = {
  id: string;
  area: string;
  label: string;
  value: number | null;
  previous?: number | null;
  change?: number | null;
  unit: "count" | "pct" | "usd" | "gb" | "position";
  window: string;
};
export type KR = {
  id: string;
  label: string;
  source: string;
  fact?: string;
  value?: number;
  baseline: number;
  target: number;
  unit: string;
  current: number | null;
  progress: number | null;
  history?: { at: number; value: number; by: string }[];
};
export type Goal = {
  id: string;
  title: string;
  why: string;
  horizon: "now" | "d30" | "d90" | "health";
  owner: string;
  krs: KR[];
  period: { start: string; end: string } | null;
  status:
    "not_started" | "on_track" | "at_risk" | "behind" | "done" | "ongoing";
  elapsed: number | null;
  average: number | null;
  tasks: number;
};
export type Milestone = {
  id: string;
  goalId: string;
  title: string;
  due?: string;
  afterLaunchDays?: number;
  done: number;
  total: number;
  share: number | null;
  blocked: { id: string; title: string; blockedBy: string }[];
};
export type Partner = {
  id: string;
  name: string;
  type: string;
  city: string;
  contact: string;
  stage: string;
  value: string;
  nextStep: string;
  nextDate: string;
  owner: string;
  notes: string;
  lostReason: string;
  code: string;
  link: string;
  visits: number;
  stages?: { stage: string; at: number; by: string }[];
};
export type Post = {
  id: string;
  channel: string;
  date: string;
  title: string;
  body: string;
  status: string;
  url: string;
  page: string;
  owner: string;
  taskId: string;
  code: string;
  link: string;
  visits: number;
};
export type Workspace = {
  me: { email: string; role: string; permissions: string[] };
  settings: {
    northStar: string;
    launchDate: string;
    focus: { text: string; by: string; at: number; reviewOn: string };
    wsOwners: Partial<Record<Workstream, string>>;
  };
  northStar: {
    fact: string;
    label: string;
    value: number | null;
    previous: number | null;
    series: { weeksAgo: number; users: number }[];
  };
  goals: Goal[];
  milestones: Milestone[];
  tasks: Task[];
  team: { email: string; role: string }[];
  partners: Partner[];
  posts: Post[];
  facts: Fact[];
  analytics: {
    at: number;
    funnel: { key: string; label: string; count: number }[];
    channels?: any[];
    website?: any;
    active?: { dau: number; wau: number; mau: number };
    features?: { name: string; users30: number; uses30: number }[];
  };
  report: {
    date: string;
    at: number;
    summary: string | null;
    findings: {
      severity: string;
      title: string;
      detail: string;
      facts: string[];
    }[];
    investigations: any[];
    reviewOfPrevious: any[];
    notes: string[];
    aiError: string | null;
    aiProblems: string[] | null;
    model?: string;
  } | null;
};

export const WS: Record<Workstream, { label: string; outcome: string }> = {
  launch: {
    label: "Play launch",
    outcome:
      "Lens is live on Google Play, so every other channel can point people to it.",
  },
  search: {
    label: "Search & content",
    outcome: "More relevant people discover Lens through Google and Bing.",
  },
  social: {
    label: "Social & distribution",
    outcome:
      "People outside our circle see Lens every week, and we know which posts bring visitors.",
  },
  store: {
    label: "Website & Play Store",
    outcome:
      "More visitors become installs, on the website and the Play listing.",
  },
  retain: {
    label: "Activation & retention",
    outcome:
      "New users back up their first photo, sign in, keep coming back and some pay.",
  },
  loops: {
    label: "Referrals & events",
    outcome:
      "Every user brings more users: invites, shared links and event albums.",
  },
  partners: {
    label: "Partnerships",
    outcome:
      "Photographers, planners, colleges and creators who bring events and users every week.",
  },
};
export const STATUS: Record<
  Status,
  { label: string; tone: "plain" | "good" | "warn" | "bad" | "acc" }
> = {
  suggested: { label: "Suggested", tone: "acc" },
  ready: { label: "Ready", tone: "plain" },
  in_progress: { label: "In progress", tone: "warn" },
  in_review: { label: "In review", tone: "warn" },
  done: { label: "Done", tone: "good" },
  measured: { label: "Measured", tone: "good" },
  blocked: { label: "Blocked", tone: "bad" },
  wontdo: { label: "Won't do", tone: "plain" },
};
export const BOARD: Status[] = [
  "suggested",
  "ready",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "measured",
];
export const VERDICT: Record<
  string,
  { label: string; tone: "good" | "plain" | "bad" | "warn" }
> = {
  worked: { label: "Worked", tone: "good" },
  no_change: { label: "No change", tone: "plain" },
  worse: { label: "Worse", tone: "bad" },
  too_early: { label: "Too early to tell", tone: "warn" },
};
export const GOAL_STATUS: Record<
  Goal["status"],
  { label: string; tone: "plain" | "good" | "warn" | "bad" }
> = {
  not_started: { label: "Not started", tone: "plain" },
  on_track: { label: "On track", tone: "good" },
  at_risk: { label: "At risk", tone: "warn" },
  behind: { label: "Behind", tone: "bad" },
  done: { label: "Done", tone: "good" },
  ongoing: { label: "Ongoing", tone: "plain" },
};

export const todayStr = () => new Date().toISOString().slice(0, 10);
export const isOpen = (t: Task) =>
  ["ready", "in_progress", "in_review", "blocked"].includes(t.status);
export const isOverdue = (t: Task) =>
  isOpen(t) && !!t.due && t.due < todayStr();
export const dueSoon = (t: Task, days = 7) =>
  isOpen(t) &&
  !!t.due &&
  t.due >= todayStr() &&
  t.due <= new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
export const can = (ws: Workspace, p: string) => ws.me.permissions.includes(p);
export const shortDate = (d: string) =>
  d
    ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "";

export function fmt(v: number | null | undefined, unit: string) {
  if (v === null || v === undefined) return "—";
  if (unit === "pct") return `${Math.round(v * 1000) / 10}%`;
  if (unit === "usd") return `$${v.toFixed(2)}`;
  return v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

export function Chip({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "good" | "warn" | "bad" | "acc";
  children: ReactNode;
}) {
  return <span className={`gw-chip ${tone}`}>{children}</span>;
}
export const Pri = ({ p }: { p: number }) => (
  <span className={`gw-pri p${p}`}>P{p}</span>
);
export const StatusChip = ({ t }: { t: Task }) =>
  isOverdue(t) ? (
    <Chip tone="bad">Overdue</Chip>
  ) : (
    <Chip tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Chip>
  );

export function Person({ email, small }: { email: string; small?: boolean }) {
  const name = !email
    ? "Unassigned"
    : email === "agent"
      ? "Growth agent"
      : email.split("@")[0];
  const init = !email ? "" : email === "agent" ? "AI" : email[0].toUpperCase();
  return (
    <span className="gw-person" title={email || "Unassigned"}>
      <span
        className={`gw-av ${!email ? "none" : email === "agent" ? "agent" : ""}`}
      >
        {init}
      </span>
      {!small && <span>{name}</span>}
    </span>
  );
}

export function KRBar({ kr, elapsed }: { kr: KR; elapsed?: number | null }) {
  const pct = Math.round((kr.progress ?? 0) * 100);
  const tone =
    kr.progress === null
      ? ""
      : elapsed === null || elapsed === undefined
        ? "acc"
        : (kr.progress ?? 0) >= elapsed - 0.1
          ? "good"
          : (kr.progress ?? 0) >= elapsed - 0.25
            ? "warn"
            : "bad";
  return (
    <div className="gw-kr">
      <span>{kr.label}</span>
      <span className="muted small">
        {fmt(kr.current, kr.unit)} / {fmt(kr.target, kr.unit)}
        {kr.source === "manual" ? " · entered" : ""}
      </span>
      <div
        className="gw-bar"
        title={
          kr.progress === null
            ? "No data yet"
            : `${pct}% of the way from ${fmt(kr.baseline, kr.unit)}`
        }
      >
        <i
          className={tone}
          style={{ width: `${Math.max(pct, kr.progress === null ? 0 : 1)}%` }}
        />
        {elapsed !== null && elapsed !== undefined && (
          <em style={{ left: `${Math.round(elapsed * 100)}%` }} />
        )}
      </div>
    </div>
  );
}

export function TaskRow({ t }: { t: Task }) {
  return (
    <button className="gw-task" onClick={() => openTask(t.id)}>
      <Pri p={t.priority} />
      <span className="gw-task-main">
        <span className="gw-task-title">{t.title}</span>
        <span className="muted small">
          {WS[t.workstream]?.label} ·{" "}
          {t.due ? `due ${shortDate(t.due)}` : "no date"}
          {t.source.kind === "ai" ? " · suggested by the agent" : ""}
        </span>
      </span>
      <span className="gw-task-side">
        <StatusChip t={t} />
        <Person email={t.owner} small />
      </span>
    </button>
  );
}

/** Opens a task's panel (?task=) on the current page. */
export function openTask(id: string) {
  const u = new URL(location.href);
  u.searchParams.set("task", id);
  navigate(u.pathname + u.search);
}
export function closeTask() {
  const u = new URL(location.href);
  u.searchParams.delete("task");
  navigate(u.pathname + (u.search || ""));
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 28}`)
    .join(" ");
  return (
    <svg
      className="gw-spark"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={pts}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** A goal's status; in the first tenth of its period "on track" means little, so it says "Just started". */
export function GoalChip({ g }: { g: Goal }) {
  if (g.status === "on_track" && g.elapsed !== null && g.elapsed < 0.1)
    return <Chip tone="plain">Just started</Chip>;
  return (
    <Chip tone={GOAL_STATUS[g.status].tone}>{GOAL_STATUS[g.status].label}</Chip>
  );
}

/** A table that becomes one card per row on phones (each cell labelled with its column). */
export function CardTable({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const t = ref.current?.querySelector("table");
    if (!t) return;
    const heads = [...t.querySelectorAll("thead th")].map(
      (th) => th.textContent ?? "",
    );
    t.querySelectorAll("tbody tr").forEach((tr) =>
      [...tr.children].forEach((td, i) =>
        td.setAttribute("data-label", heads[i] ?? ""),
      ),
    );
  });
  return (
    <div ref={ref} className="table-wrap gw-cards">
      {children}
    </div>
  );
}

/** The agent's text with its light formatting: **bold**, and "- " items as a list. */
export function Prose({ text }: { text: string }) {
  const bold = (s: string) =>
    s
      .split(/\*\*(.+?)\*\*/g)
      .map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
  // Items written inline ("…this week: - **Get…** … - **Ask…**") start on their own line.
  const lines = text
    .replace(/\s+-\s+(?=\*\*)/g, "\n- ")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length)
      out.push(
        <ul key={out.length} className="gw-list">
          {items.map((x, i) => (
            <li key={i}>{bold(x)}</li>
          ))}
        </ul>,
      );
    items = [];
  };
  for (const l of lines) {
    if (/^[-•*]\s+/.test(l)) items.push(l.replace(/^[-•*]\s+/, ""));
    else {
      flush();
      out.push(<p key={out.length}>{bold(l)}</p>);
    }
  }
  flush();
  return <>{out}</>;
}

/** Copies a link; says "Copied" for a moment. */
export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Task types in plain words. */
export const TYPE_LABEL: Record<string, string> = {
  page: "New website page",
  content: "Website content",
  fix: "Website fix",
  social: "Social post",
  listing: "Play Store listing",
  partner: "Partner outreach",
  experiment: "Experiment",
  research: "Research",
  decision: "Decision",
  ops: "Other",
};
