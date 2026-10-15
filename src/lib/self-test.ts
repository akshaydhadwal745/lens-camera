// Camera self-test (Android): drives the real camera through every mode this
// phone supports and checks each result — photo size vs the camera's maximum,
// orientation in both landscapes, front camera (mirror), every lens, Night,
// astro reach, Portrait, motion photos, the Normal camera's live readers,
// video (real frame rate, sound, pause, trim export), time-lapse, slow motion,
// burst + best-shot pick, RAW / Ultra HDR / maker modes, editor render time,
// Play services models, heat, and (on Test Lab) an upload.
// Runs from Settings → Camera info → Run self-test, and automatically when
// Firebase Test Lab starts the app as a "game loop" (docs/features/self-test.md).
import type { Capabilities, LabExtension, Lens } from '../../modules/lens-camera';

export type Orientation = 'portrait' | 'landscape' | 'reverseLandscape';

export type SelfTestProps = {
  facing: 'back' | 'front';
  lens: Lens;
  mode: 'photo' | 'video' | 'night' | 'portrait' | 'slowmo' | 'timelapse';
  raw: boolean;
  hdrPhoto: boolean;
  extension: LabExtension;
  /** Motion photo ring buffer on (9.2). Viewfinder-side: no camera rebind. */
  motion?: boolean;
  /** The Normal camera's always-on frame readers: QR codes (9.3) + scene labels (5.3). No camera rebind. */
  live?: boolean;
  /** Photo capture: best quality (default) or the phone's quick path (shutter-speed comparison). */
  captureMode?: 'auto' | 'quality' | 'latency' | 'zsl';
};

export const DEFAULT_PROPS: SelfTestProps = { facing: 'back', lens: 'wide', mode: 'photo', raw: false, hdrPhoto: true, extension: 'none' };

/** Props that make the camera rebind (and send a new onReady); motion/live don't. */
export function cameraKey(p: SelfTestProps): string {
  const { motion: _m, live: _l, ...camera } = p;
  return JSON.stringify(camera);
}

export type SelfTestStep = {
  id: string;
  label: string;
  props: SelfTestProps;
  orientation?: Orientation;
  action:
    | 'photo'
    | 'people'
    | 'night'
    | 'video'
    | 'upload'
    | 'burst'
    | 'timelapse'
    | 'motion'
    | 'pause'
    | 'astro'
    | 'burstPick'
    | 'videoExport'
    | 'editRender'
    | 'mlModules'
    | 'heat'
    | 'shutter'
    | 'shutterQuality';
  /** burstPick: false = burst without the switch to the quick capture path. */
  burstQuick?: boolean;
  /** Works on files already captured (or the phone itself): no camera change needed. */
  offline?: boolean;
  /** Photo with the flash forced on (phones with a flash). */
  flash?: 'on';
  /**
   * Rotation steps: the preview must re-bind for this screen rotation. (The
   * photo's own orientation follows the phone's motion sensor, which a phone in
   * a test rack doesn't change, so it isn't checked here.)
   */
  expectScreen?: 'landscape' | 'portrait';
};

export type StepOutcome = {
  id: string;
  label: string;
  /** warn: works, but worth a look (e.g. photo smaller than the sensor's maximum). */
  status: 'pass' | 'warn' | 'fail' | 'skip';
  ms: number;
  message?: string;
  details?: Record<string, unknown>;
};

/** Steps for this phone, from the back camera's capabilities and the device report. */
export function planSelfTest(back: Capabilities, extensions: string[], upload: boolean): SelfTestStep[] {
  const steps: SelfTestStep[] = [
    { id: 'back-photo', label: 'Back camera photo', props: DEFAULT_PROPS, action: 'photo' },
    { id: 'landscape', label: 'Landscape photo', props: DEFAULT_PROPS, orientation: 'landscape', action: 'photo', expectScreen: 'landscape' },
    { id: 'reverse-landscape', label: 'Other landscape photo', props: DEFAULT_PROPS, orientation: 'reverseLandscape', action: 'photo', expectScreen: 'landscape' },
    { id: 'portrait-again', label: 'Back to portrait', props: DEFAULT_PROPS, orientation: 'portrait', action: 'photo', expectScreen: 'portrait' },
  ];
  if (back.flash) steps.push({ id: 'flash', label: 'Flash photo', props: DEFAULT_PROPS, action: 'photo', flash: 'on' });
  for (const l of back.lenses ?? []) {
    if (l.id !== 'wide') steps.push({ id: `lens-${l.id}`, label: `${l.factor}× lens photo`, props: { ...DEFAULT_PROPS, lens: l.id }, action: 'photo' });
  }
  steps.push({ id: 'front-photo', label: 'Front camera photo', props: { ...DEFAULT_PROPS, facing: 'front' }, action: 'photo' });
  // Front "flash": the screen lights up white (or a real front flash where the phone has one).
  steps.push({ id: 'front-flash', label: 'Selfie flash photo', props: { ...DEFAULT_PROPS, facing: 'front' }, action: 'photo', flash: 'on' });
  steps.push({
    id: 'front-landscape',
    label: 'Front camera landscape',
    props: { ...DEFAULT_PROPS, facing: 'front' },
    orientation: 'landscape',
    action: 'photo',
    expectScreen: 'landscape',
  });
  // The Normal camera runs QR + scene-label readers on the viewfinder all the time: what they cost in fps.
  steps.push({ id: 'normal-load', label: 'Normal camera readers (QR + scenes)', props: { ...DEFAULT_PROPS, live: true }, action: 'photo' });
  if (back.motionPhoto) steps.push({ id: 'motion', label: 'Motion photo', props: { ...DEFAULT_PROPS, motion: true }, action: 'motion' });
  const modes = back.modes ?? ['photo', 'video', 'night', 'portrait'];
  if (modes.includes('night')) {
    steps.push({ id: 'night', label: 'Night photo', props: { ...DEFAULT_PROPS, mode: 'night' }, action: 'night' });
    steps.push({ id: 'astro', label: 'Astro reach (long exposures)', props: { ...DEFAULT_PROPS, mode: 'night' }, action: 'astro' });
  }
  if (modes.includes('portrait')) steps.push({ id: 'portrait', label: 'Portrait photo', props: { ...DEFAULT_PROPS, mode: 'portrait' }, action: 'photo' });
  if (modes.includes('video')) {
    steps.push({ id: 'video', label: 'Video (3 s)', props: { ...DEFAULT_PROPS, mode: 'video' }, action: 'video' });
    steps.push({ id: 'video-export', label: 'Video trim + look export', props: DEFAULT_PROPS, action: 'videoExport', offline: true });
    steps.push({ id: 'pause', label: 'Pause and resume recording', props: { ...DEFAULT_PROPS, mode: 'video' }, action: 'pause' });
  }
  // Slow motion (3 s real → about 3 × factor s of clip) and time-lapse (6 s → frames written), where offered.
  if (back.modes?.includes('slowmo')) steps.push({ id: 'slowmo', label: 'Slow motion (3 s)', props: { ...DEFAULT_PROPS, mode: 'slowmo' }, action: 'video' });
  if (back.modes?.includes('timelapse')) steps.push({ id: 'timelapse', label: 'Time-lapse (6 s)', props: { ...DEFAULT_PROPS, mode: 'timelapse' }, action: 'timelapse' });
  // Burst speed: 5 photos back to back (checklist 1.1; smart burst needs this per phone).
  steps.push({ id: 'burst', label: 'Burst speed (5 shots)', props: DEFAULT_PROPS, action: 'burst' });
  // Shutter speed (press → photo saved), 3 photos per capture path: what users get (Ultra HDR where the
  // phone has it, best quality), plain JPEG, and the quick path — evidence for choosing per capability.
  if (back.ultraHdr) steps.push({ id: 'shutter-uhdr', label: 'Shutter speed: Ultra HDR', props: { ...DEFAULT_PROPS, captureMode: 'quality' }, action: 'shutter' });
  steps.push({ id: 'shutter-jpeg', label: 'Shutter speed: plain JPEG', props: { ...DEFAULT_PROPS, hdrPhoto: false, captureMode: 'quality' }, action: 'shutter' });
  // What a plain-JPEG phone gets by default: the auto path (quick in normal light, best quality when dim).
  steps.push({ id: 'shutter-auto', label: 'Shutter speed: auto path', props: { ...DEFAULT_PROPS, hdrPhoto: false, captureMode: 'auto' }, action: 'shutter' });
  steps.push({ id: 'shutter-latency', label: 'Shutter speed: quick capture', props: { ...DEFAULT_PROPS, hdrPhoto: false, captureMode: 'latency' }, action: 'shutter' });
  // Zero shutter lag where the camera supports it (else the native side binds quick capture and says so).
  steps.push({ id: 'shutter-zsl', label: 'Shutter speed: zero shutter lag', props: { ...DEFAULT_PROPS, hdrPhoto: false, captureMode: 'zsl' }, action: 'shutter' });
  // One photo per path, same scene, uploaded as a Quality Lab set (research/quality/analyze.py): is fast as good?
  if (upload) steps.push({ id: 'shutter-quality', label: 'Shutter paths: quality samples uploaded', props: DEFAULT_PROPS, action: 'shutterQuality', offline: true });
  // Hold-shutter smart burst (7.3): shots until release, then the best-shot pick on the phone.
  steps.push({ id: 'burst-pick', label: 'Smart burst + best-shot pick', props: DEFAULT_PROPS, action: 'burstPick' });
  // Plain JPEG on the auto path: in normal light the burst runs on the quick path with no switch.
  steps.push({ id: 'burst-auto', label: 'Smart burst, auto path (plain JPEG)', props: { ...DEFAULT_PROPS, hdrPhoto: false }, action: 'burstPick' });
  if (back.raw) steps.push({ id: 'raw', label: 'RAW photo', props: { ...DEFAULT_PROPS, raw: true }, action: 'photo' });
  if (!back.ultraHdr) steps.push({ id: 'plain-jpeg', label: 'Plain JPEG photo', props: { ...DEFAULT_PROPS, hdrPhoto: false }, action: 'photo' });
  for (const ext of ['auto', 'hdr', 'night'] as const) {
    if (extensions.includes(ext)) {
      steps.push({ id: `maker-${ext}`, label: `Maker ${ext.toUpperCase()} photo`, props: { ...DEFAULT_PROPS, hdrPhoto: false, extension: ext }, action: 'photo' });
    }
  }
  steps.push({ id: 'edit-render', label: 'Editor: full-size edited photo', props: DEFAULT_PROPS, action: 'editRender', offline: true });
  steps.push({ id: 'ml-modules', label: 'Play services models (scanner, scenes, pets, faces)', props: DEFAULT_PROPS, action: 'mlModules', offline: true });
  steps.push({ id: 'people', label: 'People: face grouping (speed + right matches)', props: DEFAULT_PROPS, action: 'people', offline: true });
  if (upload) steps.push({ id: 'upload', label: 'Upload a photo', props: DEFAULT_PROPS, action: 'upload' });
  steps.push({ id: 'heat', label: 'Heat after the test', props: DEFAULT_PROPS, action: 'heat', offline: true });
  return steps;
}

export function area(size: string | null | undefined): number {
  const m = /^(\d+)x(\d+)$/.exec(size ?? '');
  return m ? Number(m[1]) * Number(m[2]) : 0;
}

/**
 * Photo check against the largest JPEG the camera lists. Under half = fail (the
 * Galaxy S8 bug saved 1.5 of 12 MP); 50–90 % = warn (Pixel 8a: CameraX keeps
 * 12 of 16 MP because 16 MP isn't guaranteed alongside a live preview). Maker
 * modes (extensions) produce their own sizes, so they only warn.
 */
export function checkPhoto(
  photo: { width: number; height: number },
  caps: Capabilities,
): { status: 'pass' | 'warn' | 'fail'; message?: string; details: Record<string, unknown> } {
  const got = photo.width * photo.height;
  const max = area(caps.maxPhotoSize);
  const ratio = max ? got / max : null;
  const details = { saved: `${photo.width}x${photo.height}`, max: caps.maxPhotoSize ?? null, bound: caps.photoSize ?? null, ratio };
  if (!photo.width || !photo.height) return { status: 'fail', message: 'photo has no size', details };
  if (ratio !== null && ratio < 0.9) {
    const message = `photo ${photo.width}×${photo.height} is ${Math.round(ratio * 100)}% of the camera's ${caps.maxPhotoSize}`;
    const maker = caps.extension && caps.extension !== 'none';
    return { status: ratio < 0.5 && !maker ? 'fail' : 'warn', message: maker ? `${message} (maker mode's own size)` : message, details };
  }
  return { status: 'pass', details };
}

export type SelfTestReport = {
  startedAt: string;
  totalMs: number;
  passed: number;
  warnings: number;
  failed: number;
  skipped: number;
  steps: StepOutcome[];
  /** The phone's camera report incl. feature probes (Test Lab results, checklist 1.1). */
  device?: Record<string, unknown> | null;
  /** PowerManager thermal status at the start and end (−1 = not reported). */
  thermal?: { start: number; end: number };
};

/** Steps whose viewfinder frame rate is measured (what live Portrait/Night cost vs plain photo). */
export const FPS_STEPS = new Set(['back-photo', 'normal-load', 'motion', 'portrait', 'night', 'video']);

/** Live readers / motion buffer costing more than this share of the plain viewfinder's fps = warn. */
export const MAX_FPS_DROP = 0.25;

/** Android PowerManager thermal status names (−1 = not reported, before Android 10). */
export const THERMAL = ['none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown'];

/** Motion photo clips below this frame rate look choppy (9.2); under 8 fps the camera drops the clip itself. */
export const MIN_MOTION_FPS = 15;

/** Press → photo saved slower than this feels laggy (the user's default capture path). */
export const MAX_SHUTTER_MS = 1000;

/** A full-size edited photo slower than this feels broken on Save/Share (6.1). */
export const MAX_RENDER_MS = 8000;

/** The edit the editor check renders: a look, light/colour, and a straighten (crop + rotate). */
export const RENDER_RECIPE = {
  v: 1,
  look: 'vivid',
  intensity: 0.8,
  adjust: { exposure: 0.3, contrast: 0.2, shadows: 0.2, vibrance: 0.2, sharpness: 0.3 },
  crop: { straighten: 2.1 },
};

/** Recording that starts later than this loses the first moment the user wanted (checklist 1.11). */
export const MAX_VIDEO_START_MS = 700;

export function summarize(startedAt: number, steps: StepOutcome[]): SelfTestReport {
  return {
    startedAt: new Date(startedAt).toISOString(),
    totalMs: Date.now() - startedAt,
    passed: steps.filter((s) => s.status === 'pass').length,
    warnings: steps.filter((s) => s.status === 'warn').length,
    failed: steps.filter((s) => s.status === 'fail').length,
    skipped: steps.filter((s) => s.status === 'skip').length,
    steps,
  };
}
