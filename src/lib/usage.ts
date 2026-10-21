// Feature counts for our own product analytics (Lens Console → Analytics). The app counts how
// often features are used per day — names and numbers only, never photos, text, places or
// people — and sends them a few times a day (POST /v1/usage, infra/lambda/api/usage.ts).
// Off when Settings → "Help improve Lens" is off (the same switch as camera diagnostics).
import { AppState, Platform } from 'react-native';

import { api } from './api';
import { buildInfo } from './build-info';
import { diagnosticsEnabled } from './diagnostics';
import { loadDoc, saveDoc } from './local-store';

type Counts = Record<string, number>;
type Doc = { days: Record<string, Counts>; pending?: { batch: string; days: { day: string; counts: Counts }[] }; sentAt?: number };

const DOC = 'usage-counts';
const SEND_EVERY_MS = 6 * 3600_000;
const FEATURE = /^[a-z][a-z0-9_]{1,40}$/;

let doc: Doc | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let sending = false;

const load = (): Doc => (doc ??= loadDoc<Doc>(DOC, { days: {} }));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (doc) saveDoc(DOC, doc);
  }, 2000);
}

/** Counts one use of a feature today (no-op when the user turned it off). */
export function track(feature: string, n = 1) {
  if (!FEATURE.test(feature) || !diagnosticsEnabled()) return;
  const d = load();
  const day = today();
  const counts = (d.days[day] ??= {});
  counts[feature] = Math.min(100_000, (counts[feature] ?? 0) + n);
  persist();
}

/** The user turned "Help improve Lens" off: drop what wasn't sent. */
export function clearUsage() {
  doc = { days: {} };
  saveDoc(DOC, doc);
}

const randomBatch = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

function region(): string | undefined {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    const m = /[-_]([A-Z]{2})\b/.exec(locale);
    return m?.[1];
  } catch {
    return undefined;
  }
}

/** Sends the counts if it's been a while (also re-sends an unconfirmed batch with the same id). */
export async function sendUsage(force = false) {
  if (sending || !diagnosticsEnabled() || Platform.OS === 'web') return;
  const d = load();
  if (!force && !d.pending && d.sentAt && Date.now() - d.sentAt < SEND_EVERY_MS) return;
  if (!d.pending) {
    const days = Object.entries(d.days)
      .filter(([, c]) => Object.keys(c).length)
      .map(([day, counts]) => ({ day, counts }));
    if (!days.length) return;
    d.pending = { batch: randomBatch(), days };
    d.days = {};
    saveDoc(DOC, d);
  }
  sending = true;
  try {
    const b = buildInfo();
    await api.usage({
      batch: d.pending.batch,
      build: b.apk ? `dev-${b.apk}` : undefined,
      os: `${Platform.OS} ${String(Platform.Version)}`.slice(0, 20),
      region: region(),
      days: d.pending.days,
    });
    d.pending = undefined;
    d.sentAt = Date.now();
    saveDoc(DOC, d);
  } catch {
    // Offline or signed out: the same batch goes next time (counted once on the server).
  } finally {
    sending = false;
  }
}

let started = false;
/** Once at app start: counts the open and sends when the app comes to the front. */
export function startUsage() {
  if (started) return;
  started = true;
  track('app_open');
  setTimeout(() => void sendUsage(), 20_000);
  AppState.addEventListener('change', (s) => {
    if (s === 'active') {
      track('app_open');
      void sendUsage();
    } else if (s === 'background' && doc) {
      saveDoc(DOC, doc);
    }
  });
}
