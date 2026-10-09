// Daily scheduled job (EventBridge). Not reachable from the internet. Tests
// invoke it directly with {"now": <ms>, "onlyOwner": "<identity id>"} to
// simulate a later date for one throwaway identity only.
import { continueAccountDeletion, pendingDeletions, startBackgroundDeletion } from './account';
import { runMaintenance } from './trash';

export async function handler(event: { now?: unknown; onlyOwner?: unknown; deleteAccount?: unknown }, context?: { getRemainingTimeInMillis(): number }) {
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
  console.log('maintenance', JSON.stringify(stats));
  return stats;
}
