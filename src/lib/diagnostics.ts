// Anonymous camera diagnostics (Android): how the camera started on this phone
// — photo size bound vs the largest available, preview path, fallbacks, errors.
// No photos, no account link. It shows us problems on every kind of phone, not
// just the ones we test on (docs/features/diagnostics.md).
//
// Each distinct report is sent at most once per day per app build; events are
// batched into one small request a few seconds after the camera settles.
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { Capabilities, CameraDiagnostics } from '../../modules/lens-camera';
import { api } from './api';
import { buildInfo } from './build-info';

export type DiagnosticEvent = { kind: string; at: string; details: Record<string, unknown> };

const FLUSH_MS = 4000;
const MAX_QUEUE = 20;

let queue: DiagnosticEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sentKeys: Record<string, string> | null = null;

function sentFile() {
  return new File(Paths.document, 'diagnostics-sent.json');
}

function loadSent(): Record<string, string> {
  if (sentKeys) return sentKeys;
  try {
    const f = sentFile();
    sentKeys = f.exists ? (JSON.parse(f.textSync()) as Record<string, string>) : {};
  } catch {
    sentKeys = {};
  }
  return sentKeys;
}

function saveSent() {
  try {
    const f = sentFile();
    if (!f.exists) f.create();
    f.write(JSON.stringify(sentKeys ?? {}));
  } catch {
    // Diagnostics must never break the app.
  }
}

function device() {
  const c = Platform.constants as unknown as Record<string, unknown>;
  return {
    manufacturer: c.Manufacturer ?? null,
    brand: c.Brand ?? null,
    model: c.Model ?? null,
    android: c.Release ?? null,
    api: Platform.Version,
  };
}

/** Queues an event; `key` dedupes it (once per day per build). */
function record(kind: string, details: Record<string, unknown>, key: string) {
  if (Platform.OS !== 'android') return;
  const day = new Date().toISOString().slice(0, 10);
  const build = buildInfo();
  const fullKey = `${build.code ?? 'local'}|${kind}|${key}`;
  const sent = loadSent();
  if (sent[fullKey] === day || queue.length >= MAX_QUEUE) return;
  sent[fullKey] = day;
  queue.push({ kind, at: new Date().toISOString(), details });
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}

async function flush() {
  timer = null;
  const events = queue;
  queue = [];
  if (events.length === 0) return;
  saveSent();
  try {
    await api.diagnostics({ device: device(), build: buildInfo(), events });
  } catch {
    // Offline or rejected: drop it; the next camera start reports again tomorrow.
  }
}

/** Camera bound (onReady): the photo size it really got is the key check. */
export function reportCameraReady(c: Capabilities) {
  record(
    'camera',
    {
      position: c.position,
      lens: c.lens,
      mode: c.mode,
      photoSize: c.photoSize ?? null,
      maxPhotoSize: c.maxPhotoSize ?? null,
      previewSize: c.previewSize ?? null,
      photoFormat: c.photoFormat ?? null,
      extension: c.extension ?? null,
      level: c.level ?? null,
      tier: c.tier ?? null,
      bindAttempt: c.bindAttempt ?? null,
    },
    `${c.position}|${c.lens}|${c.mode}|${c.photoSize}`,
  );
}

/** Preview path (which rotation rule ran) or OpenGL falling back to the plain preview. */
export function reportPreview(d: CameraDiagnostics, position: string) {
  if (d.kind === 'preview') {
    record('preview', { ...d, position }, `${position}|${d.cameraTransform}|${d.mirroring}|${d.buffer}`);
  } else {
    record('glFallback', { message: d.message }, d.message.slice(0, 80));
  }
}

/** The pro camera failed and the basic camera took over, or another camera error. */
export function reportCameraError(kind: 'fallbackBasic' | 'cameraError', message: string) {
  record(kind, { message: message.slice(0, 500) }, message.slice(0, 80));
}

/** Basic camera (fallback): the photo size it saved. */
export function reportBasicPhoto(width: number, height: number) {
  record('basicPhoto', { size: `${width}x${height}` }, `${width}x${height}`);
}
