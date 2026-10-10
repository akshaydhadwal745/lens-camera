// Quality Lab (Android, hidden: Settings → Camera info → Quality Lab).
// One press captures the same scene with every photo pipeline this phone
// supports; sets upload untouched for offline comparison
// (docs/research/camera-quality.md). Keep the phone still (a tripod or propped
// against something) so every pipeline sees the same scene.
import { router } from 'expo-router';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Capabilities, cameraDeviceReport, LensCameraHandle, LensCameraView } from '../../modules/lens-camera';
import { mediaPicker } from '../../modules/lens-device';
import { api } from '@/lib/api';
import {
  BASE_PROPS,
  burstFiles,
  deleteSet,
  keepFile,
  LabCameraProps,
  LabSet,
  LabStep,
  listSets,
  newSet,
  planSteps,
  saveSet,
  setDir,
  StepResult,
  uploadSet,
} from '@/lib/quality-lab';
import { colors, errorMessage } from '@/lib/ui';

const SCENES = ['Bright outdoor', 'Indoor room', 'Dim room', 'Backlit window', 'Moving subject', 'Night outdoor'];

const ANALYSIS = { peaking: false, zebra: false, zebraLevel: 0.95, falseColor: false, histogram: false };

type Report = Record<string, unknown> & { cameras: { facing: string; capabilities: string[]; extensions?: string[] | null }[] };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function QualityLabScreen() {
  const insets = useSafeAreaInsets();
  const camera = useRef<LensCameraHandle>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [props, setProps] = useState<LabCameraProps>(BASE_PROPS);
  const [scene, setScene] = useState(SCENES[1]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sets, setSets] = useState<LabSet[]>(() => listSets());
  const ready = useRef<{ match: (c: Capabilities) => boolean; resolve: (c: Capabilities) => void } | null>(null);
  const latestCaps = useRef<Capabilities | null>(null);
  /** Props as last requested (state updates are async). */
  const propsRef = useRef<LabCameraProps>(BASE_PROPS);

  useEffect(() => {
    cameraDeviceReport()
      .then((r) => {
        if (!r) return setError('Not available on this device.');
        setReport(r as Report);
        // Capability survey: anonymous, capabilities only.
        api.lab.probe(r).catch(() => {});
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const onReady = useCallback((c: Capabilities) => {
    latestCaps.current = c;
    setCaps(c);
    if (ready.current?.match(c)) {
      ready.current.resolve(c);
      ready.current = null;
    }
  }, []);

  /** Applies a step's camera props and waits until the camera has rebound with them. */
  const applyProps = useCallback(async (next: LabCameraProps): Promise<Capabilities | null> => {
    const match = (c: Capabilities) =>
      c.mode === next.mode &&
      (next.extension === 'none' || c.extension === next.extension) &&
      (!next.raw || c.photoFormat === 'raw') &&
      (next.raw || c.photoFormat !== 'raw');
    const changed = JSON.stringify(next) !== JSON.stringify(propsRef.current);
    if (!changed && latestCaps.current && match(latestCaps.current)) return latestCaps.current;
    const got = new Promise<Capabilities | null>((resolve) => {
      ready.current = { match, resolve };
      setTimeout(() => {
        if (ready.current?.resolve === resolve) {
          ready.current = null;
          resolve(null);
        }
      }, 10000);
    });
    propsRef.current = next;
    setProps(next);
    const c = await got;
    // Let auto exposure, focus and white balance settle after a rebind.
    await wait(1500);
    return c;
  }, []);

  const runStep = useCallback(
    async (set: LabSet, step: LabStep): Promise<StepResult> => {
      const cam = camera.current!;
      const thermalBefore = (await cam.thermalStatus?.()) ?? -1;
      const base = { id: step.id, label: step.label, thermalBefore };
      const bound = await applyProps(step.props);
      if (!bound) return { ...base, files: [], durationMs: 0, thermalAfter: thermalBefore, error: 'camera did not switch to this mode' };
      if (step.props.extension !== 'none' && bound.extension !== step.props.extension) {
        return { ...base, files: [], durationMs: 0, thermalAfter: thermalBefore, error: `extension unavailable (bound ${bound.extension})` };
      }
      const started = Date.now();
      try {
        let files: StepResult['files'] = [];
        if (step.capture.kind === 'photo') {
          const r = await cam.takePhoto({ raw: false, flash: 'off' });
          const name = `${step.id}.${r.raw ? 'dng' : 'jpg'}`;
          await keepFile(set, r.uri, name);
          files = [{ name }];
        } else if (step.capture.kind === 'night') {
          const r = await cam.takeNightPhoto(step.capture.frames);
          await keepFile(set, r.uri, `${step.id}.jpg`);
          files = [{ name: `${step.id}.jpg` }];
        } else {
          const r = await cam.takeBurst!(step.capture.frames);
          const moved = burstFiles(step.id, r.frames, r.raw);
          for (const m of moved) await keepFile(set, m.from, m.file.name);
          files = moved.map((m) => m.file);
        }
        const durationMs = Date.now() - started;
        const thermalAfter = (await cam.thermalStatus?.()) ?? -1;
        return { ...base, files, durationMs, thermalAfter, bound: { extension: bound.extension, photoFormat: bound.photoFormat } };
      } catch (e) {
        return { ...base, files: [], durationMs: Date.now() - started, thermalAfter: thermalBefore, error: errorMessage(e) };
      }
    },
    [applyProps],
  );

  const capture = useCallback(async () => {
    if (!report || !camera.current) return;
    setError(null);
    const steps = planSteps(report, caps?.ultraHdr === true);
    const set = newSet(scene, note.trim());
    try {
      for (const [i, step] of steps.entries()) {
        setBusy(`${i + 1}/${steps.length} · ${step.label} — keep still`);
        set.steps.push(await runStep(set, step));
        saveSet(set);
      }
    } finally {
      await applyProps(BASE_PROPS).catch(() => null);
      saveSet(set);
      setSets(listSets());
      setBusy(null);
    }
  }, [report, caps, scene, note, runStep, applyProps]);

  /** The phone's own camera app, same scene: the reference to beat. */
  const addReference = useCallback(async (set: LabSet) => {
    if (!mediaPicker) return;
    const [picked] = await mediaPicker.pick(1);
    if (!picked) return;
    const ext = picked.mimeType?.includes('heic') ? 'heic' : 'jpg';
    const name = `reference.${ext}`;
    await mediaPicker.copy(picked.uri, new File(setDir(set.localId), name).uri);
    set.steps = set.steps.filter((s) => s.id !== 'reference');
    set.steps.push({ id: 'reference', label: 'Phone camera app', files: [{ name }], durationMs: 0, thermalBefore: -1, thermalAfter: -1 });
    saveSet(set);
    setSets(listSets());
  }, []);

  const upload = useCallback(
    async (set: LabSet) => {
      if (!report) return;
      setError(null);
      try {
        const setId = await uploadSet(set, report, (sent, total) =>
          setBusy(`Uploading ${(sent / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB`),
        );
        set.uploadedSetId = setId;
        saveSet(set);
        setSets(listSets());
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [report],
  );

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} disabled={busy != null}>
          <Text style={styles.headerText}>Close</Text>
        </Pressable>
        <Text style={styles.title}>Quality Lab</Text>
        <View style={styles.headerButton} />
      </View>
      <View style={styles.preview}>
        <LensCameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          active
          facing="back"
          lens="wide"
          mode={props.mode}
          videoResolution="1080p"
          appleLog={false}
          hdrVideo={false}
          fps={30}
          stabilization="off"
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
          captureMode={props.captureMode}
          analysis={ANALYSIS}
          onReady={(e) => onReady(e.nativeEvent)}
          onError={(e) => setError(e.nativeEvent.message)}
        />
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color="#fff" />
            <Text style={styles.busyText}>{busy}</Text>
          </View>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        {report ? (
          <Text style={styles.muted}>
            {planSteps(report, caps?.ultraHdr === true).map((s) => s.label).join(' · ')}
          </Text>
        ) : null}
        <View style={styles.chips}>
          {SCENES.map((s) => (
            <Pressable key={s} onPress={() => setScene(s)} style={[styles.chip, scene === s && styles.chipOn]}>
              <Text style={[styles.chipText, scene === s && styles.chipTextOn]}>{s}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Note (optional): what's in the scene"
          placeholderTextColor="#636366"
          style={styles.input}
        />
        <Pressable onPress={capture} disabled={!report || busy != null} style={[styles.primary, (!report || busy != null) && { opacity: 0.4 }]}>
          <Text style={styles.primaryText}>Capture set</Text>
        </Pressable>
        <Text style={styles.muted}>
          Prop the phone up and keep it still until all steps finish. Then shoot the same scene with the phone&apos;s own camera app
          and add it as the reference.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {sets.map((set) => (
          <View key={set.localId} style={styles.card}>
            <Text style={styles.cardTitle}>
              {set.scene} · {new Date(set.createdAt).toLocaleString()}
            </Text>
            {set.note ? <Text style={styles.muted}>{set.note}</Text> : null}
            {set.steps.map((s) => (
              <Text key={s.id} style={[styles.step, s.error ? { color: '#FF453A' } : null]}>
                {s.error ? '✗' : '✓'} {s.label}
                {s.error ? ` — ${s.error}` : ` · ${s.files.length} file${s.files.length === 1 ? '' : 's'} · ${(s.durationMs / 1000).toFixed(1)} s`}
              </Text>
            ))}
            <View style={styles.row}>
              {mediaPicker && !set.uploadedSetId ? (
                <Pressable onPress={() => addReference(set)} disabled={busy != null} style={styles.secondary}>
                  <Text style={styles.secondaryText}>{set.steps.some((s) => s.id === 'reference') ? 'Replace reference' : 'Add reference'}</Text>
                </Pressable>
              ) : null}
              {set.uploadedSetId ? (
                <Text style={styles.done}>Uploaded · {set.uploadedSetId}</Text>
              ) : (
                <Pressable onPress={() => upload(set)} disabled={busy != null} style={styles.secondary}>
                  <Text style={styles.secondaryText}>Upload</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  deleteSet(set.localId);
                  setSets(listSets());
                }}
                disabled={busy != null}
                style={styles.secondary}
              >
                <Text style={[styles.secondaryText, { color: '#FF453A' }]}>Delete</Text>
              </Pressable>
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
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  preview: { width: '100%', aspectRatio: 3 / 4, maxHeight: '50%', backgroundColor: '#1C1C1E', overflow: 'hidden' },
  busy: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, backgroundColor: 'rgba(0,0,0,0.7)', flexDirection: 'row', gap: 8, alignItems: 'center' },
  busyText: { color: '#fff', fontSize: 13, flex: 1 },
  muted: { color: '#86868B', fontSize: 12, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#1C1C1E' },
  chipOn: { backgroundColor: colors.text },
  chipText: { color: '#E8E8ED', fontSize: 13 },
  chipTextOn: { color: '#000', fontWeight: '600' },
  input: { marginTop: 12, backgroundColor: '#1C1C1E', color: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  primary: { marginTop: 14, backgroundColor: colors.action, borderRadius: 980, paddingVertical: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#FF453A', marginTop: 10, fontSize: 13 },
  card: { backgroundColor: '#1C1C1E', borderRadius: 20, padding: 14, marginTop: 14 },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '700' },
  step: { color: '#E8E8ED', fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10, alignItems: 'center' },
  secondary: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#2C2C2E' },
  secondaryText: { color: colors.link, fontSize: 13, fontWeight: '600' },
  done: { color: '#30D158', fontSize: 12 },
});
