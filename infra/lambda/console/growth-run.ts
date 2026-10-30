// GrowthAnalyst Lambda entry (container image with the Claude Code CLI, infra/growth-image):
// weekly from EventBridge, or on demand from the Console (POST /growth/run).
import { runDraft, runGrowthReport, type DraftKind } from './growth';

export async function handler(event: { growth?: boolean; ai?: boolean; by?: string; lockAt?: number; draft?: { kind: DraftKind; id: string } }) {
  if (event.draft && (event.draft.kind === 'opp' || event.draft.kind === 'prop') && typeof event.draft.id === 'string')
    return runDraft({ kind: event.draft.kind, id: event.draft.id, by: event.by ?? 'console', lockAt: typeof event.lockAt === 'number' ? event.lockAt : undefined });
  return runGrowthReport({ ai: event.ai !== false, by: event.by ?? 'schedule', lockAt: typeof event.lockAt === 'number' ? event.lockAt : undefined });
}
