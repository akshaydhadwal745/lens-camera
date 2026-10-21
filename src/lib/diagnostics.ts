// Anonymous camera diagnostics (Android): how the camera started on this phone
// — photo size bound vs the largest available, preview path, fallbacks, errors.
// No photos, no account link. It shows us problems on every kind of phone, not
// just the ones we test on (docs/features/diagnostics.md).
//
// Each distinct report is sent at most once per day per app build; events are
// batched into one small request a few seconds after the camera settles.
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { type Capabilities, type CameraDiagnostics, cameraDeviceReport } from '../../modules/lens-camera';
import { api } from './api';
import { buildInfo } from './build-info';
import { loadDoc, saveDoc } from './local-store';
import type { SelfTestReport } from './self-test';

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

/** Settings → Camera → "Share camera diagnostics" (on by default). Off = nothing automatic is sent. */
export function diagnosticsEnabled(): boolean {
  return loadDoc<{ share?: boolean }>('diagnostics-prefs', {}).share !== false;
}

export function setDiagnosticsEnabled(share: boolean) {
  saveDoc('diagnostics-prefs', { share });
  if (!share) {
    queue = [];
    if (timer) clearTimeout(timer);
    timer = null;
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
  if (Platform.OS !== 'android' || !diagnosticsEnabled()) return;
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

/**
 * A random ID for this phone, new every month (Admin → Phones counts phones, not reports).
 * Not the account, not the Android ID: it can't be linked to a person or across months.
 */
function monthlyPhoneId(): string {
  const month = new Date().toISOString().slice(0, 7);
  const saved = loadDoc<{ month?: string; id?: string }>('diagnostics-phone', {});
  if (saved.month === month && saved.id) return saved.id;
  const id = Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  saveDoc('diagnostics-phone', { month, id });
  return id;
}

/** The diagnostics API takes ≤ 32 KB per request; camera reports are 3–8 KB. */
const MAX_CAPABILITIES_BYTES = 28 * 1024;
let capabilitiesStarted = false;

/**
 * What this phone's cameras can do (the Camera info report: lenses, sizes,
 * frame rates, slow motion, 60 fps, photo while recording, stabilization,
 * extensions, encoders…), sent once per app build after the first camera
 * start — so every phone that installs Lens tells us its capabilities, not only
 * the ones we test. Anonymous like the rest (no account, no photos).
 */
async function reportCapabilities() {
  if (Platform.OS !== 'android' || capabilitiesStarted || !diagnosticsEnabled()) return;
  capabilitiesStarted = true;
  // Once per app build and at least once a month, so phones that don't update are still counted.
  const key = `${buildInfo().code ?? 'local'}|${new Date().toISOString().slice(0, 7)}|capabilities`;
  const sent = loadSent();
  if (sent[key]) return;
  try {
    const report = await cameraDeviceReport();
    if (!report || JSON.stringify(report).length > MAX_CAPABILITIES_BYTES) return;
    await api.diagnostics({ device: device(), build: buildInfo(), phone: monthlyPhoneId(), events: [{ kind: 'capabilities', at: new Date().toISOString(), details: report }] });
    sent[key] = new Date().toISOString().slice(0, 10);
    saveSent();
  } catch {
    // Offline or rejected: tried again on the next app start (not on every camera rebind).
  }
}

/** Camera bound (onReady): the photo size it really got is the key check. */
export function reportCameraReady(c: Capabilities) {
  void reportCapabilities();
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

/** Self-test result: always sent (not deduped); trimmed to fit one report. */
export async function sendSelfTest(report: SelfTestReport) {
  if (Platform.OS !== 'android') return;
  const steps = report.steps.map((s) => ({ ...s, message: s.message?.slice(0, 200) }));
  // The full camera report stays out (the API takes ≤ 32 KB); it's in Test Lab's result file and Camera info.
  const { device: _cameraReport, ...summary } = report;
  try {
    await api.diagnostics({
      device: device(),
      build: buildInfo(),
      events: [{ kind: 'selftest', at: new Date().toISOString(), details: { ...summary, steps } }],
    });
  } catch {
    // Offline: the result is still on screen (and in Test Lab's result file).
  }
}
