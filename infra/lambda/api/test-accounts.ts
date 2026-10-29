// Which accounts are test traffic, left out of numbers and campaigns (Lens Console):
// accounts flagged `test` (e2e sends x-lens-test), test emails, phones that said they're an
// emulator (from the build after dev-158 also Firebase Test Lab's real phones), for accounts made
// before the flag existed, guests created during an e2e run, and guests from before the Play closed
// test that never signed in (until then only the team used Lens, and all of us signed in; the rest
// were Test Lab phones, which inflated installs and showed D1 retention as 0%).
type Row = Record<string, any>;

const TEST_EMAIL = '@e2e.lens.invalid';
/** Accounts made from here on carry `test` when they're test traffic; older ones are inferred. */
const TEST_FLAG_SINCE = Date.UTC(2026, 9, 22);
const E2E_WINDOW_MS = 4 * 60_000;
/** The Play closed test went live 2026-10-29 ~14:30 IST: the first outside users. */
const OUTSIDE_USERS_SINCE = Date.UTC(2026, 9, 29, 9, 0);

/** Account IDs that are test traffic (see the header comment). */
export function testAccounts(profiles: Row[], devices: Row[]): Set<string> {
  // Phones that said they're an emulator at first start (Test Lab virtual phones, our own emulators).
  const emulators = new Set(devices.filter((d) => d.emulator === true && d.guestId).map((d) => String(d.guestId)));
  const testWindows = profiles.filter((p) => String(p.email ?? '').endsWith(TEST_EMAIL)).map((p) => p.createdAt as number).sort((a, b) => a - b);
  const nearTestRun = (t: number) => {
    let lo = 0;
    let hi = testWindows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (Math.abs(testWindows[mid] - t) <= E2E_WINDOW_MS) return true;
      if (testWindows[mid] < t) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  };
  const test = new Set<string>();
  for (const p of profiles) {
    const id = String(p.pk).slice(2);
    if (p.test || String(p.email ?? '').endsWith(TEST_EMAIL) || emulators.has(id)) test.add(id);
    else if (p.createdAt < TEST_FLAG_SINCE && !p.email && nearTestRun(p.createdAt)) test.add(id);
    else if (p.createdAt < OUTSIDE_USERS_SINCE && !p.email) test.add(id);
  }
  return test;
}
