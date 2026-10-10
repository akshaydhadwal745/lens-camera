// Camera self-test (Android): drives the real camera through every mode this
// phone supports and checks each result — photo size vs the camera's maximum,
// orientation in both landscapes, front camera, every lens, Night, Portrait,
// video, RAW / Ultra HDR / maker modes, and (on Test Lab) an upload.
// Runs from Settings → Camera info → Run self-test, and automatically when
// Firebase Test Lab starts the app as a "game loop" (docs/features/self-test.md).
import type { Capabilities, LabExtension, Lens } from '../../modules/lens-camera';

export type Orientation = 'portrait' | 'landscape' | 'reverseLandscape';

export type SelfTestProps = {
  facing: 'back' | 'front';
  lens: Lens;
  mode: 'photo' | 'video' | 'night' | 'portrait';
  raw: boolean;
  hdrPhoto: boolean;
  extension: LabExtension;
};

export const DEFAULT_PROPS: SelfTestProps = { facing: 'back', lens: 'wide', mode: 'photo', raw: false, hdrPhoto: true, extension: 'none' };

export type SelfTestStep = {
  id: string;
  label: string;
  props: SelfTestProps;
  orientation?: Orientation;
  action: 'photo' | 'night' | 'video' | 'upload';
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
  steps.push({
    id: 'front-landscape',
    label: 'Front camera landscape',
    props: { ...DEFAULT_PROPS, facing: 'front' },
    orientation: 'landscape',
    action: 'photo',
    expectScreen: 'landscape',
  });
  const modes = back.modes ?? ['photo', 'video', 'night', 'portrait'];
  if (modes.includes('night')) steps.push({ id: 'night', label: 'Night photo', props: { ...DEFAULT_PROPS, mode: 'night' }, action: 'night' });
  if (modes.includes('portrait')) steps.push({ id: 'portrait', label: 'Portrait photo', props: { ...DEFAULT_PROPS, mode: 'portrait' }, action: 'photo' });
  if (modes.includes('video')) steps.push({ id: 'video', label: 'Video (3 s)', props: { ...DEFAULT_PROPS, mode: 'video' }, action: 'video' });
  if (back.raw) steps.push({ id: 'raw', label: 'RAW photo', props: { ...DEFAULT_PROPS, raw: true }, action: 'photo' });
  if (!back.ultraHdr) steps.push({ id: 'plain-jpeg', label: 'Plain JPEG photo', props: { ...DEFAULT_PROPS, hdrPhoto: false }, action: 'photo' });
  for (const ext of ['auto', 'hdr', 'night'] as const) {
    if (extensions.includes(ext)) {
      steps.push({ id: `maker-${ext}`, label: `Maker ${ext.toUpperCase()} photo`, props: { ...DEFAULT_PROPS, hdrPhoto: false, extension: ext }, action: 'photo' });
    }
  }
  if (upload) steps.push({ id: 'upload', label: 'Upload a photo', props: DEFAULT_PROPS, action: 'upload' });
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
};

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
