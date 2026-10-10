// Quality Lab (Android): capture the same scene with every photo pipeline this
// phone supports and upload the untouched results, so pipelines can be
// compared offline on identical input (docs/research/camera-quality.md).
// Sets are kept on the phone until they upload, so they survive restarts.
import { Directory, File, Paths } from 'expo-file-system';

import type { BurstFrame, LabExtension } from '../../modules/lens-camera';
import { api } from './api';
import { buildInfo } from './build-info';
import { md5Of, put } from './uploader';

/** Camera props a lab step sets. */
export type LabCameraProps = {
  mode: 'photo' | 'night';
  raw: boolean;
  hdrPhoto: boolean;
  extension: LabExtension;
  captureMode: 'quality' | 'latency';
};

export const BASE_PROPS: LabCameraProps = { mode: 'photo', raw: false, hdrPhoto: false, extension: 'none', captureMode: 'quality' };

export type LabStep = {
  id: string;
  label: string;
  props: LabCameraProps;
  capture: { kind: 'photo' } | { kind: 'burst'; frames: number } | { kind: 'night'; frames: number };
};

export type StepFile = { name: string; ms?: number; iso?: number | null; exposureNs?: number | null; focusDiopters?: number | null };

export type StepResult = {
  id: string;
  label: string;
  files: StepFile[];
  /** Shutter press to last file saved (and merged, for Night). */
  durationMs: number;
  thermalBefore: number;
  thermalAfter: number;
  /** What the camera actually bound (an extension can fall back to none). */
  bound?: { extension?: string; photoFormat?: string };
  error?: string;
};

export type LabSet = {
  localId: string;
  createdAt: string;
  scene: string;
  note: string;
  steps: StepResult[];
  uploadedSetId?: string;
};

type BackCamera = { facing: string; capabilities: string[]; extensions?: string[] | null };

/**
 * The plan for this phone, from its capability report. Every pipeline we might
 * use is captured: plain single shots, bursts for our own merges (quality and
 * fast capture), RAW bursts, the maker's extension modes, and today's Night.
 */
export function planSteps(report: { cameras: BackCamera[] }, ultraHdr: boolean): LabStep[] {
  const back = report.cameras.find((c) => c.facing === 'back');
  const steps: LabStep[] = [
    { id: 'single', label: 'Single photo', props: BASE_PROPS, capture: { kind: 'photo' } },
  ];
  if (ultraHdr) {
    steps.push({ id: 'single-uhdr', label: 'Single Ultra HDR', props: { ...BASE_PROPS, hdrPhoto: true }, capture: { kind: 'photo' } });
  }
  steps.push(
    { id: 'burst-q8', label: 'Burst ×8 (quality)', props: BASE_PROPS, capture: { kind: 'burst', frames: 8 } },
    { id: 'burst-l8', label: 'Burst ×8 (fast)', props: { ...BASE_PROPS, captureMode: 'latency' }, capture: { kind: 'burst', frames: 8 } },
  );
  if (back?.capabilities.includes('RAW')) {
    steps.push({ id: 'raw-6', label: 'RAW burst ×6', props: { ...BASE_PROPS, raw: true }, capture: { kind: 'burst', frames: 6 } });
  }
  for (const ext of ['auto', 'hdr', 'night'] as const) {
    if (back?.extensions?.includes(ext)) {
      steps.push({ id: `ext-${ext}`, label: `Maker ${ext.toUpperCase()}`, props: { ...BASE_PROPS, extension: ext }, capture: { kind: 'photo' } });
    }
  }
  steps.push({ id: 'lens-night8', label: 'Lens Night (today)', props: { ...BASE_PROPS, mode: 'night' }, capture: { kind: 'night', frames: 8 } });
  return steps;
}

function labRoot(): Directory {
  const dir = new Directory(Paths.document, 'quality-lab');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function setDir(localId: string): Directory {
  const dir = new Directory(labRoot(), localId);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function newSet(scene: string, note: string): LabSet {
  const now = new Date();
  const localId = `${now.toISOString().replace(/[:.]/g, '-')}`;
  setDir(localId);
  return { localId, createdAt: now.toISOString(), scene, note, steps: [] };
}

export function saveSet(set: LabSet) {
  const f = new File(setDir(set.localId), 'set.json');
  if (!f.exists) f.create();
  f.write(JSON.stringify(set));
}

export function listSets(): LabSet[] {
  const out: LabSet[] = [];
  for (const entry of labRoot().list()) {
    if (!(entry instanceof Directory)) continue;
    const f = new File(entry, 'set.json');
    if (!f.exists) continue;
    try {
      out.push(JSON.parse(f.textSync()) as LabSet);
    } catch {
      // Half-written set: ignore.
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteSet(localId: string) {
  const dir = new Directory(labRoot(), localId);
  if (dir.exists) dir.delete();
}

/** Moves a captured file into the set folder under `name`. */
export async function keepFile(set: LabSet, uri: string, name: string): Promise<void> {
  const src = new File(uri);
  await src.move(new File(setDir(set.localId), name));
}

export function burstFiles(stepId: string, frames: BurstFrame[], raw: boolean): { from: string; file: StepFile }[] {
  return frames.map((f, i) => ({
    from: f.uri,
    file: {
      name: `${stepId}-${i}.${raw ? 'dng' : 'jpg'}`,
      ms: f.ms,
      iso: f.iso,
      exposureNs: f.exposureNs,
      focusDiopters: f.focusDiopters,
    },
  }));
}

/** Uploads every file of the set (Content-MD5 checked) plus its metadata. */
export async function uploadSet(set: LabSet, report: Record<string, unknown>, onProgress: (sent: number, total: number) => void): Promise<string> {
  const dir = setDir(set.localId);
  const names = set.steps.flatMap((s) => s.files.map((f) => f.name));
  const files = names.map((name) => {
    const file = new File(dir, name);
    return { name, file, bytes: file.size ?? 0, md5: md5Of(file) };
  });
  const total = files.reduce((n, f) => n + f.bytes, 0);
  const { setId, urls } = await api.lab.createSet(
    files.map(({ name, bytes, md5 }) => ({ name, bytes, md5 })),
    { scene: set.scene, note: set.note, createdAt: set.createdAt, steps: set.steps, device: report, build: buildInfo() },
  );
  let done = 0;
  for (const f of files) {
    const type = f.name.endsWith('.dng') ? 'image/x-adobe-dng' : 'image/jpeg';
    await put(f.file, urls[f.name], { 'Content-Type': type, 'Content-MD5': f.md5 }, (sent) => onProgress(done + sent, total));
    done += f.bytes;
    onProgress(done, total);
  }
  return setId;
}
