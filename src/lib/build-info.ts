// Which build is running, for the Settings footer and bug reports.
//
// Two numbers, because over-the-air updates replace the JS without a new APK:
// - apk:  the installed APK's CI build (Android versionCode = dev-N release).
// - code: the CI build of the JS that's running (the APK's own, or an update).
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

export type BuildInfo = {
  apk: string | null;
  code: string | null;
  commit: string | null;
  /** True when running an over-the-air update rather than the APK's own JS. */
  update: boolean;
  runtime: string | null;
};

export function buildInfo(): BuildInfo {
  const native = Platform.OS === 'web' ? null : Application.nativeBuildVersion;
  return {
    // versionCode 1 = an APK from before build numbers were stamped (≤ dev-33).
    apk: native && native !== '1' ? native : null,
    code: process.env.EXPO_PUBLIC_BUILD ?? null,
    commit: process.env.EXPO_PUBLIC_COMMIT?.slice(0, 7) ?? null,
    update: Updates.isEnabled && !Updates.isEmbeddedLaunch,
    runtime: Updates.isEnabled ? Updates.runtimeVersion : null,
  };
}

/** e.g. "APK dev-34 · code dev-36 (abc1234, update)". */
export function buildLabel(info = buildInfo()): string {
  const apk = info.apk ? `APK dev-${info.apk}` : Platform.OS === 'web' ? 'Web' : 'APK ≤ dev-33';
  const code = info.code ? `code dev-${info.code}` : 'code local';
  const extra = [info.commit, info.update ? 'update' : null].filter(Boolean).join(', ');
  return `${apk} · ${code}${extra ? ` (${extra})` : ''}`;
}
