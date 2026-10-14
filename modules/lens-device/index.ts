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
  galleryAccess?(): Promise<{ granted: boolean; canAskAgain?: boolean; status?: string }>;
  requestGalleryAccess?(): Promise<{ granted: boolean; canAskAgain?: boolean; status?: string }>;
  findGalleryItem?(hint: string, size: number, dateTaken: number | null): Promise<string[]>;
  md5OfContent?(uri: string): Promise<string | null>;
  deleteGalleryItems?(uris: string[]): Promise<string[]>;
  addListener(event: 'onThermalChange', listener: (e: { level: ThermalLevel }) => void): { remove(): void };
  addListener(event: 'onNearby', listener: (e: { codes: string[] }) => void): { remove(): void };
  nearbyStart?(code: string | null): boolean;
  nearbyStop?(): void;
  supportedAbis?(): string[];
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
 * Android: remove backed-up originals from the phone's gallery (docs/design/switch-features.md §2).
 * Needs the gallery permission (asked only when the user chooses to free space). Null where unavailable.
 */
export const galleryCleanup =
  native?.deleteGalleryItems && native.findGalleryItem && native.md5OfContent && native.galleryAccess && native.requestGalleryAccess
    ? {
        access: async (): Promise<boolean> => (await native.galleryAccess!()).granted,
        requestAccess: async (): Promise<{ granted: boolean; canAskAgain: boolean }> => {
          const r = await native.requestGalleryAccess!();
          return { granted: r.granted, canAskAgain: r.canAskAgain !== false };
        },
        /** Gallery uris that may be this item (same size, taken within 2 s, or the picker's id). */
        find: (hint: string, size: number, dateTaken: number | null): Promise<string[]> => native.findGalleryItem!(hint, size, dateTaken),
        /** MD5 (lowercase hex) of the gallery file, or null if unreadable. */
        md5: (uri: string): Promise<string | null> => native.md5OfContent!(uri),
        /** Deletes (system confirmation on Android 11+); resolves with the uris really gone. */
        remove: (uris: string[]): Promise<string[]> => native.deleteGalleryItems!(uris),
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

/** Android CPU types, best first (e.g. ["arm64-v8a", "armeabi-v7a"]); empty where unknown. */
export function supportedAbis(): string[] {
  try {
    return native?.supportedAbis?.() ?? [];
  } catch {
    return [];
  }
}

/**
 * Nearby Lens users on the same Wi-Fi: announce `code` (null = just look) and
 * get the codes other phones announce. Missing before the step-3 APK.
 */
export const nearbyDiscovery =
  native?.nearbyStart && native.nearbyStop
    ? {
        start(code: string | null, onCodes: (codes: string[]) => void): () => void {
          const sub = native!.addListener('onNearby', (e) => onCodes(e.codes));
          native!.nearbyStart!(code);
          return () => {
            sub.remove();
            native!.nearbyStop!();
          };
        },
      }
    : null;

