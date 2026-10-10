// Device signals (thermal level). Falls back to "normal" where the native
// module isn't available (Expo Go, web).
import { requireOptionalNativeModule } from 'expo';

export type ThermalLevel = 'normal' | 'warm' | 'hot' | 'critical';

/** A photo/video the user picked from their phone gallery: a content:// link, not a copy. */
export type PickedMedia = {
  uri: string;
  mimeType: string | null;
  name: string | null;
  size: number | null;
  /** Milliseconds since 1970 (when it was taken, or last modified). */
  dateTaken: number | null;
  width: number | null;
  height: number | null;
  /** Seconds (videos). */
  duration: number | null;
};

type LensDeviceNative = {
  thermalLevel(): ThermalLevel;
  startBackup(text: string): boolean;
  updateBackup(text: string, progress: number): void;
  stopBackup(): void;
  installReferrer(): Promise<string | null>;
  isEmulator(): boolean;
  pickMedia(max: number): Promise<PickedMedia[]>;
  canRead(uri: string): boolean;
  copyMedia(uri: string, destination: string): Promise<number>;
  addListener(event: 'onThermalChange', listener: (e: { level: ThermalLevel }) => void): { remove(): void };
  testLoop?(): { scenario: number; resultUri: string | null } | null;
  writeTestResult?(uri: string, text: string): Promise<boolean>;
  finishTestLoop?(): void;
  setOrientation?(value: 'portrait' | 'landscape' | 'reverseLandscape' | 'auto'): void;
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

/** Android: the Play install referrer ("lens_ref=…") of this install, if any. */
export async function installReferrer(): Promise<string | undefined> {
  try {
    return (await native?.installReferrer()) ?? undefined;
  } catch {
    return undefined;
  }
}

/** True on an emulator/simulator (best guess). */
export function isEmulator(): boolean {
  try {
    return native?.isEmulator() ?? false;
  } catch {
    return false;
  }
}

/** Android: the user picks photos/videos from their gallery (max per pick). Null where unavailable. */
export const mediaPicker = native?.pickMedia
  ? {
      pick: (max = 100): Promise<PickedMedia[]> => native.pickMedia(max),
      /** Copies the picked item's exact bytes to `destination` (file:// URI); returns the size. */
      copy: (uri: string, destination: string): Promise<number> => native.copyMedia(uri, destination),
      canRead: (uri: string): boolean => {
        try {
          return native.canRead(uri);
        } catch {
          return false;
        }
      },
    }
  : null;

/**
 * Self-test hooks (Android). `launch`: set when Firebase Test Lab started the
 * app as a "game loop" (it then runs the camera self-test and finishes).
 */
export const selfTestHooks = {
  launch(): { scenario: number; resultUri: string | null } | null {
    try {
      return native?.testLoop?.() ?? null;
    } catch {
      return null;
    }
  },
  writeResult: (uri: string, text: string): Promise<boolean> => native?.writeTestResult?.(uri, text) ?? Promise.resolve(false),
  finish: () => native?.finishTestLoop?.(),
  /** Forces the screen orientation ("auto" = follow the phone again). */
  setOrientation: (value: 'portrait' | 'landscape' | 'reverseLandscape' | 'auto') => native?.setOrientation?.(value),
  available: () => typeof native?.setOrientation === 'function',
};
