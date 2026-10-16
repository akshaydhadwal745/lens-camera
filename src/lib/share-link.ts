// Share links (docs/features/share-links.md): lens.instagrowapp.com/s/<token>.
// Opened directly (App Link), from a scanned QR, from the install referrer
// (Play: lens_share=<token>) or, once on the first launch after a website
// install, from the clipboard the web page filled when "Get Lens" was tapped.
import * as Clipboard from 'expo-clipboard';

import { loadDoc, saveDoc } from './local-store';

const TOKEN = '[A-Za-z0-9_-]{22}';
const LINK = new RegExp(`(?:https://[a-z0-9.-]+/s/|lens://s/)(${TOKEN})(?:[/?#]|$)`);
const PENDING_DOC = 'share-link-pending';

/** The token in a share link (anywhere in the text), or null. */
export function parseShareLink(text: string | null | undefined): string | null {
  return LINK.exec(text?.trim() ?? '')?.[1] ?? null;
}

/** First launch of a new install: remember to look for the link it came from (src/lib/identity.ts). */
export function markFreshInstall(installReferrer: string | undefined) {
  const fromPlay = /(?:^|&)lens_share=([A-Za-z0-9_-]{22})(?:&|$)/.exec(decodeURIComponent(installReferrer ?? ''))?.[1];
  saveDoc(PENDING_DOC, { token: fromPlay ?? null, checkClipboard: !fromPlay });
}

/**
 * Once, right after a fresh install: the link the person came from, or null.
 * Clipboard only on that first launch and only a Lens share link is taken.
 */
export async function takePendingShareLink(): Promise<string | null> {
  const pending = loadDoc<{ token: string | null; checkClipboard: boolean } | null>(PENDING_DOC, null);
  if (!pending) return null;
  saveDoc(PENDING_DOC, null);
  if (pending.token) return pending.token;
  if (!pending.checkClipboard) return null;
  try {
    if (!(await Clipboard.hasStringAsync())) return null;
    return parseShareLink(await Clipboard.getStringAsync());
  } catch {
    return null;
  }
}
