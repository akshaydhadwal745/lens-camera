// Automatic backup of the phone's own camera (opt-in): photos and videos taken with any camera app
// land in the phone's camera folders (DCIM); Lens picks up the new ones when it opens, when it
// comes to the front, and in its periodic background run (src/lib/background.ts). They go through
// the normal import pipeline: copied just before upload, MD5-checked, duplicates skipped, and the
// copy removed once it's in the cloud. Only the camera folders: never WhatsApp, screenshots or
// other apps' pictures. Needs the gallery permission (asked when the user turns it on).
import { galleryCleanup, galleryWatch } from '../../modules/lens-device';
import { loadDoc, saveDoc } from './local-store';

type Doc = { enabled?: boolean; since?: number; offered?: boolean; enabledAt?: number };
const DOC = 'auto-backup';
const PAGE = 200;

/** This phone's app can do it (needs the APK that added the gallery query). */
export const autoBackupSupported = !!galleryWatch && !!galleryCleanup;

const load = () => loadDoc<Doc>(DOC, {});

export function autoBackupEnabled(): boolean {
  return autoBackupSupported && load().enabled === true;
}

/** Was the user already asked (first-run card)? */
export const autoBackupOffered = () => load().offered === true;
export const markAutoBackupOffered = () => saveDoc(DOC, { ...load(), offered: true });

/**
 * Turns it on. `fromDays`: also back up what was taken in the last N days (0 = only from now).
 * Returns false if the gallery permission was refused.
 */
export async function enableAutoBackup(fromDays = 0): Promise<boolean> {
  if (!autoBackupSupported) return false;
  const access = (await galleryCleanup!.access()) || (await galleryCleanup!.requestAccess()).granted;
  if (!access) return false;
  const now = Date.now();
  saveDoc(DOC, { ...load(), enabled: true, offered: true, enabledAt: now, since: fromDays > 0 ? now - fromDays * 86_400_000 : now });
  return true;
}

export function disableAutoBackup() {
  saveDoc(DOC, { ...load(), enabled: false });
}

let scanning: Promise<number> | null = null;

/**
 * New camera items since the last scan, handed to `add` (the store's importer). Returns how many
 * were new. Safe to call often: one scan at a time, and the checkpoint only moves forward.
 */
export function scanCamera(add: (items: Awaited<ReturnType<NonNullable<typeof galleryWatch>['since']>>) => number): Promise<number> {
  if (!autoBackupEnabled()) return Promise.resolve(0);
  scanning ??= (async () => {
    let added = 0;
    try {
      if (!(await galleryCleanup!.access())) return 0; // permission removed in system settings
      for (let page = 0; page < 20; page++) {
        const doc = load();
        const items = await galleryWatch!.since(doc.since ?? Date.now(), PAGE);
        if (!items.length) break;
        added += add(items);
        saveDoc(DOC, { ...doc, since: Math.max(doc.since ?? 0, ...items.map((i) => i.dateAdded)) });
        if (items.length < PAGE) break;
      }
    } catch (e) {
      console.warn('camera scan failed', (e as Error).message);
    } finally {
      scanning = null;
    }
    return added;
  })();
  return scanning;
}
