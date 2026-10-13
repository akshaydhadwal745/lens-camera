// People: on-device face grouping (docs/design/people.md). Off by default; the
// face model (~10 MB) downloads only when the user turns it on, and turning it
// off deletes the model and every bit of face data. Nothing here goes online
// except that one model download from our site.
import { LensPeople } from '../../modules/lens-camera';
import { WEB_URL } from './api';

export const PEOPLE_MODEL = {
  url: `${WEB_URL}/people/sface-v1.tflite`,
  sha256: '37cf4c81b31c7115a926cb435641ed338fc8722919569d48ecd096dc3aa152e3',
  mb: 10,
};

/** Android with Google Play services and an APK that has People (dev-82+). */
export const peopleSupported = (() => {
  try {
    return !!LensPeople && !!WEB_URL && LensPeople.available();
  } catch {
    return false;
  }
})();

export async function turnPeopleOn(): Promise<void> {
  if (!LensPeople) throw new Error('People is not available on this phone');
  await LensPeople.enable(PEOPLE_MODEL.url, PEOPLE_MODEL.sha256);
}

/** Off = "Delete all face data": database and model removed from the phone. */
export async function turnPeopleOff(): Promise<void> {
  await LensPeople?.disable();
}

/** App start: keep the charging job scheduled while People is on. */
export function peopleAppStart() {
  if (peopleSupported) {
    try {
      LensPeople?.ensureScheduled();
    } catch {
      // Older APK: nothing to schedule.
    }
  }
}

export function photoCount(n: number) {
  return `${n} photo${n === 1 ? '' : 's'}`;
}
