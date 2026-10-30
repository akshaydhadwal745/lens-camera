// Daily scheduled job (EventBridge). Not reachable from the internet. Tests
// invoke it directly with {"now": <ms>, "onlyOwner": "<identity id>"} to
// simulate a later date for one throwaway identity only.
import { continueAccountDeletion, pendingDeletions, startBackgroundDeletion } from './account';
import { runMaintenance } from './trash';
import { approveDueCommissions, Purchase, recordPurchase, recordRefund } from './affiliates';
import { retryFeedbackEmails } from './feedback';
import { runCampaigns } from './campaigns';
import { runLifecycle } from './lifecycle';
import { advancePlans } from './plans';
import { scanTable } from './table-scan';
import { reconcileDue } from './payments';
import { resumeStalled, runMove, settleAwaiting } from './drive-move';
import { resumeExports, runExport } from './export';
import { lambdaContinue } from './continue';
import { pullIntegrations } from './growth-integrations';
import { pullGa4Snapshot, pullSearchConsole } from './search-console';

type Event = {
  now?: unknown;
  onlyOwner?: unknown;
  deleteAccount?: unknown;
  /** Until Play Billing is wired: verified purchases/refunds arrive here (tests use this too). */
  purchase?: Purchase;
  refund?: { orderId: string; at?: number };
  /** Hourly: re-send feedback emails that failed (the feedback itself is already stored). */
  retryFeedbackEmails?: boolean;
  /** Every 15 minutes: campaigns from the Lens Console, and (once an hour) lifecycle notifications. */
  notifications?: boolean;
  /** Tests: one campaign only (never the real ones). */
  runCampaign?: string;
  /** Tests: lifecycle notifications for one throwaway account as of `now`. */
  lifecycle?: { now: number; onlyOwner: string };
  /** Move one account's Lens originals to its Google Drive (drive-move.ts); continues itself. */
  driveMove?: unknown;
  /** Build one account's "download everything" ZIPs (export.ts); continues itself. */
  exportFor?: unknown;
  /** Approve commissions as of `now` for one affiliate (tests). */
  approveCommissions?: { now: number; onlyAffiliate: string };
};

export async function handler(event: Event, context?: { getRemainingTimeInMillis(): number }) {
  if (event?.retryFeedbackEmails) return await retryFeedbackEmails();
  if (typeof event?.driveMove === 'string' || typeof event?.exportFor === 'string') {
    const deadline = Date.now() + Math.max(30_000, (context?.getRemainingTimeInMillis() ?? 600_000) - 60_000);
    const move = typeof event.driveMove === 'string';
    const id = (move ? event.driveMove : event.exportFor) as string;
    const done = move ? await runMove(id, deadline) : await runExport(id, deadline);
    if (!done) await lambdaContinue(move ? { driveMove: id } : { exportFor: id });
    console.log(move ? 'drive move' : 'export', id, done ? 'stopped' : 'continues');
    return { done };
  }
  if (typeof event?.runCampaign === 'string') return { campaigns: await runCampaigns(Date.now(), Date.now() + 60_000, event.runCampaign) };
  if (event?.notifications || event?.lifecycle) {
    const until = Date.now() + Math.max(30_000, (context?.getRemainingTimeInMillis() ?? 600_000) - 60_000);
    if (event.lifecycle) return { lifecycle: await runLifecycle(event.lifecycle.now, until, event.lifecycle.onlyOwner) };
    const now = Date.now();
    // Paid plans: renewals that never came → 7-day grace; grace or cancelled plans that ran out → Free.
    const rows = await scanTable(['pk', 'sk', 'plan', 'sub', 'status', 'updatedAt', 'linkId']);
    // Razorpay first: a renewal that went through moves periodEnd before advancePlans looks at it.
    const subs = rows.filter((r) => r.sk === 'PROFILE' && r.sub).map((r) => ({ id: String(r.pk).slice(2), sub: r.sub, plan: r.plan }));
    const reconciled = await reconcileDue(subs, now).catch((e) => (console.error('reconcile', e), -1));
    const jobs = rows.filter((r) => r.sk === 'MOVE' || r.sk === 'EXPORT') as { pk: string; sk: string; status?: string; updatedAt?: number; linkId?: string }[];
    await settleAwaiting(jobs, now).catch((e) => console.error('settle', e));
    await resumeStalled(jobs, now).catch((e) => console.error('moves', e));
    await resumeExports(jobs, now).catch((e) => console.error('exports', e));
    const withPlans = (await scanTable(['pk', 'sk', 'plan'])).filter((r) => r.sk === 'PROFILE' && r.plan).map((r) => ({ id: String(r.pk).slice(2), plan: r.plan }));
    const planChanges = await advancePlans(withPlans, now);
    const campaigns = await runCampaigns(now, until);
    const lifecycle = new Date(now).getUTCMinutes() < 15 ? await runLifecycle(now, until) : {};
    console.log('notifications', JSON.stringify({ planChanges, reconciled, campaigns, lifecycle }));
    return { planChanges, campaigns, lifecycle };
  }
  if (event?.purchase) return { status: await recordPurchase(event.purchase) };
  if (event?.refund) return { status: await recordRefund(event.refund.orderId, event.refund.at) };
  if (event?.approveCommissions) {
    return { approved: await approveDueCommissions(event.approveCommissions.now, event.approveCommissions.onlyAffiliate) };
  }
  // Leave a minute to hand over to a fresh run.
  const deadline = Date.now() + Math.max(30_000, (context?.getRemainingTimeInMillis() ?? 600_000) - 60_000);
  if (typeof event?.deleteAccount === 'string') {
    const done = await continueAccountDeletion(event.deleteAccount, deadline);
    if (!done) await startBackgroundDeletion(event.deleteAccount);
    console.log('account deletion', event.deleteAccount, done ? 'done' : 'continues');
    return { deleted: done };
  }
  const simulated = typeof event?.now === 'number';
  if (simulated && typeof event.onlyOwner !== 'string') throw new Error('Simulated dates need onlyOwner');
  const now = simulated ? (event.now as number) : Date.now();
  const stats = await runMaintenance(now, simulated ? (event.onlyOwner as string) : undefined);
  // Account deletions that didn't finish (a run timed out or failed): resume them.
  if (!simulated) for (const id of await pendingDeletions()) await startBackgroundDeletion(id);
  if (!simulated) Object.assign(stats, { commissionsApproved: await approveDueCommissions(now), feedbackEmails: await retryFeedbackEmails() });
  // Growth data (docs/growth/growth-engine.md M5): never lets a Google hiccup fail the daily run.
  if (!simulated) Object.assign(stats, { searchConsole: await pullSearchConsole(now).catch((e: Error) => `failed: ${e.message.slice(0, 120)}`) });
  if (!simulated) Object.assign(stats, { ga4: await pullGa4Snapshot(now).catch((e: Error) => `failed: ${e.message.slice(0, 120)}`) });
  if (!simulated) Object.assign(stats, { integrations: await pullIntegrations(now).catch((e: Error) => `failed: ${e.message.slice(0, 120)}`) });
  console.log('maintenance', JSON.stringify(stats));
  return stats;
}
