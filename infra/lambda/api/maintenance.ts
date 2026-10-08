// Daily scheduled job (EventBridge). Not reachable from the internet. Tests
// invoke it directly with {"now": <ms>, "onlyOwner": "<identity id>"} to
// simulate a later date for one throwaway identity only.
import { runMaintenance } from './trash';

export async function handler(event: { now?: unknown; onlyOwner?: unknown }) {
  const simulated = typeof event?.now === 'number';
  if (simulated && typeof event.onlyOwner !== 'string') throw new Error('Simulated dates need onlyOwner');
  const now = simulated ? (event.now as number) : Date.now();
  const stats = await runMaintenance(now, simulated ? (event.onlyOwner as string) : undefined);
  console.log('maintenance', JSON.stringify(stats));
  return stats;
}
