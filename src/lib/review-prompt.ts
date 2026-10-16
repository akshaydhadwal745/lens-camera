// The feedback loop: Lens asks for a rating (and "what's missing?") at good
// moments instead of waiting for people to find Settings → Feedback.
//
// Rules (docs/features/feedback.md):
// - Only real users: 5+ app opens over 3+ days, 10+ photos, everything backed up
//   (a calm, happy moment). Shown in the roll, never in the camera.
// - Rate first ("How's Lens so far?"); after that, a single "What's one thing
//   Lens is missing?" question when the quiet period is over.
// - At most one ask per 30 days, 3 per year; 4 months of quiet after an answer;
//   "Don't ask again" is final. All state is on the phone.
import { loadDoc, saveDoc } from './local-store';
import { decidePrompt, PromptKind, PromptState } from './review-prompt-rules';

export type { PromptKind } from './review-prompt-rules';

const DOC = 'review-prompt';
const DAY = 86_400_000;

function load(): PromptState {
  return loadDoc<PromptState>(DOC, { opens: 0, firstOpenAt: 0, asks: [] });
}

function save(s: PromptState) {
  saveDoc(DOC, s);
}

let countedThisLaunch = false;

/** Once per app launch (cold start). */
export function recordAppOpen(now = Date.now()) {
  if (countedThisLaunch) return;
  countedThisLaunch = true;
  const s = load();
  save({ ...s, opens: s.opens + 1, firstOpenAt: s.firstOpenAt || now });
}

export function nextPrompt(ctx: { photos: number; calm: boolean }, now = Date.now()): PromptKind | null {
  return decidePrompt(load(), now, ctx);
}

/** The card was shown (counts toward the 30-day gap and the yearly limit). */
export function markPromptShown(now = Date.now()) {
  const s = load();
  save({ ...s, asks: [...s.asks.filter((t) => now - t < 365 * DAY), now] });
}

export function markRated(stars: number, now = Date.now()) {
  save({ ...load(), ratedAt: now, rating: stars });
}

export function markMissingAnswered(now = Date.now()) {
  save({ ...load(), missingAt: now });
}

export function markNeverAsk() {
  save({ ...load(), never: true });
}
