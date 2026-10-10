// Pro camera settings, value scales and presets.
import type { CameraMode, Capabilities, Lens, Stabilization } from '../../modules/lens-camera';
import { loadDoc, saveDoc } from './local-store';

export type Grid = 'off' | 'thirds' | 'cross';
export type Guide = 'off' | '1:1' | '4:5' | '16:9' | '2.39:1';
export type ManualParam = 'iso' | 'shutter' | 'wb' | 'focus' | 'ev';

export type ProSettings = {
  /**
   * Pro controls on (manual exposure, RAW, LOG, monitors, looks while
   * shooting…). Off by default: the camera decides everything itself and the
   * screen stays simple (docs/features/simple-camera.md).
   */
  pro: boolean;
  mode: CameraMode;
  position: 'front' | 'back';
  lens: Lens;
  zoom: number;
  flash: 'off' | 'auto' | 'on';
  torch: boolean;
  raw: boolean;
  /** Android 14+: Ultra HDR photos (more range on HDR screens, normal JPEG elsewhere). */
  hdrPhoto: boolean;
  appleLog: boolean;
  videoResolution: '4k' | '1080p';
  timer: 0 | 3 | 10;
  hdrVideo: boolean;
  fps: 24 | 30 | 60;
  stabilization: Stabilization;

  /** Look shown live and attached to new shots (null = none). */
  look: string | null;
  lookIntensity: number;
  /** Save looks into the file instead of as a removable edit. */
  bakeLooks: boolean;
  nightFrames: number;
  portraitAperture: number;

  exposureMode: 'auto' | 'manual';
  iso: number;
  shutter: number;
  ev: number;
  whiteBalanceMode: 'auto' | 'manual';
  temperature: number;
  tint: number;
  focusMode: 'auto' | 'manual';
  lensPosition: number;

  histogram: boolean;
  peaking: boolean;
  zebra: boolean;
  zebraLevel: number;
  falseColor: boolean;
  level: boolean;
  grid: Grid;
  guide: Guide;
};

export const DEFAULT_SETTINGS: ProSettings = {
  pro: false,
  mode: 'photo',
  position: 'back',
  lens: 'wide',
  zoom: 1,
  flash: 'off',
  torch: false,
  raw: false,
  hdrPhoto: true,
  appleLog: false,
  videoResolution: '4k',
  timer: 0,
  hdrVideo: false,
  fps: 30,
  stabilization: 'cinematic',

  look: null,
  lookIntensity: 1,
  bakeLooks: false,
  nightFrames: 6,
  portraitAperture: 2.8,

  exposureMode: 'auto',
  iso: 100,
  shutter: 1 / 120,
  ev: 0,
  whiteBalanceMode: 'auto',
  temperature: 5500,
  tint: 0,
  focusMode: 'auto',
  lensPosition: 0.8,

  histogram: true,
  peaking: false,
  zebra: false,
  zebraLevel: 0.95,
  falseColor: false,
  level: true,
  grid: 'thirds',
  guide: 'off',
};

/**
 * What the camera actually uses. Pro on: the user's settings. Pro off (the
 * default): everything technical is automatic. The saved pro settings are kept
 * untouched, so switching Pro back on restores them.
 */
export function effectiveSettings(s: ProSettings): ProSettings {
  if (s.pro) return s;
  return {
    ...s,
    // Night is automatic in simple mode (low light → multi-frame shot).
    mode: s.mode === 'night' ? 'photo' : s.mode,
    raw: false,
    hdrPhoto: true,
    appleLog: false,
    hdrVideo: false,
    fps: 30,
    timer: 0,
    look: null,
    lookIntensity: 1,
    bakeLooks: false,
    exposureMode: 'auto',
    ev: 0,
    whiteBalanceMode: 'auto',
    focusMode: 'auto',
    histogram: false,
    peaking: false,
    zebra: false,
    falseColor: false,
    level: false,
    grid: 'off',
    guide: 'off',
  };
}

/**
 * Low light, with hysteresis so the Night badge doesn't flicker: on at ISO ≥ 1250
 * (or a slow 1/15 s at ISO ≥ 640), off again only once ISO ≤ 800 and faster than 1/20 s.
 */
export function isLowLight(wasLow: boolean, iso: number, shutter: number): boolean {
  if (wasLow) return !(iso <= 800 && shutter < 1 / 20);
  return iso >= 1250 || (shutter >= 1 / 15 && iso >= 640);
}

/** Frames for an automatic Night shot (fewer than Night mode's default: quicker, less heat). */
export const AUTO_NIGHT_FRAMES = 4;

/** Fields a preset captures (look + exposure + monitoring, not lens/position). */
export const PRESET_KEYS = [
  'mode',
  'raw',
  'hdrPhoto',
  'appleLog',
  'videoResolution',
  'hdrVideo',
  'fps',
  'stabilization',
  'look',
  'lookIntensity',
  'exposureMode',
  'iso',
  'shutter',
  'ev',
  'whiteBalanceMode',
  'temperature',
  'tint',
  'focusMode',
  'lensPosition',
  'histogram',
  'peaking',
  'zebra',
  'zebraLevel',
  'falseColor',
  'grid',
  'guide',
] as const satisfies readonly (keyof ProSettings)[];

export type Preset = { id: string; name: string; settings: Partial<ProSettings> };

export const BUILT_IN_PRESETS: Preset[] = [
  {
    id: 'builtin-daylight',
    name: 'Daylight',
    settings: { exposureMode: 'auto', whiteBalanceMode: 'manual', temperature: 5600, tint: 0, ev: 0, zebra: true, zebraLevel: 0.95 },
  },
  {
    id: 'builtin-night',
    name: 'Night',
    settings: { exposureMode: 'manual', iso: 1600, shutter: 1 / 15, whiteBalanceMode: 'manual', temperature: 3800, histogram: true },
  },
  {
    id: 'builtin-cine',
    name: 'Cine',
    settings: {
      mode: 'video',
      appleLog: true,
      exposureMode: 'manual',
      shutter: 1 / 48,
      iso: 200,
      whiteBalanceMode: 'manual',
      temperature: 5600,
      falseColor: false,
      zebra: true,
      zebraLevel: 0.9,
      guide: '2.39:1',
    },
  },
  {
    id: 'builtin-macro',
    name: 'Focus check',
    settings: { focusMode: 'manual', lensPosition: 0.2, peaking: true },
  },
];

// ---------- Persistence ----------

export function loadSettings(): ProSettings {
  return { ...DEFAULT_SETTINGS, ...loadDoc<Partial<ProSettings>>('pro-camera', {}) };
}

export function saveSettings(settings: ProSettings) {
  saveDoc('pro-camera', settings);
}

export function loadPresets(): Preset[] {
  return loadDoc<Preset[]>('pro-presets', []);
}

export function savePresets(presets: Preset[]) {
  saveDoc('pro-presets', presets);
}

export function snapshotPreset(name: string, settings: ProSettings): Preset {
  const picked: Partial<ProSettings> = {};
  for (const key of PRESET_KEYS) (picked as Record<string, unknown>)[key] = settings[key];
  return { id: `${Date.now().toString(36)}`, name, settings: picked };
}

// ---------- Value scales for the dial ----------

export type Scale = { values: number[]; label: (v: number) => string };

const ISO_STOPS = [
  25, 32, 40, 50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200,
  4000, 5000, 6400, 8000, 10000, 12800,
];

const SHUTTER_STOPS = [
  1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000, 1 / 1600, 1 / 1250, 1 / 1000, 1 / 800, 1 / 640,
  1 / 500, 1 / 400, 1 / 320, 1 / 250, 1 / 200, 1 / 160, 1 / 125, 1 / 120, 1 / 100, 1 / 96, 1 / 80, 1 / 60, 1 / 50, 1 / 48,
  1 / 40, 1 / 30, 1 / 25, 1 / 24, 1 / 20, 1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 1 / 2, 0.7, 1,
];

export function formatShutter(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  if (seconds >= 0.7) return `${seconds.toFixed(seconds >= 1 ? 0 : 1)}″`;
  return `1/${Math.round(1 / seconds)}`;
}

export function formatEv(ev: number): string {
  const rounded = Math.round(ev * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

export function formatFocus(position: number): string {
  if (position >= 0.98) return '∞';
  return `${Math.round(position * 100)}`;
}

function within(values: number[], min: number, max: number): number[] {
  const inside = values.filter((v) => v >= min - 1e-9 && v <= max + 1e-9);
  return inside.length ? inside : [min, max];
}

export function scaleFor(param: ManualParam, caps: Capabilities | null): Scale {
  switch (param) {
    case 'iso':
      return {
        values: within(ISO_STOPS, caps?.minISO ?? 25, caps?.maxISO ?? 3200),
        label: (v) => `${Math.round(v)}`,
      };
    case 'shutter':
      return {
        values: within(SHUTTER_STOPS, caps?.minShutter ?? 1 / 8000, caps?.maxShutter ?? 1),
        label: formatShutter,
      };
    case 'wb': {
      const values: number[] = [];
      for (let k = 2000; k <= 10000; k += 100) values.push(k);
      return { values, label: (v) => `${Math.round(v)}K` };
    }
    case 'focus': {
      const values: number[] = [];
      for (let i = 0; i <= 100; i++) values.push(i / 100);
      return { values, label: formatFocus };
    }
    case 'ev': {
      const min = Math.max(caps?.minEV ?? -3, -3);
      const max = Math.min(caps?.maxEV ?? 3, 3);
      const values: number[] = [];
      for (let v = Math.ceil(min * 3) / 3; v <= max + 1e-9; v += 1 / 3) values.push(Math.round(v * 100) / 100);
      return { values, label: formatEv };
    }
  }
}

export function nearestIndex(values: number[], value: number): number {
  let best = 0;
  let bestDistance = Infinity;
  values.forEach((v, i) => {
    // Compare in log space for exposure values so stops feel even.
    const d = v > 0 && value > 0 ? Math.abs(Math.log(v) - Math.log(value)) : Math.abs(v - value);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  return best;
}
