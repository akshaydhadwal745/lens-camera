// Event album links (docs/design/switch-features.md §3): https://lens.instagrowapp.com/e/<code>,
// printed in the album's QR code and shared as a link.

const CODE = /^[A-Za-z0-9_-]{10,16}$/;

/** The event code in a scanned QR / opened link, or null if it isn't a Lens event link. */
export function parseEventCode(text: string): string | null {
  const m = /^https:\/\/lens\.instagrowapp\.com\/e\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(text.trim());
  return m && CODE.test(m[1]) ? m[1] : null;
}
