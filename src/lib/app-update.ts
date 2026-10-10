// New APKs for apps installed from our website (not from a store).
//
// Over-the-air updates deliver JS only; a build with native changes (camera
// code, a new library) has a different runtime and needs a new APK. Published
// builds are described at <website>/downloads/android/latest.json (written by
// scripts/promote-release.sh); the app offers the right APK for this phone's
// CPU when one is newer and not reachable over the air
// (docs/features/app-distribution.md).
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { supportedAbis } from '../../modules/lens-device';
import { WEB_URL } from './api';

export type ReleaseFile = { url: string; size: number; sha256: string };
export type LatestRelease = {
  build: number;
  commit: string;
  runtime: string;
  publishedAt: string;
  files: Partial<Record<'arm64-v8a' | 'armeabi-v7a', ReleaseFile>>;
};
export type AvailableUpdate = { build: number; url: string; size: number };

const CHECK_EVERY_MS = 6 * 3600 * 1000;
let lastCheck = 0;

/** A newer APK this phone should install, or null (up to date, store install, offline…). */
export async function checkForNewApk(force = false): Promise<AvailableUpdate | null> {
  if (Platform.OS !== 'android' || !WEB_URL) return null;
  if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return null;
  lastCheck = Date.now();
  const installed = Number(Application.nativeBuildVersion ?? 0);
  try {
    const res = await fetch(`${WEB_URL}/downloads/android/latest.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const latest = (await res.json()) as LatestRelease;
    if (!Number.isInteger(latest.build) || latest.build <= installed) return null;
    // Same native code: the over-the-air update already brings this build's JS.
    if (Updates.isEnabled && latest.runtime === Updates.runtimeVersion) return null;
    const abis = supportedAbis();
    const file = abis[0] === 'armeabi-v7a' || (abis.length > 0 && !abis.includes('arm64-v8a')) ? latest.files['armeabi-v7a'] : latest.files['arm64-v8a'];
    return file ? { build: latest.build, url: file.url, size: file.size } : null;
  } catch {
    return null;
  }
}
