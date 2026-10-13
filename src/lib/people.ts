// People: on-device face grouping (docs/design/people.md). On by default where
// that's allowed (user decision 2026-10-13, like Apple/Samsung): the 10 MB face
// model downloads at the first charge on Wi-Fi. In the EU/UK and US the law asks
// for consent first (GDPR, Illinois BIPA, Texas, Washington): one tap turns it on.
// Turning it off deletes the model and every bit of face data, and stays off.
// Nothing here goes online except that one model download from our site.
import { LensPeople } from '../../modules/lens-camera';
import { WEB_URL } from './api';
import { loadDoc, saveDoc } from './local-store';

/** Countries where People waits for one tap (EU/EEA, UK, Switzerland, US). Unknown country: ask too. */
const ASK_FIRST = new Set(
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH US'.split(' '),
);
type Choice = { choice: 'on' | 'off' };
const choice = () => loadDoc<Choice | null>('people-choice', null)?.choice;

/** True where People must be turned on by the user (one tap) instead of being on by default. */
export function peopleAsksFirst(): boolean {
  try {
    const c = LensPeople?.country() ?? '';
    return !c || ASK_FIRST.has(c);
  } catch {
    return true;
  }
}

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
  saveDoc('people-choice', { choice: 'on' });
}

/** Off = "Delete all face data": database and model removed, and it stays off (never auto-on again). */
export async function turnPeopleOff(): Promise<void> {
  await LensPeople?.disable();
  saveDoc('people-choice', { choice: 'off' });
}

/** App start: on by default where allowed (unless the user turned it off); keep the charging job scheduled. */
export function peopleAppStart() {
  if (!peopleSupported || !LensPeople) return;
  try {
    if (!choice() && !peopleAsksFirst()) LensPeople.autoEnable(PEOPLE_MODEL.url, PEOPLE_MODEL.sha256);
    LensPeople.ensureScheduled();
  } catch {
    // Older APK without these functions: People stays as the user left it.
  }
}

export function photoCount(n: number) {
  return `${n} photo${n === 1 ? '' : 's'}`;
}
