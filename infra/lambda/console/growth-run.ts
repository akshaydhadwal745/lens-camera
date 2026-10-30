// GrowthAnalyst Lambda entry (container image with the Claude Code CLI, infra/growth-image):
// weekly from EventBridge, or on demand from the Console (POST /growth/run).
import { runDraft, runGrowthReport } from './growth';

export async function handler(event: { growth?: boolean; ai?: boolean; by?: string; lockAt?: number; draft?: { taskId: string } }) {
  if (event.draft && typeof event.draft.taskId === 'string') return runDraft({ taskId: event.draft.taskId, by: event.by ?? 'console', lockAt: typeof event.lockAt === 'number' ? event.lockAt : undefined });
  return runGrowthReport({ ai: event.ai !== false, by: event.by ?? 'schedule', lockAt: typeof event.lockAt === 'number' ? event.lockAt : undefined });
}
