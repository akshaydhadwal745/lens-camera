// Growth workspace (docs/growth/growth-workspace.md): one data load, sub-pages by path, the task
// panel on ?task=, and the new-task panel.
import { useEffect, useState } from "react";

import { get } from "../../api";
import { Loaded, Page, useLoad } from "../../ui";
import { Goals, Tasks, Today } from "./main-views";
import { GrowthSettings, Insights, StartHere } from "./other-views";
import { WS, type Workspace, type Workstream } from "./shared";
import { Competitors } from "./competitors";
import { MoneyPage } from "./money";
import { MonthlyReviews } from "./monthly";
import { SeoTools } from "./seo";
import { NewTask, TaskPanel } from "./task-panel";
import { ContentCalendar, Ga4Page, Integrations } from "./website";
import { WorkstreamPage } from "./workstreams";

const TITLES: Record<string, string> = {
  "": "Today",
  goals: "Goals & roadmap",
  tasks: "Tasks",
  insights: "Insights",
  settings: "Growth settings",
  start: "Start here",
  seo: "SEO tools",
  competitors: "Competitors",
  money: "Campaigns & budget",
  analytics: "Website analytics (GA4)",
  calendar: "Content calendar",
  integrations: "Integrations",
};

export function GrowthWorkspace({ path }: { path: string }) {
  const [url] = path.split("?");
  const search = new URLSearchParams(path.split("?")[1] ?? "");
  const sub = url.replace(/^\/growth\/?/, "").replace(/\/$/, "");
  const [n, setN] = useState(0);
  const state = useLoad(() => get<Workspace>("/growth/workspace"), [n]);
  const reload = () => setN((x) => x + 1);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const f = () => reload();
    addEventListener("growth-reload", f);
    return () => removeEventListener("growth-reload", f);
  }, []);
  const wsKey = sub.startsWith("ws/")
    ? (sub.slice(3) as Workstream)
    : sub === "partners"
      ? "partners"
      : null;
  const title = wsKey
    ? (WS[wsKey]?.label ?? "Workstream")
    : (TITLES[sub] ?? "Growth");
  const taskId = search.get("task");
  return (
    <Page title={title}>
      <span className="gw-wide" hidden />
      <Loaded state={state}>
        {(ws) => (
          <>
            {sub === "" && <Today ws={ws} onNew={() => setCreating(true)} />}
            {sub === "goals" && <Goals ws={ws} onChanged={reload} />}
            {sub === "tasks" && (
              <Tasks ws={ws} search={search} onNew={() => setCreating(true)} />
            )}
            {sub === "insights" && (
              <div className="gw-stack">
                <MonthlyReviews ws={ws} search={search} />
                <Insights ws={ws} onChanged={reload} />
              </div>
            )}
            {sub === "settings" && (
              <GrowthSettings ws={ws} onChanged={reload} />
            )}
            {sub === "start" && <StartHere ws={ws} />}
            {sub === "seo" && <SeoTools ws={ws} search={search} />}
            {sub === "competitors" && <Competitors ws={ws} />}
            {sub === "money" && <MoneyPage ws={ws} />}
            {sub === "analytics" && <Ga4Page />}
            {sub === "calendar" && <ContentCalendar />}
            {sub === "integrations" && <Integrations />}
            {wsKey && WS[wsKey] && (
              <WorkstreamPage
                ws={ws}
                k={wsKey}
                onNew={() => setCreating(true)}
              />
            )}
            {taskId && <TaskPanel id={taskId} ws={ws} onChanged={reload} />}
            {creating && (
              <NewTask
                ws={ws}
                defaults={wsKey ? { workstream: wsKey } : undefined}
                onDone={(id) => {
                  setCreating(false);
                  if (id) {
                    reload();
                    const u = new URL(location.href);
                    u.searchParams.set("task", id);
                    history.pushState(null, "", u);
                    dispatchEvent(new PopStateEvent("popstate"));
                  }
                }}
              />
            )}
          </>
        )}
      </Loaded>
    </Page>
  );
}
