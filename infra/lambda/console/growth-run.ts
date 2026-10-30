// GrowthAnalyst Lambda entry (container image with the Claude Code CLI, infra/growth-image):
// weekly from EventBridge, or on demand from the Console (POST /growth/run).
import { runGrowthReport } from './growth';

export async function handler(event: { growth?: boolean; ai?: boolean; by?: string; lockAt?: number }) {
  return runGrowthReport({ ai: event.ai !== false, by: event.by ?? 'schedule', lockAt: typeof event.lockAt === 'number' ? event.lockAt : undefined });
}
