// GrowthAnalyst Lambda entry (container image with the Claude Code CLI, infra/growth-image):
// weekly from EventBridge, or on demand from the Console (POST /growth/run).
import { runDraft, runGrowthReport } from './growth';
import { watchCompetitors } from './growth-competitors';
import { runSeoAudit } from './growth-seo';
import { indexCoverage } from '../api/search-console';

export async function handler(event: { growth?: boolean; ai?: boolean; by?: string; lockAt?: number; draft?: { taskId: string }; seoAudit?: boolean; competitors?: boolean }) {
  if (event.competitors) return watchCompetitors();
  if (event.seoAudit) {
    const cov = await indexCoverage().catch(() => undefined);
    return runSeoAudit(Date.now(), cov?.stateOf ?? {});
  }
  if (event.draft && typeof event.draft.taskId === 'string') return runDraft({ taskId: event.draft.taskId, by: event.by ?? 'console', lockAt: typeof event.lockAt === 'number' ? event.lockAt : undefined });
  return runGrowthReport({ ai: event.ai !== false, by: event.by ?? 'schedule', lockAt: typeof event.lockAt === 'number' ? event.lockAt : undefined });
}
