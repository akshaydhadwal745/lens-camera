// "My Lens code": a QR that names exactly one person, so a sender never has to
// pick between look-alike names (quiet-tiger-8703 vs quiet-tiger-8730).
// The share screen opens the scanner; a scanned code hands the person back here.
import type { Person } from './api';

const WEB = process.env.EXPO_PUBLIC_WEB_URL ?? 'https://lens.instagrowapp.com';

export function personCodeUrl(id: string): string {
  return `${WEB.replace(/\/$/, '')}/u/${encodeURIComponent(id)}`;
}

/** The identity id in a scanned Lens person code, or null. */
export function parsePersonCode(data: string): string | null {
  const m = /^https:\/\/[^/]+\/u\/([A-Za-z0-9_-]{6,64})\/?$/.exec(data.trim());
  return m ? m[1] : null;
}

type Listener = (person: Person) => void;
let listener: Listener | null = null;

/** Share screen: receive the person a scan picked (one listener at a time). */
export function onPersonPicked(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

export function pickPerson(person: Person) {
  listener?.(person);
}
