// Device signals (thermal level). Falls back to "normal" where the native
// module isn't available (Expo Go, web).
import { requireOptionalNativeModule } from 'expo';

export type ThermalLevel = 'normal' | 'warm' | 'hot' | 'critical';

type LensDeviceNative = {
  thermalLevel(): ThermalLevel;
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
