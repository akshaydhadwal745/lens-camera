// GrowthAnalyst Lambda entry (container image with the Claude Code CLI, infra/growth-image):
// weekly from EventBridge, or on demand from the Console (POST /growth/run).
import { finishJob, runDraft, runGrowthReport, runMonthly } from "./growth";
import { watchCompetitors } from "./growth-competitors";
import { renderPost } from "./growth-media";
import { runSeoAudit } from "./growth-seo";
import { indexCoverage } from "../api/search-console";

export async function handler(event: {
  growth?: boolean;
  ai?: boolean;
  by?: string;
  lockAt?: number;
  draft?: { taskId: string };
  seoAudit?: boolean;
  competitors?: boolean;
  monthly?: boolean;
  month?: string;
  render?: { postId: string };
}) {
  if (event.monthly)
    return runMonthly({
      month: event.month,
      by: event.by ?? "schedule",
      lockAt: typeof event.lockAt === "number" ? event.lockAt : undefined,
    });
  if (event.competitors) return job("competitors", () => watchCompetitors());
  // Content images: no Claude, so outside the analyst lock (one render at a time, see renderStart).
  if (event.render && typeof event.render.postId === "string") {
    const { postId } = event.render;
    return job("render", () => renderPost(postId, event.by ?? "console"));
  }
  if (event.seoAudit)
    return job("seoAudit", async () => {
      const cov = await indexCoverage().catch(() => undefined);
      return runSeoAudit(Date.now(), cov?.stateOf ?? {});
    });
  if (event.draft && typeof event.draft.taskId === "string")
    return runDraft({
      taskId: event.draft.taskId,
      by: event.by ?? "console",
      lockAt: typeof event.lockAt === "number" ? event.lockAt : undefined,
    });
  return runGrowthReport({
    ai: event.ai !== false,
    by: event.by ?? "schedule",
    lockAt: typeof event.lockAt === "number" ? event.lockAt : undefined,
  });
}

/** Runs a job outside the analyst lock and records when it finished (the Console waits for it). */
async function job<T>(
  name: "seoAudit" | "competitors" | "render",
  run: () => Promise<T>,
): Promise<T> {
  try {
    const out = await run();
    await finishJob(name);
    return out;
  } catch (e) {
    await finishJob(name, (e as Error).message);
    throw e;
  }
}
