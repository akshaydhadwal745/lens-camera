// Phone-side state for the Lens Plus offer card (rules: plus-prompt-rules.ts).
import { loadDoc, saveDoc } from './local-store';
import { decidePlus, PlusContext, PlusPromptState, PlusReason } from './plus-prompt-rules';

export type { PlusReason } from './plus-prompt-rules';

const DOC = 'plus-prompt';
const load = () => loadDoc<PlusPromptState>(DOC, { shown: [] });

export function nextPlusOffer(ctx: PlusContext, now = Date.now()): PlusReason | null {
  return decidePlus(load(), ctx, now);
}

export function markPlusShown(reason: PlusReason, now = Date.now()) {
  const s = load();
  saveDoc(DOC, { ...s, shown: [...s.shown.filter((x) => now - x.at < 400 * 86_400_000), { at: now, reason }] });
}

export function markPlusNever() {
  saveDoc(DOC, { ...load(), never: true });
}

/** A recap was opened: the next calm moment in the roll may offer Plus. */
export function markRecapSeen(now = Date.now()) {
  saveDoc(DOC, { ...load(), recapSeenAt: now });
}
