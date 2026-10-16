// When Lens asks for a rating / "what's missing?" (pure, no imports: unit-tested in scripts/test-review-prompt.mjs).
const DAY = 86_400_000;

export type PromptState = {
  opens: number;
  firstOpenAt: number;
  /** Times a card was shown (last 365 days are counted). */
  asks: number[];
  /** Last rating answer (stars) or "missing" answer. */
  ratedAt?: number;
  rating?: number;
  missingAt?: number;
  never?: boolean;
};

export type PromptKind = 'rate' | 'missing';

export const PROMPT_RULES = {
  minOpens: 5,
  minDays: 3,
  minPhotos: 10,
  gapDays: 30,
  quietAfterAnswerDays: 120,
  maxPerYear: 3,
};

/** Pure decision, so it can be unit-tested with any state and date. */
export function decidePrompt(s: PromptState, now: number, ctx: { photos: number; calm: boolean }): PromptKind | null {
  const r = PROMPT_RULES;
  if (s.never || !ctx.calm || ctx.photos < r.minPhotos) return null;
  if (s.opens < r.minOpens || !s.firstOpenAt || now - s.firstOpenAt < r.minDays * DAY) return null;
  const recent = s.asks.filter((t) => now - t < 365 * DAY);
  if (recent.length >= r.maxPerYear) return null;
  const lastAsk = Math.max(0, ...s.asks);
  if (now - lastAsk < r.gapDays * DAY) return null;
  const lastAnswer = Math.max(s.ratedAt ?? 0, s.missingAt ?? 0);
  if (lastAnswer && now - lastAnswer < r.quietAfterAnswerDays * DAY) return null;
  // Rated once: later asks are the single "what's missing?" question.
  return s.ratedAt ? 'missing' : 'rate';
}

