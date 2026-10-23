// When the roll offers Lens Plus (pure rules; state lives on the phone, src/lib/plus-prompt.ts).
// Owner decision 2026-10-21: offer it at natural moments, never in the camera, never pushy:
//   storage95  95% of Lens storage used           (again after 30 days)
//   storage80  80% used                           (once)
//   welcome    the last week of the 40 GB welcome (once)
//   backups20  20 photos backed up (the lock-in moment)  (once)
//   recap      just watched a trip/event recap    (at most every 30 days)
// At most one offer every 5 days; "Don't show again" is final except at 95% (backups about to pause).

export type PlusReason = 'storage95' | 'storage80' | 'welcome' | 'backups20' | 'recap';
export type PlusPromptState = { shown: { at: number; reason: PlusReason }[]; never?: boolean; recapSeenAt?: number };
export type PlusContext = {
  /** Signed in, Razorpay usable here, not already on (or locked into) Lens Plus. */
  eligible: boolean;
  usedBytes: number;
  quotaBytes: number;
  welcomeUntil?: number;
  backups: number;
};

const DAY = 86_400_000;

export function decidePlus(s: PlusPromptState, ctx: PlusContext, now: number): PlusReason | null {
  if (!ctx.eligible || ctx.quotaBytes <= 0) return null;
  const last = s.shown.reduce((m, x) => Math.max(m, x.at), 0);
  if (now - last < 5 * DAY) return null;
  const lastOf = (r: PlusReason) => s.shown.filter((x) => x.reason === r).reduce((m, x) => Math.max(m, x.at), 0);
  const used = ctx.usedBytes / ctx.quotaBytes;
  if (used >= 0.95 && now - lastOf('storage95') > 30 * DAY) return 'storage95';
  if (s.never) return null;
  if (used >= 0.8 && !lastOf('storage80')) return 'storage80';
  const left = (ctx.welcomeUntil ?? 0) - now;
  if (left > 0 && left <= 7 * DAY && !lastOf('welcome')) return 'welcome';
  if (ctx.backups >= 20 && !lastOf('backups20')) return 'backups20';
  if (s.recapSeenAt && now - s.recapSeenAt < 2 * DAY && now - lastOf('recap') > 30 * DAY) return 'recap';
  return null;
}
