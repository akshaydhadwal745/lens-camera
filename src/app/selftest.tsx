// Camera self-test (Android): Settings → Camera info → Run self-test, or
// automatically when Firebase Test Lab launches Lens as a "game loop" (then it
// also uploads a photo, writes Test Lab's result file and closes the app).
// Steps and checks: src/lib/self-test.ts; docs/features/self-test.md.
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Capabilities, CameraDiagnostics, cameraDeviceReport, LensCameraHandle, LensCameraView } from '../../modules/lens-camera';
import { selfTestHooks } from '../../modules/lens-device';
import { buildInfo, buildLabel } from '@/lib/build-info';
import { sendSelfTest } from '@/lib/diagnostics';
import {
  checkPhoto,
  DEFAULT_PROPS,
  planSelfTest,
  SelfTestProps,
  SelfTestReport,
  SelfTestStep,
  StepOutcome,
  summarize,
} from '@/lib/self-test';
import { capture as saveCapture, getState } from '@/lib/store';
import { colors, errorMessage } from '@/lib/ui';

const MARK = { pass: '✓', warn: '!', fail: '✗', skip: '–' } as const;
const MARK_COLOR = { pass: '#7d7', warn: '#fc6', fail: '#f87', skip: '#999' } as const;

const ANALYSIS = { peaking: false, zebra: false, zebraLevel: 0.95, falseColor: false, histogram: false };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const changed = JSON.stringify(next) !== JSON.stringify(propsRef.current);
    const got = waitFor(capsWaiter, latestCaps.current, match, 15000, changed);
    propsRef.current = next;
    setProps(next);
    const caps = await got;
    await wait(1200); // exposure and focus settle
    return caps;
  }, []);

  const runStep = useCallback(
    async (step: SelfTestStep): Promise<StepOutcome> => {
      const t0 = Date.now();
      const base = { id: step.id, label: step.label };
      const cam = camera.current;
      if (!cam) return { ...base, status: 'fail', ms: 0, message: 'camera view missing' };
      try {
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
        const previewDetails = preview ? { cameraTransform: preview.cameraTransform, mirroring: preview.mirroring, targetRotation: preview.targetRotation } : {};

        if (step.action === 'video') {
          const done = cam.startRecording();
          await wait(3000);
          await cam.stopRecording();
          const v = await done;
          const size = new File(v.uri).size ?? 0;
          new File(v.uri).delete();
          const ok = v.duration >= 2 && size > 0;
          return { ...base, status: ok ? 'pass' : 'fail', ms: Date.now() - t0, message: ok ? undefined : `video ${v.duration}s, ${size} bytes`, details: { duration: v.duration, bytes: size, ...previewDetails } };
        }

        const photo = step.action === 'night' ? await cam.takeNightPhoto(4) : await cam.takePhoto({ raw: step.props.raw, flash: step.flash ?? 'off' });
        const file = new File(photo.uri);
        const bytes = file.size ?? 0;
        const check = checkPhoto(photo, caps);
        const details = { ...check.details, bytes, raw: photo.raw, depth: photo.depth ?? null, frames: photo.frames ?? null, ...previewDetails };

        if (step.action === 'upload') {
          // Test Lab only: through the app's real upload queue, until confirmed in the cloud.
          const entry = saveCapture({ kind: 'photo', sourceUri: photo.uri, width: photo.width, height: photo.height });
          for (let i = 0; i < 120; i++) {
            const e = getState().entries.find((x) => x.id === entry.id);
            if (e?.uploadedAt) return { ...base, status: 'pass', ms: Date.now() - t0, details: { ...details, uploadSeconds: Math.round((Date.now() - t0) / 1000) } };
            if (e?.error) return { ...base, status: 'fail', ms: Date.now() - t0, message: `upload failed: ${e.error}`, details };
            await wait(1000);
          }
          return { ...base, status: 'fail', ms: Date.now() - t0, message: 'upload not confirmed within 2 minutes', details };
        }

        if (file.exists) file.delete();
        if (bytes <= 0) return { ...base, status: 'fail', ms: Date.now() - t0, message: 'empty photo file', details };
        if (check.status === 'fail') return { ...base, status: 'fail', ms: Date.now() - t0, message: check.message, details };
        // The mask needs a person in view; a test-rack phone sees none.
        if (step.id === 'portrait' && !photo.depth) {
          return { ...base, status: 'warn', ms: Date.now() - t0, message: 'no person found in view, so no portrait mask (point it at someone to check)', details };
        }
        return { ...base, status: check.status, ms: Date.now() - t0, message: check.message, details };
      } catch (e) {
        return { ...base, status: 'fail', ms: Date.now() - t0, message: errorMessage(e) };
      }
    },
    [applyProps],
  );

  const run = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    setSteps([]);
    setReport(null);
    setError(null);
    const t0 = Date.now();
    const outcomes: StepOutcome[] = [];
    try {
      const device = (await cameraDeviceReport()) as { cameras?: { facing: string; extensions?: string[] | null }[] } | null;
      const first = await applyProps(DEFAULT_PROPS);
      if (!first) throw new Error('The camera did not start (permission, or the camera is busy).');
      const extensions = device?.cameras?.find((c) => c.facing === 'back')?.extensions ?? [];
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
      const result = summarize(t0, outcomes);
      setReport(result);
      setSteps(outcomes);
      await sendSelfTest(result);
      if (launch) {
        if (launch.resultUri) await selfTestHooks.writeResult(launch.resultUri, JSON.stringify({ build: buildInfo(), ...result }, null, 1)).catch(() => false);
        selfTestHooks.finish();
      }
      started.current = false;
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
        <Text style={styles.title}>Camera self-test</Text>
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
          analysis={ANALYSIS}
          onReady={(e) => onReady(e.nativeEvent)}
          onDiagnostics={(e) => onDiagnostics(e.nativeEvent)}
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
          <Text style={[styles.summary, { color: report.failed ? '#f87' : '#7d7' }]}>
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
              {s.message ? <Text style={[styles.stepMessage, s.status === 'warn' && { color: '#fc6' }]}>{s.message}</Text> : null}
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
  headerText: { color: colors.accent, fontSize: 17 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  preview: { width: '100%', aspectRatio: 3 / 4, maxHeight: '45%', backgroundColor: '#111', overflow: 'hidden' },
  busy: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.7)', flexDirection: 'row', gap: 8, alignItems: 'center' },
  busyText: { color: '#fff', fontSize: 13, flex: 1 },
  muted: { color: '#888', fontSize: 12, marginTop: 4 },
  summary: { fontSize: 16, fontWeight: '700', marginTop: 10 },
  primary: { marginTop: 14, backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#000', fontSize: 16, fontWeight: '700' },
  error: { color: '#f87', marginTop: 10, fontSize: 13 },
  row: { flexDirection: 'row', gap: 10, marginTop: 12 },
  mark: { fontSize: 16, width: 18, textAlign: 'center' },
  stepTitle: { color: '#fff', fontSize: 14 },
  stepMessage: { color: '#f87', fontSize: 12, marginTop: 2 },
});
