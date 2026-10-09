// Temporary / disposable email providers (yopmail, mailinator, …) can't be used
// to sign in: each sign-in unlocks the full free storage, so throwaway
// addresses would let one person claim it again and again.
// List: data/disposable-domains.txt (refresh with scripts/update-disposable-domains.sh).
import list from './data/disposable-domains.txt';

let domains: Set<string> | null = null;

/** True if the address (or any parent of its domain) is a known disposable provider. */
export function isDisposableEmail(email: string): boolean {
  domains ??= new Set(list.split('\n').filter(Boolean));
  const parts = email.slice(email.lastIndexOf('@') + 1).toLowerCase().split('.');
  // mail.yopmail.com → yopmail.com → …
  for (let i = 0; i < parts.length - 1; i++) {
    if (domains.has(parts.slice(i).join('.'))) return true;
  }
  return false;
}
