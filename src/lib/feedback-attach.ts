// Screenshots for feedback (Settings → Feedback → Attach screenshot). The user picks them
// from their gallery; each is re-encoded here (longest side ≤ 1600 px, JPEG), which also drops
// all photo metadata (place, camera), then uploaded only when they press Send. The Lens team
// sees them in the Lens Console next to the message (infra/lambda/api/feedback.ts).
import { File, Paths, UploadType } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { mediaPicker } from '../../modules/lens-device';
import { api } from './api';

export const MAX_SCREENSHOTS = 3;
const LONGEST = 1600;

export type Screenshot = { uri: string; width: number; height: number; size: number };

/** Null where the phone has no picker (web): the form hides the button. */
export const canAttach = !!mediaPicker;

/** Lets the user choose up to `max` images; returns them ready to send (videos are skipped). */
export async function pickScreenshots(max: number): Promise<Screenshot[]> {
  if (!mediaPicker || max <= 0) return [];
  const picked = (await mediaPicker.pick(max)).filter((p) => !p.mimeType || p.mimeType.startsWith('image/'));
  const out: Screenshot[] = [];
  for (const p of picked.slice(0, max)) {
    const copy = new File(Paths.cache, `fb-src-${Date.now()}-${out.length}`);
    try {
      await mediaPicker.copy(p.uri, copy.uri);
      const base = await ImageManipulator.manipulate(copy.uri).renderAsync();
      const scaled =
        Math.max(base.width, base.height) > LONGEST
          ? await ImageManipulator.manipulate(base)
              .resize(base.width >= base.height ? { width: LONGEST } : { height: LONGEST })
              .renderAsync()
          : base;
      const saved = await scaled.saveAsync({ format: SaveFormat.JPEG, compress: 0.82 });
      out.push({ uri: saved.uri, width: saved.width, height: saved.height, size: new File(saved.uri).size ?? 0 });
    } finally {
      if (copy.exists) copy.delete();
    }
  }
  return out;
}

/** Uploads the screenshots; returns the keys to send with the feedback. */
export async function uploadScreenshots(shots: Screenshot[]): Promise<string[]> {
  const keys: string[] = [];
  for (const s of shots) {
    const file = new File(s.uri);
    const size = file.size ?? s.size;
    const slot = await api.feedbackAttachment({ contentType: 'image/jpeg', size });
    const result = await file.upload(slot.url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers: { 'content-type': 'image/jpeg' } });
    if (result.status < 200 || result.status >= 300) throw new Error('A screenshot didn’t upload. Check your connection and try again.');
    keys.push(slot.key);
  }
  return keys;
}

export function discardScreenshots(shots: Screenshot[]) {
  for (const s of shots) {
    try {
      const f = new File(s.uri);
      if (f.exists) f.delete();
    } catch {
      // cache files: the system clears them anyway
    }
  }
}
