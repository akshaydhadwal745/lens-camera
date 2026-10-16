// Camera self-test (Android): Settings → Camera info → Run self-test, or
// automatically when Firebase Test Lab launches Lens as a "game loop" (then it
// also uploads a photo, writes Test Lab's result file and closes the app).
// Steps and checks: src/lib/self-test.ts; docs/features/self-test.md.
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Capabilities, CameraDiagnostics, cameraDeviceReport, LensCameraHandle, LensCameraView, LensImaging, MediaInfo, PhotoResult } from '../../modules/lens-camera';
import { exportVideoRetrying } from '@/lib/video-export';
import { useKeepAwakeWhile } from '@/lib/keep-awake';
import { selfTestHooks } from '../../modules/lens-device';
import { buildInfo, buildLabel } from '@/lib/build-info';
import { diagnosticsEnabled, sendSelfTest } from '@/lib/diagnostics';
import {
  cameraKey,
  checkPhoto,
  DEFAULT_PROPS,
  FPS_STEPS,
  MAX_FPS_DROP,
  MAX_RENDER_MS,
  MAX_SHUTTER_MS,
  MAX_VIDEO_START_MS,
  MIN_MOTION_FPS,
  RENDER_RECIPE,
  THERMAL,
  planSelfTest,
  SelfTestProps,
  SelfTestReport,
  SelfTestStep,
  StepOutcome,
  summarize,
} from '@/lib/self-test';
import { peopleSelfTest } from '@/lib/people-selftest';
import { deleteSet, keepFile, newSet, uploadSet } from '@/lib/quality-lab';
import { capture as saveCapture, getState, isHot } from '@/lib/store';
import { colors, errorMessage } from '@/lib/ui';

const MARK = { pass: '✓', warn: '!', fail: '✗', skip: '–' } as const;
const MARK_COLOR = { pass: '#30D158', warn: '#FACC15', fail: '#FF453A', skip: '#86868B' } as const;

const ANALYSIS = { peaking: false, zebra: false, zebraLevel: 0.95, falseColor: false, histogram: false };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A video's real frames / rate / sound (dev-67+ APKs), or null. */
async function videoInfo(uri: string): Promise<MediaInfo | null> {
  return LensImaging?.mediaInfo ? LensImaging.mediaInfo(uri).catch(() => null) : null;
}

function deleteFile(uri: string | undefined) {
  if (!uri) return;
  const f = new File(uri);
  if (f.exists) f.delete();
}

type Waiter<T> = { match: (v: T) => boolean; resolve: (v: T | null) => void };

export default function SelfTestScreen() {
  const insets = useSafeAreaInsets();
  const camera = useRef<LensCameraHandle>(null);
  const [launch] = useState(() => selfTestHooks.launch());
  const [props, setProps] = useState<SelfTestProps>(DEFAULT_PROPS);
  const propsRef = useRef<SelfTestProps>(DEFAULT_PROPS);
  const latestCaps = useRef<Capabilities | null>(null);
  const latestPreview = useRef<Extract<CameraDiagnostics, { kind: 'preview' }> | null>(null);
  const capsWaiter = useRef<Waiter<Capabilities> | null>(null);
  const previewWaiter = useRef<Waiter<Extract<CameraDiagnostics, { kind: 'preview' }>> | null>(null);
  const [steps, setSteps] = useState<StepOutcome[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [report, setReport] = useState<SelfTestReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const [running, setRunning] = useState(false);
  // A run takes minutes: the phone's screen timeout would pause the camera mid-step (S8, dev-125).
  useKeepAwakeWhile(running, 'selftest');
  /** Files kept for the later checks (editor render, trim export), deleted at the end. */
  const kept = useRef<{ photo?: string; portrait?: string; video?: string; shutter?: Record<string, string> }>({});
  /** Viewfinder fps of the plain back camera, to compare the live readers / motion buffer with. */
  const plainFps = useRef<number | null>(null);
  const motionOff = useRef(false);
  const thermalStart = useRef(-1);
  const thermalEnd = useRef(-1);
  const screen = useRef<'portrait' | 'landscape' | 'reverseLandscape'>('portrait');

  const onReady = useCallback((c: Capabilities) => {
    latestCaps.current = c;
    if (capsWaiter.current?.match(c)) {
      capsWaiter.current.resolve(c);
      capsWaiter.current = null;
    }
  }, []);

  const onDiagnostics = useCallback((d: CameraDiagnostics) => {
    if (d.kind !== 'preview') return;
    latestPreview.current = d;
    if (previewWaiter.current?.match(d)) {
      previewWaiter.current.resolve(d);
      previewWaiter.current = null;
    }
  }, []);

  function waitFor<T>(slot: { current: Waiter<T> | null }, latest: T | null, match: (v: T) => boolean, ms: number, fresh: boolean): Promise<T | null> {
    if (!fresh && latest && match(latest)) return Promise.resolve(latest);
    return new Promise((resolve) => {
      const w: Waiter<T> = { match, resolve };
      slot.current = w;
      setTimeout(() => {
        if (slot.current === w) {
          slot.current = null;
          resolve(null);
        }
      }, ms);
    });
  }

  /** Applies camera props and waits until the camera rebinds with them. */
  const applyProps = useCallback(async (next: SelfTestProps): Promise<Capabilities | null> => {
    const match = (c: Capabilities) =>
      c.position === next.facing &&
      c.mode === next.mode &&
      (next.facing === 'front' || c.lens === next.lens) &&
      (next.extension === 'none' || c.extension === next.extension) &&
      (c.photoFormat === 'raw') === next.raw;
    const changed = cameraKey(next) !== cameraKey(propsRef.current);
    // Motion buffer / live readers change only the viewfinder side: no new onReady, but they need time to fill/warm up.
    const viewfinderOnly = !changed && JSON.stringify(next) !== JSON.stringify(propsRef.current);
    const got = waitFor(capsWaiter, latestCaps.current, match, 15000, changed);
    propsRef.current = next;
    setProps(next);
    const caps = await got;
    await wait(viewfinderOnly ? 2500 : 1200); // exposure and focus settle
    return caps;
  }, []);

  /** Steps on files already captured, or the phone itself (no camera change). */
  const runOffline = useCallback(async (step: SelfTestStep, base: { id: string; label: string }, t0: number): Promise<StepOutcome> => {
    const done = (status: StepOutcome['status'], message?: string, details?: Record<string, unknown>): StepOutcome => ({ ...base, status, ms: Date.now() - t0, message, details });
    if (step.action === 'videoExport') {
      const source = kept.current.video;
      if (!source || !LensImaging) return done('skip', 'no video from the video step');
      // Trim 0.5–2.0 s with a look: Media3 export (6.2 trim, 5.2 looks on Save/Share).
      const out = await exportVideoRetrying(source, { v: 1, look: 'warm', intensity: 1, trim: { start: 0.5, end: 2 } });
      const info = await videoInfo(out.uri);
      deleteFile(out.uri);
      const details = { exportMs: Date.now() - t0, file: info };
      if (info && Math.abs(info.duration - 1.5) > 0.4) return done('fail', `exported ${info.duration.toFixed(2)} s, expected 1.5 s`, details);
      return done('pass', `1.5 s clip exported in ${((Date.now() - t0) / 1000).toFixed(1)} s`, details);
    }
    if (step.action === 'shutterQuality') {
      // Same scene, one photo per capture path → a Quality Lab set (analyze.py: noise + detail vs best quality).
      const shots = kept.current.shutter ?? {};
      const names: Record<string, string> = { 'shutter-jpeg': 'single', 'shutter-auto': 'auto', 'shutter-latency': 'quick', 'shutter-zsl': 'zsl' };
      const present = Object.keys(names).filter((id) => shots[id]);
      if (!shots['shutter-jpeg'] || present.length < 2) return done('skip', 'not enough shutter samples');
      const set = newSet('selftest-shutter', `self-test ${buildLabel()}`);
      for (const id of present) {
        await keepFile(set, shots[id], `${names[id]}.jpg`);
        set.steps.push({ id: names[id], label: id, files: [{ name: `${names[id]}.jpg` }], durationMs: 0, thermalBefore: -1, thermalAfter: -1 });
      }
      kept.current.shutter = {};
      try {
        const setId = await uploadSet(set, (await cameraDeviceReport()) as Record<string, unknown>, () => {});
        return done('pass', `set ${setId} (${present.map((id) => names[id]).join(', ')})`, { setId, files: present.map((id) => names[id]) });
      } finally {
        deleteSet(set.localId);
      }
    }
    if (step.action === 'editRender') {
      const source = kept.current.photo;
      if (!source || !LensImaging) return done('skip', 'no photo from the back camera step');
      const out = await LensImaging.renderImage(source, RENDER_RECIPE, { format: 'jpeg', quality: 0.95 });
      const renderMs = Date.now() - t0;
      deleteFile(out.uri);
      const details: Record<string, unknown> = { renderMs, size: `${out.width}x${out.height}` };
      // Portrait blur on the full photo too, when the rack phone found a person/subject.
      if (kept.current.portrait) {
        const p0 = Date.now();
        const p = await LensImaging.renderImage(kept.current.portrait, { v: 1, portrait: { aperture: 2.8, style: 'natural' } }, { format: 'jpeg', quality: 0.95 });
        deleteFile(p.uri);
        details.portraitMs = Date.now() - p0;
      }
      const slow = renderMs > MAX_RENDER_MS || (typeof details.portraitMs === 'number' && details.portraitMs > MAX_RENDER_MS);
      const message = `${out.width}×${out.height} in ${(renderMs / 1000).toFixed(1)} s${typeof details.portraitMs === 'number' ? `, portrait blur ${(details.portraitMs / 1000).toFixed(1)} s` : ''}`;
      return done(slow ? 'warn' : 'pass', message, details);
    }
    if (step.action === 'mlModules') {
      if (!LensImaging?.mlModules) return done('skip', 'needs dev-67 or newer');
      const r = await LensImaging.mlModules(true, 150000);
      if (!r.playServices) return done('warn', 'no Google Play services: no document scanner, scene suggestions, pet portraits or face-aware burst pick', r);
      const names = ['documentScanner', 'sceneLabels', 'subjects', 'faces'];
      const bad = names.filter((n) => {
        const st = (r[n] as { state?: string } | undefined)?.state;
        return st !== 'present' && st !== 'downloaded';
      });
      const states = names.map((n) => `${n} ${(r[n] as { state?: string } | undefined)?.state ?? '?'}`).join(', ');
      return done(bad.length ? 'warn' : 'pass', states, r);
    }
    if (step.action === 'people') {
      const r = await peopleSelfTest();
      return done(r.status, r.message, r.details);
    }
    if (step.action === 'heat') {
      const end = camera.current?.thermalStatus ? await camera.current.thermalStatus() : -1;
      thermalEnd.current = end;
      const details = { start: thermalStart.current, end };
      if (end < 0) return done('skip', 'phone does not report heat (Android 9 or older)', details);
      return done(end >= 3 ? 'warn' : 'pass', `${THERMAL[thermalStart.current] ?? '?'} → ${THERMAL[end] ?? '?'}`, details);
    }
    return done('skip', 'unknown step');
  }, []);

  const runStep = useCallback(
    async (step: SelfTestStep): Promise<StepOutcome> => {
      const t0 = Date.now();
      const base = { id: step.id, label: step.label };
      const cam = camera.current;
      if (!cam) return { ...base, status: 'fail', ms: 0, message: 'camera view missing' };
      try {
        if (step.offline) return await runOffline(step, base, t0);
        if (!step.orientation && screen.current !== 'portrait') {
          // Steps without their own rotation run in portrait.
          const back = waitFor(previewWaiter, latestPreview.current, (d) => d.targetRotation === 0, 8000, true);
          selfTestHooks.setOrientation('portrait');
          screen.current = 'portrait';
          await back;
        }
        if (step.orientation) {
          screen.current = step.orientation;
          const want = step.expectScreen === 'landscape' ? (r: number) => r === 1 || r === 3 : (r: number) => r === 0;
          const preview = waitFor(previewWaiter, latestPreview.current, (d) => want(d.targetRotation), 8000, true);
          selfTestHooks.setOrientation(step.orientation);
          const p = await preview;
          if (!p) return { ...base, status: 'fail', ms: Date.now() - t0, message: `preview did not re-bind for ${step.orientation}` };
        }
        const caps = await applyProps(step.props);
        if (!caps) return { ...base, status: 'fail', ms: Date.now() - t0, message: 'camera did not start in this mode' };
        if (step.props.extension !== 'none' && caps.extension !== step.props.extension) {
          return { ...base, status: 'skip', ms: Date.now() - t0, message: `maker mode not available (bound ${caps.extension})` };
        }
        const preview = latestPreview.current;
        // dev-68+: frames shown + delivered, and where the GL time goes; older APKs: frames shown only.
        const stats = FPS_STEPS.has(step.id) && cam.previewStats ? await cam.previewStats(2000).catch(() => null) : null;
        const fps = stats ? stats.fps : FPS_STEPS.has(step.id) && cam.previewFps ? await cam.previewFps(2000) : undefined;
        const previewDetails = {
          ...(preview ? { cameraTransform: preview.cameraTransform, mirroring: preview.mirroring, targetRotation: preview.targetRotation } : {}),
          ...(fps !== undefined ? { previewFps: fps } : {}),
          ...(stats ? { previewStats: stats } : {}),
        };

        if (step.action === 'shutter') {
          // One at a time: press → saved (captureMs) and press → frame captured (lagMs, shutter lag).
          const times: number[] = [];
          const lags: (number | null)[] = [];
          let mode: string | null = null;
          for (let i = 0; i < 3; i++) {
            const s0 = Date.now();
            const p = await cam.takePhoto({ raw: false, flash: 'off' });
            times.push(Date.now() - s0);
            lags.push(p.lagMs ?? null);
            mode = p.captureMode ?? mode;
            // The first plain-JPEG photo of each path is kept for the quality comparison.
            if (i === 0 && step.id !== 'shutter-uhdr') kept.current.shutter = { ...kept.current.shutter, [step.id]: p.uri };
            else deleteFile(p.uri);
            await wait(300);
          }
          // Rapid: 3 presses 150 ms apart without waiting for saves (the pipelined shutter): all must arrive, in order.
          const r0 = Date.now();
          const rapid = await Promise.allSettled(
            [0, 1, 2].map(async (i) => {
              await wait(i * 150);
              return cam.takePhoto({ raw: false, flash: 'off' });
            }),
          );
          const rapidMs = Date.now() - r0;
          const rapidOk = rapid.filter((r): r is PromiseFulfilledResult<PhotoResult> => r.status === 'fulfilled');
          for (const r of rapidOk) deleteFile(r.value.uri);
          const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
          const lagValues = lags.filter((l): l is number => l !== null);
          const lagAvg = lagValues.length ? Math.round(lagValues.reduce((a, b) => a + b, 0) / lagValues.length) : null;
          const details = {
            captureMs: times,
            avgMs: avg,
            lagMs: lags,
            lagAvgMs: lagAvg,
            rapidSaved: rapidOk.length,
            rapidMs,
            rapidLagMs: rapidOk.map((r) => r.value.lagMs ?? null),
            captureMode: mode,
            format: caps.photoFormat ?? null,
          };
          // Only the path users get by default is judged; the others are measurements.
          const isDefault = step.id === 'shutter-uhdr' || (step.id === 'shutter-jpeg' && !caps.ultraHdr);
          const lost = rapidOk.length < 3;
          const status = lost ? 'fail' : isDefault && avg > MAX_SHUTTER_MS ? 'warn' : 'pass';
          const lagText = lagAvg !== null ? `lag ${lagAvg} ms, ` : '';
          const message = lost
            ? `rapid presses: only ${rapidOk.length} of 3 photos saved (${rapid.find((r) => r.status === 'rejected') ? errorMessage((rapid.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason) : ''})`
            : `${mode ?? '?'}: ${lagText}saved ${avg} ms (${times.join(', ')}), 3 rapid in ${rapidMs} ms`;
          return { ...base, status, ms: Date.now() - t0, message, details };
        }

        if (step.action === 'video') {
          const done = cam.startRecording();
          // Photo while recording (video step only): which way this phone does it, and how big.
          let videoPhoto: string | null = null;
          if (step.id === 'video' && cam.takeVideoPhoto) {
            await wait(1500);
            try {
              const p = await cam.takeVideoPhoto();
              videoPhoto = `${p.width}x${p.height} ${p.fromVideo ? 'video frame' : 'photo stream'}`;
              new File(p.uri).delete();
            } catch (e) {
              videoPhoto = `failed: ${errorMessage(e)}`;
            }
            await wait(1500);
          } else {
            await wait(3000);
          }
          await cam.stopRecording();
          const v = await done;
          const size = new File(v.uri).size ?? 0;
          const info = await videoInfo(v.uri);
          // The 3 s clip is kept for the trim + look export check.
          if (step.id === 'video' && size > 0) kept.current.video = v.uri;
          else new File(v.uri).delete();
          // Slow motion: the clip plays `slowFactor` times longer than it was recorded.
          const factor = step.props.mode === 'slowmo' ? (v.slowFactor ?? 1) : 1;
          const ok = v.duration >= 2 * factor && size > 0 && (step.props.mode !== 'slowmo' || factor >= 2);
          const delay = v.startDelayMs ?? null;
          const late = delay !== null && delay > MAX_VIDEO_START_MS;
          const details = { duration: v.duration, bytes: size, startDelayMs: delay, slowFactor: factor, videoPhoto, file: info, ...previewDetails };
          const notes = [
            late ? `recording started ${delay} ms after record was pressed` : null,
            // Normal video has sound; slow motion is silent by design.
            info && step.props.mode === 'video' && !info.audio ? 'no sound track' : null,
            info && step.props.mode === 'video' && info.fps !== null && info.fps < 20 ? `only ${info.fps} fps recorded` : null,
            videoPhoto?.startsWith('failed') ? `photo while recording ${videoPhoto}` : null,
          ].filter(Boolean);
          const message = notes.length ? notes.join('; ') : info ? `${info.width}×${info.height} ${info.fps ?? '?'} fps${info.audio ? ' + sound' : ''}` : undefined;
          if (!ok) return { ...base, status: 'fail', ms: Date.now() - t0, message: [`video ${v.duration}s, ${size} bytes`, ...notes].join('; '), details };
          return { ...base, status: notes.length ? 'warn' : 'pass', ms: Date.now() - t0, message, details };
        }

        if (step.action === 'pause') {
          if (!cam.pauseRecording || !cam.resumeRecording) return { ...base, status: 'skip', ms: Date.now() - t0, message: 'pause not available' };
          // 1.5 s recorded, 2 s paused (not in the file), 1.5 s recorded → a ~3 s clip.
          const done = cam.startRecording();
          await wait(1500);
          const paused = await cam.pauseRecording();
          await wait(2000);
          const resumed = await cam.resumeRecording();
          await wait(1500);
          await cam.stopRecording();
          const v = await done;
          const info = await videoInfo(v.uri);
          deleteFile(v.uri);
          const length = info?.duration ?? v.duration;
          const details = { paused, resumed, duration: v.duration, file: info };
          if (!paused || !resumed) return { ...base, status: 'fail', ms: Date.now() - t0, message: `pause ${paused}, resume ${resumed}`, details };
          // Up to ~0.7 s of start delay is lost at the front; more than 4.2 s means the pause was recorded.
          if (length < 2 || length > 4.2) return { ...base, status: 'fail', ms: Date.now() - t0, message: `clip ${length.toFixed(1)} s, expected about 3 s`, details };
          return { ...base, status: 'pass', ms: Date.now() - t0, message: `clip ${length.toFixed(1)} s (2 s pause left out)`, details };
        }

        if (step.action === 'astro') {
          // Astro needs manual exposures of at least ½ s (9.6). The plan itself needs real darkness, so a lit rack says "not now".
          const plan = cam.astroPlan ? await cam.astroPlan().catch(() => null) : null;
          const longest = caps.maxShutter;
          const details = { maxShutter: longest, manualExposure: caps.manualExposure, plan };
          if (!caps.manualExposure || longest < 0.5) {
            return { ...base, status: 'skip', ms: Date.now() - t0, message: `longest exposure ${longest.toFixed(2)} s: no astro on this phone (Night still works)`, details };
          }
          // Capabilities cap maxShutter at 1 s (the PRO dial); the full range is in the device report.
          return { ...base, status: 'pass', ms: Date.now() - t0, message: `astro possible: manual exposures of ½ s and longer${plan ? '' : ' (not dark here)'}`, details };
        }

        if (step.action === 'motion') {
          motionOff.current = false;
          const photo = await cam.takePhoto({ raw: false, flash: 'off' });
          const meta = LensImaging?.inspectPhoto ? await LensImaging.inspectPhoto(photo.uri).catch(() => null) : null;
          const clipUri = LensImaging?.motionVideo ? await LensImaging.motionVideo(photo.uri).catch(() => null) : null;
          const clip = clipUri ? await videoInfo(clipUri) : null;
          deleteFile(clipUri ?? undefined);
          deleteFile(photo.uri);
          const fpsDrop = fps !== undefined && plainFps.current ? 1 - fps / plainFps.current : null;
          const details = { motion: photo.motion ?? false, xmp: meta?.motion ?? null, clip, fpsDrop, turnedOff: motionOff.current, ...previewDetails };
          if (!photo.motion) {
            // By design a phone whose encoder can't keep up saves the photo without the clip.
            return { ...base, status: 'warn', ms: Date.now() - t0, message: motionOff.current ? 'phone too slow: motion photos turned themselves off' : 'photo saved without the motion clip', details };
          }
          const notes = [
            meta && !meta.motion ? 'motion XMP missing' : null,
            !clip ? 'clip could not be read' : null,
            clip && clip.fps !== null && clip.fps < MIN_MOTION_FPS ? `clip only ${clip.fps} fps` : null,
            clip && clip.duration < 2 ? `clip only ${clip.duration.toFixed(1)} s` : null,
            fpsDrop !== null && fpsDrop > MAX_FPS_DROP ? `viewfinder ${Math.round(fpsDrop * 100)}% slower with MOTION on` : null,
          ].filter(Boolean);
          const message = notes.length ? notes.join('; ') : clip ? `clip ${clip.duration.toFixed(1)} s, ${clip.width}×${clip.height}, ${clip.fps} fps` : undefined;
          return { ...base, status: notes.length ? 'warn' : 'pass', ms: Date.now() - t0, message, details };
        }

        if (step.action === 'burstPick') {
          if (!cam.startBurst || !cam.stopBurst) return { ...base, status: 'skip', ms: Date.now() - t0, message: 'smart burst not available' };
          const done = step.burstQuick === false ? cam.startBurst(20, false) : cam.startBurst(20);
          await wait(1500);
          const released = Date.now();
          await cam.stopBurst();
          const burst = await done;
          const pickMs = Date.now() - released;
          for (const f of burst.frames) deleteFile(f.uri);
          const shots = burst.frames.length;
          const details = {
            shots, pick: burst.pick, pickMs, perSecond: Math.round((shots / 1.5) * 10) / 10,
            quick: burst.quick, swapMs: burst.swapMs, startsMs: burst.startsMs, savedMs: burst.savedMs,
          };
          if (shots < 2 || burst.pick < 0 || burst.pick >= shots) return { ...base, status: 'fail', ms: Date.now() - t0, message: `${shots} shots, pick ${burst.pick}`, details };
          return { ...base, status: pickMs > 4000 ? 'warn' : 'pass', ms: Date.now() - t0, message: `${shots} shots in 1.5 s, best shot picked in ${(pickMs / 1000).toFixed(1)} s`, details };
        }

        if (step.action === 'timelapse') {
          if (!cam.startTimeLapse || !cam.stopTimeLapse) return { ...base, status: 'skip', ms: Date.now() - t0, message: 'time-lapse not available' };
          const done = cam.startTimeLapse();
          await wait(6000);
          await cam.stopTimeLapse();
          const clip = await done;
          const size = new File(clip.uri).size ?? 0;
          new File(clip.uri).delete();
          // 6 s at one frame per 0.5 s ≈ 12 frames; fewer than 6 means the encoder fell behind.
          const details = { frames: clip.frames, clipSeconds: clip.duration, bytes: size, ...previewDetails };
          if (clip.frames < 6 || size <= 0) return { ...base, status: 'fail', ms: Date.now() - t0, message: `only ${clip.frames} frames, ${size} bytes`, details };
          return { ...base, status: 'pass', ms: Date.now() - t0, message: `${clip.frames} frames`, details };
        }

        if (step.action === 'burst') {
          if (!cam.takeBurst) return { ...base, status: 'skip', ms: Date.now() - t0, message: 'burst not available' };
          const burst = await cam.takeBurst(5);
          for (const f of burst.frames) {
            const shot = new File(f.uri);
            if (shot.exists) shot.delete();
          }
          const times = burst.frames.map((f) => f.ms);
          const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
          const perSecond = span > 0 ? Math.round(((times.length - 1) * 1000 * 10) / span) / 10 : null;
          const details = { shots: times.length, perSecond, firstShotMs: times[0] ?? null, ...previewDetails };
          if (times.length < 5) return { ...base, status: 'fail', ms: Date.now() - t0, message: `only ${times.length} of 5 shots`, details };
          return { ...base, status: 'pass', ms: Date.now() - t0, message: `${perSecond} photos/s`, details };
        }

        const shot0 = Date.now();
        const photo = step.action === 'night' ? await cam.takeNightPhoto(4) : await cam.takePhoto({ raw: step.props.raw, flash: step.flash ?? 'off' });
        const captureMs = Date.now() - shot0;
        const file = new File(photo.uri);
        const bytes = file.size ?? 0;
        const check = checkPhoto(photo, caps);
        const details = { ...check.details, bytes, raw: photo.raw, depth: photo.depth ?? null, frames: photo.frames ?? null, captureMs, ...previewDetails };

        if (step.action === 'upload') {
          // Test Lab only: through the app's real upload queue, until confirmed in the cloud.
          const entry = saveCapture({ kind: 'photo', sourceUri: photo.uri, width: photo.width, height: photo.height });
          for (let i = 0; i < 120; i++) {
            const e = getState().entries.find((x) => x.id === entry.id);
            if (e?.uploadedAt) return { ...base, status: 'pass', ms: Date.now() - t0, details: { ...details, uploadSeconds: Math.round((Date.now() - t0) / 1000) } };
            if (e?.error) return { ...base, status: 'fail', ms: Date.now() - t0, message: `upload failed: ${e.error}`, details };
            await wait(1000);
          }
          // A hot phone pauses uploads until it cools (by design: store isHot), so that's not a failure.
          if (isHot(getState().thermal)) return { ...base, status: 'warn', ms: Date.now() - t0, message: 'phone hot: uploads paused until it cools (by design)', details };
          return { ...base, status: 'fail', ms: Date.now() - t0, message: 'upload not confirmed within 2 minutes', details };
        }

        // What the file really holds: Ultra HDR gain map (back), mirror flag (front selfie).
        const meta = (step.id === 'back-photo' || step.id === 'front-photo') && LensImaging?.inspectPhoto ? await LensImaging.inspectPhoto(photo.uri).catch(() => null) : null;
        if (meta) Object.assign(details, { file: meta });
        if (step.id === 'back-photo' && fps !== undefined) plainFps.current = fps;
        if (step.id === 'back-photo' && bytes > 0) kept.current.photo = photo.uri;
        else if (step.id === 'portrait' && photo.depth) kept.current.portrait = photo.uri;
        else if (file.exists) file.delete();
        if (bytes <= 0) return { ...base, status: 'fail', ms: Date.now() - t0, message: 'empty photo file', details };
        if (check.status === 'fail') return { ...base, status: 'fail', ms: Date.now() - t0, message: check.message, details };
        if (step.id === 'back-photo' && meta && caps.photoFormat === 'ultraHdr' && !meta.ultraHdr) {
          return { ...base, status: 'warn', ms: Date.now() - t0, message: 'Ultra HDR was on, but the file has no gain map', details };
        }
        if (step.id === 'front-photo' && meta && !meta.mirrored) {
          return { ...base, status: 'warn', ms: Date.now() - t0, message: `selfie not mirrored like the preview (EXIF orientation ${meta.orientation})`, details };
        }
        if (step.id === 'normal-load' && fps !== undefined && plainFps.current) {
          const drop = 1 - fps / plainFps.current;
          const message = `viewfinder ${fps} fps with the readers, ${plainFps.current} fps without`;
          return { ...base, status: drop > MAX_FPS_DROP ? 'warn' : 'pass', ms: Date.now() - t0, message, details: { ...details, fpsDrop: drop } };
        }
        // The mask needs a person in view; a test-rack phone sees none.
        if (step.id === 'portrait' && !photo.depth) {
          return { ...base, status: 'warn', ms: Date.now() - t0, message: 'no person found in view, so no portrait mask (point it at someone to check)', details };
        }
        return { ...base, status: check.status, ms: Date.now() - t0, message: check.message, details };
      } catch (e) {
        return { ...base, status: 'fail', ms: Date.now() - t0, message: errorMessage(e) };
      }
    },
    [applyProps, runOffline],
  );

  const run = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setRunning(true);
    setSteps([]);
    setReport(null);
    setError(null);
    const t0 = Date.now();
    const outcomes: StepOutcome[] = [];
    let device: Record<string, unknown> | null = null;
    kept.current = {};
    plainFps.current = null;
    thermalStart.current = -1;
    thermalEnd.current = -1;
    try {
      device = await cameraDeviceReport();
      const first = await applyProps(DEFAULT_PROPS);
      if (!first) throw new Error('The camera did not start (permission, or the camera is busy).');
      thermalStart.current = camera.current?.thermalStatus ? await camera.current.thermalStatus().catch(() => -1) : -1;
      const cameras = (device?.cameras ?? []) as { facing: string; extensions?: string[] | null }[];
      const extensions = cameras.find((c) => c.facing === 'back')?.extensions ?? [];
      const plan = planSelfTest(first, extensions, launch != null);
      for (const step of plan) {
        setCurrent(step.label);
        const outcome = await runStep(step);
        outcomes.push(outcome);
        setSteps([...outcomes]);
      }
    } catch (e) {
      setError(errorMessage(e));
      outcomes.push({ id: 'start', label: 'Camera start', status: 'fail', ms: Date.now() - t0, message: errorMessage(e) });
    } finally {
      selfTestHooks.setOrientation('auto');
      setCurrent(null);
      deleteFile(kept.current.photo);
      deleteFile(kept.current.portrait);
      deleteFile(kept.current.video);
      kept.current = {};
      const result = { ...summarize(t0, outcomes), device, thermal: { start: thermalStart.current, end: thermalEnd.current } };
      setReport(result);
      setSteps(outcomes);
      // Test Lab / Device Farm runs always report (that's their purpose); a user's own run follows Settings.
      if (launch || diagnosticsEnabled()) await sendSelfTest(result);
      if (launch) {
        if (launch.resultUri) await selfTestHooks.writeResult(launch.resultUri, JSON.stringify({ build: buildInfo(), ...result }, null, 1)).catch(() => false);
        selfTestHooks.finish();
      }
      started.current = false;
      setRunning(false);
    }
  }, [applyProps, runStep, launch]);

  // Test Lab: start right away.
  useEffect(() => {
    if (!launch) return;
    const t = setTimeout(() => void run(), 500);
    return () => clearTimeout(t);
  }, [launch, run]);

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} disabled={current != null}>
          <Text style={styles.headerText}>Close</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>Camera self-test</Text>
        <View style={styles.headerButton} />
      </View>
      <View style={styles.preview}>
        <LensCameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          active
          facing={props.facing}
          lens={props.lens}
          mode={props.mode}
          nightPreview={props.mode === 'night'}
          motionPhoto={props.motion ?? false}
          scanCodes={props.live ?? false}
          sceneSuggest={props.live ?? false}
          mirrorFront
          videoResolution="4k"
          appleLog={false}
          hdrVideo={false}
          fps={30}
          stabilization="standard"
          look={null}
          lookIntensity={1}
          torch={false}
          zoom={1}
          exposureMode="auto"
          iso={0}
          shutter={0}
          ev={0}
          whiteBalanceMode="auto"
          temperature={5500}
          tint={0}
          focusMode="auto"
          lensPosition={0.5}
          raw={props.raw}
          hdrPhoto={props.hdrPhoto}
          extension={props.extension}
          captureMode={props.captureMode ?? 'auto'}
          analysis={ANALYSIS}
          onReady={(e) => onReady(e.nativeEvent)}
          onDiagnostics={(e) => onDiagnostics(e.nativeEvent)}
          onMotionUnavailable={() => {
            motionOff.current = true;
          }}
          onError={(e) => setError(e.nativeEvent.message)}
        />
        {current ? (
          <View style={styles.busy}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.busyText}>{current}</Text>
          </View>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        <Text style={styles.muted}>{buildLabel()}</Text>
        {report ? (
          <Text style={[styles.summary, { color: report.failed ? '#FF453A' : '#30D158' }]}>
            {report.passed} passed · {report.warnings} warnings · {report.failed} failed · {report.skipped} skipped ·{' '}
            {(report.totalMs / 1000).toFixed(0)} s
          </Text>
        ) : null}
        {!launch ? (
          <Pressable onPress={run} disabled={current != null} style={[styles.primary, current != null && { opacity: 0.4 }]}>
            <Text style={styles.primaryText}>{report ? 'Run again' : 'Run self-test'}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.muted}>Takes about a minute. The screen turns to landscape and back; test photos are deleted afterwards.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {steps.map((s) => (
          <View key={s.id} style={styles.row}>
            <Text style={[styles.mark, { color: MARK_COLOR[s.status] }]}>{MARK[s.status]}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>
                {s.label} <Text style={styles.muted}>{(s.ms / 1000).toFixed(1)} s</Text>
              </Text>
              {s.message ? <Text style={[styles.stepMessage, s.status === 'warn' && { color: '#FACC15' }]}>{s.message}</Text> : null}
              {s.details?.saved ? (
                <Text style={styles.muted}>
                  {String(s.details.saved)} of {String(s.details.max ?? '?')}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
  headerButton: { minWidth: 60, minHeight: 44, justifyContent: 'center' },
  headerText: { color: colors.link, fontSize: 17 },
  // flex: Android measured the bold title too narrow and wrapped "Camera info" onto a hidden line.
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: '700' },
  preview: { width: '100%', aspectRatio: 3 / 4, maxHeight: '45%', backgroundColor: '#1C1C1E', overflow: 'hidden' },
  busy: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.7)', flexDirection: 'row', gap: 8, alignItems: 'center' },
  busyText: { color: '#fff', fontSize: 13, flex: 1 },
  muted: { color: '#86868B', fontSize: 12, marginTop: 4 },
  summary: { fontSize: 16, fontWeight: '700', marginTop: 10 },
  primary: { marginTop: 14, backgroundColor: colors.action, borderRadius: 980, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#FF453A', marginTop: 10, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  mark: { fontSize: 16, width: 18, textAlign: 'center' },
  stepTitle: { color: '#fff', fontSize: 14 },
  stepMessage: { color: '#FF453A', fontSize: 12, marginTop: 2 },
});
