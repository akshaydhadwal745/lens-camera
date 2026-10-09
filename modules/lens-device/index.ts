// Device signals (thermal level). Falls back to "normal" where the native
// module isn't available (Expo Go, web).
import { requireOptionalNativeModule } from 'expo';

export type ThermalLevel = 'normal' | 'warm' | 'hot' | 'critical';

type LensDeviceNative = {
  thermalLevel(): ThermalLevel;
  startBackup(text: string): boolean;
  updateBackup(text: string, progress: number): void;
  stopBackup(): void;
  addListener(event: 'onThermalChange', listener: (e: { level: ThermalLevel }) => void): { remove(): void };
};

const native = requireOptionalNativeModule<LensDeviceNative>('LensDevice');

export function thermalLevel(): ThermalLevel {
  try {
    return native?.thermalLevel() ?? 'normal';
  } catch {
    return 'normal';
  }
}

/** Calls back whenever the phone's heat level changes. Returns an unsubscribe function. */
export function onThermalChange(listener: (level: ThermalLevel) => void): () => void {
  const subscription = native?.addListener('onThermalChange', (e) => listener(e.level));
  return () => subscription?.remove();
}

/**
 * Android: keeps uploads running in the background with a "Backing up…"
 * notification (foreground service + wake/Wi-Fi locks). No-op elsewhere.
 */
export const backupService = {
  start(text: string): boolean {
    try {
      return native?.startBackup(text) ?? false;
    } catch {
      return false;
    }
  },
  update(text: string, progress: number) {
    try {
      native?.updateBackup(text, Math.round(progress));
    } catch {
      // Best effort.
    }
  },
  stop() {
    try {
      native?.stopBackup();
    } catch {
      // Best effort.
    }
  },
};
