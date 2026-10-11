import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AnalysisResult,
  CameraMode,
  Capabilities,
  CameraStats,
  LensCameraHandle,
  LensCameraView,
  LensImaging,
  PhotoResult,
} from '../../../modules/lens-camera';
import { Framing, Histogram, LevelIndicator } from './Monitors';
import { Choice, Sheet, Toggle } from './Sheet';
import { NamePrompt } from './NamePrompt';
import { ValueDial } from './ValueDial';
import { LiveUploadPill } from '@/components/LiveUploadPill';
import { reportCameraError, reportCameraReady, reportPreview } from '@/lib/diagnostics';
import { compact, EditRecipe, LOOKS, PORTRAIT_STYLES } from '@/lib/edits';
import { formatDuration } from '@/lib/format';
import {
  AUTO_NIGHT_FRAMES,
  BUILT_IN_PRESETS,
  effectiveSettings,
  formatEv,
  formatFocus,
  formatShutter,
  isLowLight,
  loadPresets,
  loadSettings,
  ManualParam,
  nearestIndex,
  Preset,
  ProSettings,
  savePresets,
  saveSettings,
  scaleFor,
  snapshotPreset,
} from '@/lib/pro-camera';
import { capture, finishLiveUpload, isHot, selectGallery, selectPendingCount, startLiveUpload, useStore } from '@/lib/store';
import { font, glass, palette, radius } from '@/lib/theme';
import { displayUri, newId } from '@/lib/types';

type IconName = ComponentProps<typeof Ionicons>['name'];

const INTENSITY = Array.from({ length: 21 }, (_, i) => i / 20);

function haptic(style = Haptics.ImpactFeedbackStyle.Medium) {
  Haptics.impactAsync(style).catch(() => {});
}

// Every top button has two lines (icon or value on top, caption below) so they line up in the pill.
function TopButton({ icon, label, caption, active, onPress }: { icon?: IconName; label?: string; caption?: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.topButton} accessibilityRole="button" accessibilityLabel={[label, caption].filter(Boolean).join(' ') || icon}>
      {icon ? (
        <>
          <Ionicons name={icon} size={18} color={active ? palette.accent : palette.text} />
          {label ? <Text style={[styles.topLabel, active && styles.topLabelOn]}>{label}</Text> : null}
        </>
      ) : (
        <>
          <Text style={[styles.topValue, active && styles.topLabelOn]}>{label}</Text>
          <Text style={[styles.topLabel, active && styles.topLabelOn]}>{caption ?? (active ? 'ON' : 'OFF')}</Text>
        </>
      )}
    </Pressable>
  );
}

/** `onUnavailable`: the native camera couldn't start on this phone (fall back to the basic camera). */
export function ProCamera({ onUnavailable }: { onUnavailable?: (message: string) => void } = {}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Landscape: the tray docks on the right as a fixed-width panel and the overlays keep clear of it.
  const landscape = width > height;
  const trayWidth = 340;
  const clearTray = landscape ? trayWidth + insets.right + 24 : 0;
  const isFocused = useIsFocused();
  const cameraRef = useRef<LensCameraHandle>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  // `stored`: what the user chose (saved). `s`: what the camera uses — with Pro
  // off, everything technical is automatic (effectiveSettings).
  const [stored, setS] = useState<ProSettings>(loadSettings);
  // Settings → Camera changes options while this screen stays mounted: take them when coming back.
  const [wasFocused, setWasFocused] = useState(isFocused);
  if (isFocused !== wasFocused) {
    setWasFocused(isFocused);
    if (isFocused) {
      const saved = loadSettings();
      // Options set in Settings → Camera while this screen stayed mounted.
      const keys = ['normalGrid', 'mirrorSelfies', 'saveLocation', 'shutterSound'] as const;
      if (keys.some((k) => saved[k] !== stored[k])) {
        setS((prev) => ({ ...prev, ...Object.fromEntries(keys.map((k) => [k, saved[k]])) }));
      }
    }
  }
  const s = useMemo(() => effectiveSettings(stored), [stored]);
  // Simple mode: low light switches photos to a multi-frame Night shot by itself.
  const [lowLight, setLowLight] = useState(false);
  const [nightOff, setNightOff] = useState(false);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [stats, setStats] = useState<CameraStats | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [param, setParam] = useState<ManualParam | null>(null);
  const [sheet, setSheet] = useState<'none' | 'monitor' | 'presets'>('none');
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  /** Id of the upload running while recording (null: uploads after you stop). */
  const [liveId, setLiveId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Recording asked for, but frames aren't being saved yet (mic + encoder starting:
  // 0.3–1.5 s depending on the phone). REC and the timer only show once it's real.
  const [recLive, setRecLive] = useState(false);
  // Paused mid-recording (one file; paused time isn't recorded).
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  // Tap point + tap-to-expose in one state, so gestures update it functionally and
  // never need to be rebuilt mid-drag (a rebuilt gesture cancels the active drag).
  // ev: drag up/down after a tap (Normal and PRO), added on top of PRO's EV; kept
  // after the box fades, reset by a new tap. visible: the box + sun slider show.
  const [focus, setFocus] = useState<{ x: number; y: number; n: number; ev: number; visible: boolean } | null>(null);
  const tapEv = focus?.ev ?? 0;
  const focusMark = focus?.visible ? focus : null;
  // Long-press lock: what this camera could hold ("AE/AF", "AE" or "AF"), or null.
  const [lockLabel, setLockLabel] = useState<string | null>(null);
  // A new camera or mode starts unlocked at normal brightness (the camera re-binds).
  const cameraKey = `${s.mode}|${s.position}|${s.lens}`;
  const [lastCameraKey, setLastCameraKey] = useState(cameraKey);
  if (cameraKey !== lastCameraKey) {
    setLastCameraKey(cameraKey);
    setLockLabel(null);
    setFocus(null);
  }
  const [previewSize, setPreviewSize] = useState({ width, height });
  const [processing, setProcessing] = useState<string | null>(null);
  // A short message over the viewfinder (e.g. Portrait found nobody), gone after a few seconds.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 3000);
  };
  const [lookDial, setLookDial] = useState(false);
  const [naming, setNaming] = useState(false);

  const items = useStore(selectGallery);
  const pending = useStore(selectPendingCount);
  const hot = useStore((st) => isHot(st.thermal));
  const latest = items[0];
  const flash = useRef(new Animated.Value(0)).current;
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist settings (debounced; dials change them rapidly).
  useEffect(() => {
    const t = setTimeout(() => saveSettings(stored), 400);
    return () => clearTimeout(t);
  }, [stored]);

  useEffect(() => {
    if (!recording || !recLive || paused) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording, recLive, paused]);

  const update = useCallback((patch: Partial<ProSettings>) => setS((prev) => ({ ...prev, ...patch })), []);

  // ---------- Manual parameters ----------

  const isManual = (p: ManualParam) =>
    p === 'iso' || p === 'shutter'
      ? s.exposureMode === 'manual'
      : p === 'wb'
        ? s.whiteBalanceMode === 'manual'
        : p === 'focus'
          ? s.focusMode === 'manual'
          : s.exposureMode === 'auto' && s.ev !== 0;

  const currentValue = (p: ManualParam): number => {
    switch (p) {
      case 'iso':
        return s.exposureMode === 'manual' ? s.iso : (stats?.iso ?? s.iso);
      case 'shutter':
        return s.exposureMode === 'manual' ? s.shutter : (stats?.shutter ?? s.shutter);
      case 'wb':
        return s.whiteBalanceMode === 'manual' ? s.temperature : (stats?.temperature ?? s.temperature);
      case 'focus':
        return s.focusMode === 'manual' ? s.lensPosition : (stats?.lensPosition ?? s.lensPosition);
      case 'ev':
        return s.ev;
    }
  };

  const setManual = (p: ManualParam, value: number) => {
    switch (p) {
      case 'iso':
      case 'shutter':
        // Seed the other value from what auto was doing, so the image doesn't jump.
        update({
          exposureMode: 'manual',
          iso: p === 'iso' ? value : s.exposureMode === 'manual' ? s.iso : (stats?.iso ?? s.iso),
          shutter: p === 'shutter' ? value : s.exposureMode === 'manual' ? s.shutter : (stats?.shutter ?? s.shutter),
        });
        break;
      case 'wb':
        update({ whiteBalanceMode: 'manual', temperature: value });
        break;
      case 'focus':
        update({ focusMode: 'manual', lensPosition: value });
        break;
      case 'ev':
        update({ exposureMode: 'auto', ev: value });
        break;
    }
  };

  const setAuto = (p: ManualParam) => {
    if (p === 'iso' || p === 'shutter') update({ exposureMode: 'auto' });
    else if (p === 'wb') update({ whiteBalanceMode: 'auto' });
    else if (p === 'focus') update({ focusMode: 'auto' });
    else update({ ev: 0 });
  };

  const paramLabel = (p: ManualParam, v: number) =>
    p === 'iso' ? `${Math.round(v)}` : p === 'shutter' ? formatShutter(v) : p === 'wb' ? `${Math.round(v / 100) * 100}K` : p === 'focus' ? formatFocus(v) : formatEv(v);

  const dialScale = useMemo(() => (param ? scaleFor(param, caps) : null), [param, caps]);

  // ---------- Capture ----------

  /** Look (+ portrait blur) attached to a new shot, as a non-destructive recipe. */
  const captureRecipe = (depth?: boolean, kind: 'photo' | 'video' = 'photo'): EditRecipe | undefined => {
    const recipe: EditRecipe = {};
    if (s.look) {
      recipe.look = s.look;
      if (s.lookIntensity < 1) recipe.intensity = s.lookIntensity;
    }
    if (kind === 'photo' && depth && s.mode === 'portrait') recipe.portrait = { aperture: s.portraitAperture, style: s.portraitStyle };
    return compact(recipe) ?? undefined;
  };

  // Flash set to AUTO or ON is the user's choice for low light: it wins over automatic Night.
  const nightCandidate = !stored.pro && s.mode === 'photo' && lowLight && s.flash === 'off' && (!caps?.modes || caps.modes.includes('night'));
  const autoNight = nightCandidate && !nightOff;
  // Whether the top-left glass pill has anything in it (else it's hidden).
  // (Photo modes always have the timer; video has the torch when the camera does.)
  // Video-like modes record with the shutter (start/stop): video, slow motion, time-lapse.
  const recordMode = s.mode === 'video' || s.mode === 'slowmo' || s.mode === 'timelapse';
  const hasTools = stored.pro || nightCandidate || !recordMode || ((s.mode === 'video' || s.mode === 'slowmo') && caps?.torch !== false);

  const takePhoto = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    haptic();
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    try {
      let photo: PhotoResult;
      if (s.mode === 'night' || autoNight) {
        setProcessing('Hold still…');
        photo = await cameraRef.current.takeNightPhoto(autoNight ? AUTO_NIGHT_FRAMES : s.nightFrames);
      } else {
        photo = await cameraRef.current.takePhoto({ raw: s.raw && !!caps?.raw && s.mode === 'photo', flash: s.flash });
      }
      const recipe = captureRecipe(photo.depth);
      // Portrait only blurs around a person; say so instead of a silent plain photo.
      if (s.mode === 'portrait' && !photo.depth && !photo.raw) showNotice('No person found · saved as a normal photo');
      if (recipe && s.bakeLooks && LensImaging && !photo.raw) {
        // "Bake": write the look into the file itself (no removable edit).
        setProcessing('Applying look…');
        const baked = await LensImaging.renderImage(photo.uri, recipe, { format: 'heic', quality: 0.95 });
        capture({ kind: 'photo', sourceUri: baked.uri, width: baked.width, height: baked.height });
      } else {
        capture({ kind: 'photo', sourceUri: photo.uri, width: photo.width, height: photo.height, edit: recipe });
      }
    } catch (error) {
      Alert.alert('Could not take photo', error instanceof Error ? error.message : String(error));
    } finally {
      setProcessing(null);
      setBusy(false);
    }
  };

  const toggleRecording = () => {
    if (!cameraRef.current) return;
    haptic();
    if (recording) {
      cameraRef.current.stopRecording();
      return;
    }
    setRecording(true);
    // Android tells us when frames really flow (onRecordingStarted); elsewhere assume now.
    setElapsed(0);
    setRecLive(Platform.OS !== 'android');
    const recipe = captureRecipe(false, 'video');
    const baking = !!recipe && s.bakeLooks && !!LensImaging;
    // Upload while recording (Android, Wi-Fi by default). Not when baking a look:
    // the uploaded file would be the re-encoded one, not this recording.
    const id = newId();
    const live = baking ? null : startLiveUpload(id);
    setLiveId(live ? id : null);
    cameraRef.current
      .startRecording()
      .then(async (video) => {
        if (baking) {
          // Baking a look into video re-encodes it (takes a while, uses battery).
          setProcessing('Applying look to video…');
          try {
            const exported = await LensImaging!.exportVideo(video.uri, recipe!);
            capture({ kind: 'video', sourceUri: exported.uri, duration: video.duration });
            return;
          } finally {
            setProcessing(null);
          }
        }
        const entry = capture({ kind: 'video', sourceUri: video.uri, duration: video.duration, edit: recipe, id, live: !!live });
        if (live) void finishLiveUpload(live, entry);
      })
      .catch((error) => {
        live?.cancel();
        Alert.alert('Recording failed', error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setRecording(false);
        setRecLive(false);
        setPaused(false);
      });
  };

  /** Time-lapse: start/stop; the clip saves like a video (look as a removable edit). */
  const toggleTimeLapse = () => {
    const cam = cameraRef.current;
    if (!cam?.startTimeLapse || !cam.stopTimeLapse) return;
    haptic();
    if (recording) {
      void cam.stopTimeLapse();
      return;
    }
    setRecording(true);
    setElapsed(0);
    setRecLive(true);
    const recipe = captureRecipe(false, 'video');
    cam
      .startTimeLapse()
      .then((clip) => {
        capture({ kind: 'video', sourceUri: clip.uri, duration: clip.duration, edit: recipe });
      })
      .catch((error) => Alert.alert('Time-lapse', error instanceof Error ? error.message : String(error)))
      .finally(() => {
        setRecording(false);
        setRecLive(false);
      });
  };

  /** Photo while recording: full resolution where supported, else the video frame. */
  const takeVideoPhoto = () => {
    const cam = cameraRef.current;
    if (!cam?.takeVideoPhoto) return;
    haptic(Haptics.ImpactFeedbackStyle.Light);
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    cam
      .takeVideoPhoto()
      .then((photo) => capture({ kind: 'photo', sourceUri: photo.uri, width: photo.width, height: photo.height, edit: captureRecipe(false) }))
      .catch((error) => Alert.alert('Could not take photo', error instanceof Error ? error.message : String(error)));
  };

  const togglePause = () => {
    const cam = cameraRef.current;
    if (!cam?.pauseRecording || !cam.resumeRecording) return;
    haptic(Haptics.ImpactFeedbackStyle.Light);
    const next = !paused;
    setPaused(next);
    (next ? cam.pauseRecording() : cam.resumeRecording()).catch(() => setPaused(!next));
  };

  const onShutter = () => {
    if (s.mode === 'video' || s.mode === 'slowmo') return toggleRecording();
    if (s.mode === 'timelapse') return toggleTimeLapse();
    if (countdown !== null) {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      countdownTimer.current = null;
      setCountdown(null);
      return;
    }
    if (!s.timer) return takePhoto();
    let left: number = s.timer;
    setCountdown(left);
    countdownTimer.current = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        if (countdownTimer.current) clearInterval(countdownTimer.current);
        countdownTimer.current = null;
        setCountdown(null);
        takePhoto();
      } else {
        setCountdown(left);
      }
    }, 1000);
  };

  const switchMode = async (mode: CameraMode) => {
    if (mode === s.mode || recording) return;
    // Ask for the mic before the session is rebuilt for video, so audio is attached.
    if (mode === 'video' && !micPermission?.granted) await requestMicPermission();
    update({ mode });
  };

  // ---------- Gestures ----------

  // Gestures only record what was asked; this effect talks to the camera.
  const [focusRequest, setFocusRequest] = useState<{ x: number; y: number; lock: boolean; unlock: boolean; n: number } | null>(null);
  useEffect(() => {
    const cam = cameraRef.current;
    if (!focusRequest || !cam) return;
    const { x, y, lock, unlock } = focusRequest;
    if (unlock) cam.unlockFocus?.().catch(() => {});
    if (lock && cam.lockFocus) {
      cam
        .lockFocus(x / previewSize.width, y / previewSize.height)
        .then((r) => setLockLabel(r.ae && r.af ? 'AE/AF LOCK' : r.ae ? 'AE LOCK' : r.af ? 'AF LOCK' : null))
        .catch(() => setLockLabel(null));
    } else {
      cam.focusAt(x / previewSize.width, y / previewSize.height).catch(() => {});
    }
  }, [focusRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => {
        if (sheet !== 'none') return;
        if (param) {
          setParam(null);
          return;
        }
        // A tap releases any lock and starts fresh at the new point (unlocking an unlocked camera is harmless).
        setLockLabel(null);
        setFocusRequest((r) => ({ x: e.x, y: e.y, lock: false, unlock: true, n: (r?.n ?? 0) + 1 }));
        setFocus((f) => ({ x: e.x, y: e.y, n: (f?.n ?? 0) + 1, ev: 0, visible: true }));
      });
    const lock = Gesture.LongPress()
      .minDuration(500)
      .runOnJS(true)
      .onStart((e) => {
        if (sheet !== 'none') return;
        haptic(Haptics.ImpactFeedbackStyle.Heavy);
        setFocusRequest((r) => ({ x: e.x, y: e.y, lock: true, unlock: false, n: (r?.n ?? 0) + 1 }));
        setFocus((f) => ({ x: e.x, y: e.y, n: (f?.n ?? 0) + 1, ev: 0, visible: true }));
      });
    // Brighter/darker: one finger up/down while the focus box is showing (or locked).
    const expose = Gesture.Pan()
      .maxPointers(1)
      .activeOffsetY([-12, 12])
      .failOffsetX([-30, 30])
      .runOnJS(true)
      .onChange((e) => {
        if (!caps || (caps.maxEV ?? 0) <= (caps.minEV ?? 0)) return;
        // Only while the box shows. 150 dp of drag = 1 EV (about a third of a screen); up = brighter.
        setFocus((f) => {
          if (!f?.visible) return f;
          const ev = clampEv(f.ev - e.changeY / 150, caps);
          if (f.ev !== 0 && Math.sign(ev) !== Math.sign(f.ev)) haptic(Haptics.ImpactFeedbackStyle.Light);
          return { ...f, ev, n: f.n + 1 };
        });
      });
    // Per-move scale change, so the gesture doesn't depend on the current zoom (no rebuild mid-pinch).
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onChange((e) => {
        const min = caps?.minZoom ?? 1;
        const max = caps?.maxZoom ?? 10;
        setS((prev) => ({ ...prev, zoom: Math.max(min, Math.min(max, prev.zoom * e.scaleChange)) }));
      });
    return Gesture.Race(pinch, expose, Gesture.Exclusive(lock, tap));
  }, [sheet, param, previewSize, caps]); // eslint-disable-line react-hooks/exhaustive-deps

  // The box (and its sun slider) fades 3 s after the last touch; a lock keeps it. The brightness stays.
  const focusN = focus?.visible ? focus.n : null;
  useEffect(() => {
    if (focusN === null || lockLabel) return;
    const t = setTimeout(() => setFocus((f) => (f && f.n === focusN ? { ...f, visible: false } : f)), 3000);
    return () => clearTimeout(t);
  }, [focusN, lockLabel]);



  // ---------- Presets ----------

  const applyPreset = (preset: Preset) => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    update(preset.settings);
    setSheet('none');
  };

  const savePreset = (name: string) => {
    const next = [...presets, snapshotPreset(name, s)];
    setPresets(next);
    savePresets(next);
    setNaming(false);
  };

  const deletePreset = (preset: Preset) => {
    Alert.alert(`Delete “${preset.name}”?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const next = presets.filter((p) => p.id !== preset.id);
          setPresets(next);
          savePresets(next);
        },
      },
    ]);
  };

  // ---------- Permissions ----------

  if (!cameraPermission) {
    return (
      <View style={[styles.fill, styles.center]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (!cameraPermission.granted) {
    return (
      <View style={[styles.fill, styles.center, { padding: 32 }]}>
        <Ionicons name="camera-outline" size={64} color="#fff" />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Pressable
          style={styles.permButton}
          onPress={() => (cameraPermission.canAskAgain ? requestCameraPermission() : Linking.openSettings())}
        >
          <Text style={styles.permButtonText}>{cameraPermission.canAskAgain ? 'Allow camera' : 'Open Settings'}</Text>
        </Pressable>
      </View>
    );
  }

  const lenses = [...(caps?.lenses ?? [])].sort((a, b) => a.factor - b.factor);
  const lensFactor = lenses.find((l) => l.id === s.lens)?.factor ?? 1;
  const peakingOn = s.peaking || (param === 'focus' && s.focusMode === 'manual');
  const params: ManualParam[] = ['iso', 'shutter', 'wb', 'focus', 'ev'];
  const paramTitle: Record<ManualParam, string> = { iso: 'ISO', shutter: 'SHUTTER', wb: 'WB', focus: 'FOCUS', ev: 'EV' };
  const manualExposureAvailable = caps?.manualExposure !== false;
  // Android reports which modes the phone supports; iOS supports all four.
  // Simple mode: no Night button (low light is handled automatically).
  // Time-lapse only where the camera reports it; the others default to available.
  // Time-lapse and slow motion only where the camera reports them; the others default to available.
  const modes = (['timelapse', 'slowmo', 'night', 'video', 'photo', 'portrait'] as const).filter(
    (m) => (m === 'timelapse' || m === 'slowmo' ? !!caps?.modes?.includes(m) : !caps?.modes || caps.modes.includes(m)) && (stored.pro || m !== 'night'),
  );

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill} collapsable={false} onLayout={(e) => setPreviewSize(e.nativeEvent.layout)}>
          <LensCameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            active={isFocused}
            facing={s.position}
            lens={s.position === 'front' || s.mode === 'portrait' ? 'wide' : s.lens}
            mode={s.mode}
            videoResolution={s.videoResolution}
            appleLog={s.mode === 'video' && s.appleLog}
            hdrVideo={s.mode === 'video' && s.hdrVideo}
            fps={s.fps}
            stabilization={s.stabilization}
            look={s.look}
            lookIntensity={s.lookIntensity}
            portraitAperture={s.portraitAperture}
            nightPreview={s.mode === 'night' || autoNight}
            portraitStyle={s.portraitStyle}
            mirrorFront={s.mirrorSelfies}
            saveLocation={s.saveLocation}
            shutterSound={s.shutterSound}
            autoLowLight={!stored.pro}
            torch={(s.mode === 'video' || s.mode === 'slowmo') && s.torch}
            zoom={s.zoom}
            exposureMode={manualExposureAvailable ? s.exposureMode : 'auto'}
            iso={s.iso}
            shutter={s.shutter}
            ev={clampEv(s.ev + tapEv, caps)}
            whiteBalanceMode={s.whiteBalanceMode}
            temperature={s.temperature}
            tint={s.tint}
            focusMode={s.focusMode}
            lensPosition={s.lensPosition}
            raw={s.mode === 'photo' && s.raw && !!caps?.raw}
            hdrPhoto={s.hdrPhoto}
            analysis={{
              // Heat guard: frame analysis overlays switch off while the phone is hot.
              peaking: peakingOn && !hot,
              zebra: s.zebra && !hot,
              zebraLevel: s.zebraLevel,
              falseColor: s.falseColor && !hot,
              histogram: s.histogram && !hot,
            }}
            onReady={(e) => {
              setCaps(e.nativeEvent);
              reportCameraReady(e.nativeEvent);
              // A mode this phone can't do (e.g. from a preset): back to Photo.
              if (e.nativeEvent.modes && !e.nativeEvent.modes.includes(s.mode)) update({ mode: 'photo' });
            }}
            onStats={(e) => {
              const st = e.nativeEvent;
              setStats(st);
              setLowLight((was) => isLowLight(was, st.iso, st.shutter));
            }}
            onAnalysis={(e) => setAnalysis(e.nativeEvent)}
            onError={(e) => {
              reportCameraError(e.nativeEvent.fatal ? 'fallbackBasic' : 'cameraError', e.nativeEvent.message);
              if (e.nativeEvent.fatal && onUnavailable) onUnavailable(e.nativeEvent.message);
              else Alert.alert('Camera', e.nativeEvent.message);
            }}
            onDiagnostics={(e) => reportPreview(e.nativeEvent, s.position)}
            onRecordingStarted={() => {
              setElapsed(0);
              setRecLive(true);
            }}
            hardwareShutter
            onHardwareShutter={() => {
              // Same as tapping the shutter (incl. cancelling a running timer); not while a sheet is open.
              if (sheet === 'none' && !busy) onShutter();
            }}
          />

          <Framing grid={s.grid} guide={s.guide} width={previewSize.width} height={previewSize.height} />

          {/* PRO: the level toggle. Normal: a smart level that shows only when nearly straight. */}
          {(s.level || !stored.pro) && (
            <View style={[StyleSheet.absoluteFill, styles.center, { paddingRight: clearTray }]} pointerEvents="none">
              <LevelIndicator smart={!stored.pro} />
            </View>
          )}

          {focusMark && (
            <View pointerEvents="none" style={[styles.focusWrap, { left: focusMark.x - 36, top: focusMark.y - 36 }]}>
              {lockLabel && <Text style={styles.lockBadge}>{lockLabel}</Text>}
              <View style={styles.focusMark} />
              {(caps?.maxEV ?? 0) > (caps?.minEV ?? 0) && (
                // Sun slider: the sun moves with the brightness change.
                <View style={styles.evTrack}>
                  <View style={[styles.evSun, { top: 36 - 9 - (tapEv / Math.max(1, caps!.maxEV!)) * 30 }]}>
                    <Ionicons name="sunny" size={16} color={palette.accent} />
                  </View>
                  {tapEv !== 0 && <Text style={styles.evValue}>{formatEv(Math.round(tapEv * 10) / 10)}</Text>}
                </View>
              )}
            </View>
          )}

          {processing && (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
              <View style={styles.processing}>
                <ActivityIndicator color="#FACC15" />
                <Text style={styles.processingText}>{processing}</Text>
              </View>
            </View>
          )}

          {countdown !== null && (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
              <Text style={styles.countdown}>{countdown}</Text>
            </View>
          )}

          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: flash }]} />
        </View>
      </GestureDetector>

      {/* ---------- Top HUD ---------- */}
      <View style={[styles.topBar, { paddingTop: insets.top + 10, paddingLeft: insets.left + 16, right: clearTray }]}>
        {recording ? (
          <View style={styles.rec}>
            <View style={[styles.recDot, !recLive && styles.recDotStarting, paused && styles.recDotPaused]} />
            <Text style={styles.recText}>
              {!recLive
                ? 'Starting…'
                : paused
                  ? `${formatDuration(elapsed)} · PAUSED`
                  : s.mode === 'timelapse'
                    ? `${formatDuration(elapsed)} → ${formatDuration(Math.round(timeLapseClipSeconds(elapsed)))}`
                    : s.mode === 'slowmo' && caps?.slowMotionBound
                      ? `${formatDuration(elapsed)} · ${caps.slowMotionBound}× SLOW`
                      : stats?.lowLightBoost
                        ? `${formatDuration(elapsed)} · LOW LIGHT`
                        : formatDuration(elapsed)}
            </Text>
            {s.appleLog && <Text style={styles.badge}>LOG</Text>}
            <Text style={styles.badge}>{s.videoResolution === '4k' ? '4K' : 'HD'}</Text>
            <LiveUploadPill liveId={liveId} />
          </View>
        ) : (
          <>
            <View style={hasTools ? styles.glassPill : null}>
              {s.mode === 'photo' || s.mode === 'portrait' ? (
                (caps?.flash !== false || caps?.screenFlash) && (
                  <TopButton
                    icon={s.flash === 'off' ? 'flash-off' : s.flash === 'auto' ? 'flash-outline' : 'flash'}
                    label={s.flash.toUpperCase()}
                    active={s.flash !== 'off'}
                    onPress={() => update({ flash: s.flash === 'off' ? 'auto' : s.flash === 'auto' ? 'on' : 'off' })}
                  />
                )
              ) : s.mode === 'night' || s.mode === 'timelapse' ? null : (
                caps?.torch !== false && (
                  <TopButton icon={s.torch ? 'flashlight' : 'flashlight-outline'} label="TORCH" active={s.torch} onPress={() => update({ torch: !s.torch })} />
                )
              )}
              {stored.pro && s.mode === 'photo' && caps?.raw && (
                <TopButton label={caps.proRaw ? 'ProRAW' : 'RAW'} active={s.raw} onPress={() => update({ raw: !s.raw })} />
              )}
              {stored.pro && s.mode === 'photo' && caps?.ultraHdr && !s.raw && (
                <TopButton label="HDR" active={s.hdrPhoto} onPress={() => update({ hdrPhoto: !s.hdrPhoto })} />
              )}
              {stored.pro && s.mode === 'video' && (
                <TopButton label={s.videoResolution === '4k' ? '4K' : 'HD'} caption="RES" active onPress={() => update({ videoResolution: s.videoResolution === '4k' ? '1080p' : '4k' })} />
              )}
              {stored.pro && s.mode === 'video' && caps?.appleLog && <TopButton label="LOG" active={s.appleLog} onPress={() => update({ appleLog: !s.appleLog })} />}
              {stored.pro && s.mode === 'video' && caps?.hdrVideo && !s.appleLog && (
                <TopButton label="HDR" active={s.hdrVideo} onPress={() => update({ hdrVideo: !s.hdrVideo })} />
              )}
              {stored.pro && s.mode === 'video' && (
                <TopButton
                  label={`${s.fps}`}
                  caption="FPS"
                  active={s.fps !== 30}
                  onPress={() => update({ fps: s.fps === 30 ? (caps?.fps60 ? 60 : 24) : s.fps === 60 ? 24 : 30 })}
                />
              )}
              {!recordMode && (
                <TopButton
                  icon="timer-outline"
                  label={s.timer ? `${s.timer}s` : 'OFF'}
                  active={s.timer > 0}
                  onPress={() => update({ timer: s.timer === 0 ? 3 : s.timer === 3 ? 10 : 0 })}
                />
              )}
              {stored.pro && (
                <>
                  <TopButton icon="pulse" label="MONITOR" active={s.peaking || s.zebra || s.falseColor} onPress={() => setSheet('monitor')} />
                  <TopButton icon="bookmark-outline" label="PRESETS" onPress={() => setSheet('presets')} />
                </>
              )}
              {nightCandidate && (
                <Pressable
                  onPress={() => {
                    haptic(Haptics.ImpactFeedbackStyle.Light);
                    setNightOff((v) => !v);
                  }}
                  style={[styles.nightButton, nightOff && styles.nightButtonOff]}
                  accessibilityLabel={nightOff ? 'Night off. Tap to turn on' : 'Night on. Tap to turn off'}
                >
                  <Ionicons name="moon" size={14} color={nightOff ? palette.text : '#000'} />
                  <Text style={[styles.nightText, nightOff && { color: palette.text }]}>{nightOff ? 'Night off' : 'Night'}</Text>
                </Pressable>
              )}
            </View>
            <Pressable
              onPress={() => {
                haptic(Haptics.ImpactFeedbackStyle.Light);
                setParam(null);
                setLookDial(false);
                setSheet('none');
                update({ pro: !stored.pro });
              }}
              style={styles.proPill}
              accessibilityRole="button"
              accessibilityLabel={stored.pro ? 'Pro controls on' : 'Pro controls off'}
            >
              <Text style={[styles.proText, stored.pro && { color: palette.accent }]}>PRO</Text>
            </Pressable>
          </>
        )}
      </View>

      {s.histogram && (
        <View style={[styles.histogramWrap, landscape ? { left: insets.left + 16, bottom: insets.bottom + 12 } : { right: 12, top: insets.top + 72 }]}>
          <Histogram data={analysis} />
        </View>
      )}

      {notice && (
        <View style={[styles.notice, { top: insets.top + 118 }, landscape && { right: clearTray }]} pointerEvents="none">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}

      <View style={[styles.zoomBadge, { top: insets.top + 72, left: insets.left + 16 }]} pointerEvents="none">
        <Text style={styles.zoomText}>{(lensFactor * s.zoom).toFixed(1)}×</Text>
        {stats?.adjusting ? <ActivityIndicator size="small" color={palette.accent} style={{ marginLeft: 6 }} /> : null}
      </View>

      {/* ---------- Bottom controls ---------- */}
      <View style={[styles.bottom, { bottom: insets.bottom + 12 }, landscape ? { right: insets.right + 12, width: trayWidth } : { left: 12, right: 12 }]}>
        {stored.pro && param && dialScale && (
          <ValueDial
            title={paramTitle[param]}
            values={dialScale.values}
            index={nearestIndex(dialScale.values, currentValue(param))}
            label={dialScale.label}
            onIndex={(i) => setManual(param, dialScale.values[i])}
            auto={!isManual(param)}
            autoLabel={param === 'ev' ? formatEv(0) : `A ${paramLabel(param, currentValue(param))}`}
            onAuto={() => setAuto(param)}
          />
        )}

        {stored.pro && (
          <View style={styles.params}>
            {params.map((p) => {
              const manual = isManual(p);
              const disabled = (p === 'iso' || p === 'shutter') && !manualExposureAvailable;
              return (
                <Pressable
                  key={p}
                  disabled={disabled}
                  onPress={() => setParam(param === p ? null : p)}
                  onLongPress={() => setAuto(p)}
                  style={[styles.param, param === p && styles.paramActive, disabled && { opacity: 0.35 }]}
                  accessibilityLabel={`${paramTitle[p]} ${manual ? 'manual' : 'auto'}`}
                >
                  <Text style={styles.paramTitle}>{manual ? paramTitle[p] : `${paramTitle[p]} A`}</Text>
                  <Text style={[styles.paramValue, manual && styles.paramValueManual]}>{paramLabel(p, currentValue(p))}</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {lookDial && s.look && (
          <ValueDial
            title="LOOK"
            values={INTENSITY}
            index={nearestIndex(INTENSITY, s.lookIntensity)}
            label={(v) => `${Math.round(v * 100)}%`}
            onIndex={(i) => update({ lookIntensity: INTENSITY[i] })}
            auto={s.lookIntensity === 1}
            autoLabel="100%"
            autoText="FULL"
            onAuto={() => update({ lookIntensity: 1 })}
          />
        )}
        {s.mode === 'portrait' && (
          // Portrait styles replace the looks row here (Normal and PRO): a few, shown live.
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.looksRow}>
            {PORTRAIT_STYLES.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  haptic(Haptics.ImpactFeedbackStyle.Light);
                  update({ portraitStyle: p.id });
                }}
                style={[styles.lookChip, s.portraitStyle === p.id && styles.lookChipOn]}
                accessibilityLabel={`${p.name}: ${p.description}`}
                accessibilityState={{ selected: s.portraitStyle === p.id }}
              >
                <Text style={[styles.lookChipText, s.portraitStyle === p.id && styles.lookChipTextOn]}>{p.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {/* Looks: a creative choice, so in Normal and PRO alike (PRO only adds manual controls). */}
        {s.mode !== 'portrait' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.looksRow}>
            <Pressable onPress={() => { update({ look: null }); setLookDial(false); }} style={[styles.lookChip, !s.look && styles.lookChipOn]}>
              <Text style={[styles.lookChipText, !s.look && styles.lookChipTextOn]}>No look</Text>
            </Pressable>
            {LOOKS.map((l) => (
              <Pressable
                key={l.id}
                onPress={() => {
                  haptic(Haptics.ImpactFeedbackStyle.Light);
                  if (s.look === l.id) setLookDial((d) => !d);
                  else update({ look: l.id });
                }}
                style={[styles.lookChip, s.look === l.id && styles.lookChipOn]}
                accessibilityLabel={l.description}
              >
                <Text style={[styles.lookChipText, s.look === l.id && styles.lookChipTextOn]}>{l.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {s.position === 'back' && s.mode !== 'portrait' && lenses.length > 1 && (
          <View style={styles.lenses}>
            {lenses.map((l) => (
              <Pressable
                key={l.id}
                disabled={recording}
                onPress={() => {
                  haptic(Haptics.ImpactFeedbackStyle.Light);
                  update({ lens: l.id, zoom: 1 });
                }}
                style={[styles.lens, s.lens === l.id && styles.lensOn]}
              >
                <Text style={[styles.lensText, s.lens === l.id && styles.lensTextOn]}>
                  {l.factor < 1 ? `.${Math.round(l.factor * 10)}` : `${l.factor}`}×
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <ModeStrip modes={modes} mode={s.mode} disabled={recording || busy} onSelect={switchMode} />

        <View style={styles.captureRow}>
          {recording && s.mode === 'video' && Platform.OS === 'android' ? (
            // While recording, the gallery spot takes photos (full resolution where the phone allows).
            <Pressable onPress={takeVideoPhoto} disabled={!recLive} style={[styles.thumb, styles.videoPhoto, !recLive && { opacity: 0.3 }]} accessibilityLabel="Take a photo while recording">
              <View style={styles.videoPhotoDot} />
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push('/gallery')} disabled={recording} style={styles.thumb} accessibilityLabel="Open gallery">
              {latest ? (
                displayUri(latest) ? (
                  <Image source={{ uri: displayUri(latest) }} style={styles.thumbImage} contentFit="cover" />
                ) : (
                  <View style={[styles.thumbImage, styles.center, { backgroundColor: palette.surface2 }]}>
                    <Ionicons name="videocam" size={22} color="#fff" />
                  </View>
                )
              ) : (
                <Ionicons name="images-outline" size={24} color="#fff" />
              )}
              {pending > 0 && (
                <View style={styles.pending}>
                  <Ionicons name="cloud-upload" size={10} color="#fff" />
                  <Text style={styles.pendingText}>{pending}</Text>
                </View>
              )}
            </Pressable>
          )}

          <Pressable
            onPress={onShutter}
            disabled={busy || !caps}
            style={({ pressed }) => [styles.shutter, (autoNight || s.mode === 'night') && styles.shutterNight, pressed && { transform: [{ scale: 0.94 }] }]}
            accessibilityLabel={recordMode ? (recording ? 'Stop recording' : 'Record') : 'Take photo'}
          >
            <View style={[styles.shutterInner, recordMode && styles.shutterVideo, recording && styles.shutterRec]} />
          </Pressable>

          {recording && Platform.OS === 'android' && s.mode === 'video' ? (
            // While recording, the flip spot pauses/resumes (flipping can't happen mid-recording).
            <Pressable
              onPress={togglePause}
              disabled={!recLive}
              style={[styles.flip, !recLive && { opacity: 0.3 }]}
              accessibilityLabel={paused ? 'Resume recording' : 'Pause recording'}
            >
              <Ionicons name={paused ? 'radio-button-on' : 'pause'} size={24} color={paused ? palette.rec : palette.text} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => update({ position: s.position === 'back' ? 'front' : 'back', zoom: 1 })}
              disabled={recording}
              style={[styles.flip, recording && { opacity: 0.3 }]}
              accessibilityLabel="Switch camera"
            >
              <Ionicons name="camera-reverse-outline" size={24} color={palette.text} />
            </Pressable>
          )}
        </View>
      </View>

      {/* ---------- Sheets ---------- */}
      {sheet === 'monitor' && (
        <Sheet title="Monitoring & format" onClose={() => setSheet('none')}>
          <Toggle label="Histogram" value={s.histogram} onChange={(v) => update({ histogram: v })} />
          <Toggle label="Focus peaking" hint="Highlights sharp edges in red" value={s.peaking} onChange={(v) => update({ peaking: v })} />
          <Toggle label="Zebra stripes" hint="Stripes over bright areas" value={s.zebra} onChange={(v) => update({ zebra: v })} />
          {s.zebra && (
            <Choice
              label="Zebra level"
              value={s.zebraLevel}
              options={[
                { value: 0.7, label: '70%' },
                { value: 0.9, label: '90%' },
                { value: 0.95, label: '95%' },
                { value: 1, label: '100%' },
              ]}
              onChange={(v) => update({ zebraLevel: v })}
            />
          )}
          <Toggle label="False color" hint="Purple/blue = dark · green = mid-grey · pink = skin · yellow/red = clipping" value={s.falseColor} onChange={(v) => update({ falseColor: v })} />
          <Toggle label="Level" value={s.level} onChange={(v) => update({ level: v })} />
          <Toggle
            label="Save looks into the file"
            hint={
              s.bakeLooks
                ? 'On: the look is permanently part of the photo/video (videos are re-encoded after recording).'
                : 'Off (recommended): the look is a removable edit; the untouched original is kept.'
            }
            value={s.bakeLooks}
            onChange={(v) => update({ bakeLooks: v })}
          />
          {caps && caps.nightFrames >= 2 && (
            <Choice
              label="Night mode frames"
              value={Math.min(s.nightFrames, caps.nightFrames)}
              options={[2, 4, 6, 8].filter((n) => n <= caps.nightFrames).map((n) => ({ value: n, label: `${n}` }))}
              onChange={(v) => update({ nightFrames: v })}
            />
          )}
          <Choice
            label="Portrait blur (default)"
            value={s.portraitAperture}
            options={[1.4, 2, 2.8, 4, 5.6].map((v) => ({ value: v, label: `f/${v}` }))}
            onChange={(v) => update({ portraitAperture: v })}
          />
          <Choice
            label="Video stabilization"
            value={s.stabilization}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'standard', label: 'Standard' },
              { value: 'cinematic', label: 'Cinematic' },
              { value: 'extended', label: 'Extended' },
            ]}
            onChange={(v) => update({ stabilization: v })}
          />
          <Choice
            label="Grid"
            value={s.grid}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'thirds', label: 'Thirds' },
              { value: 'cross', label: 'Center' },
            ]}
            onChange={(v) => update({ grid: v })}
          />
          <Choice
            label="Crop guide"
            value={s.guide}
            options={[
              { value: 'off', label: 'Off' },
              { value: '1:1', label: '1:1' },
              { value: '4:5', label: '4:5' },
              { value: '16:9', label: '16:9' },
              { value: '2.39:1', label: '2.39:1' },
            ]}
            onChange={(v) => update({ guide: v })}
          />
        </Sheet>
      )}

      {sheet === 'presets' && (
        <Sheet title="Presets" onClose={() => setSheet('none')}>
          {[...BUILT_IN_PRESETS, ...presets].map((p) => (
            <Pressable
              key={p.id}
              onPress={() => applyPreset(p)}
              onLongPress={() => (p.id.startsWith('builtin-') ? undefined : deletePreset(p))}
              style={styles.presetRow}
            >
              <Ionicons name={p.id.startsWith('builtin-') ? 'sparkles-outline' : 'bookmark'} size={18} color="#FACC15" />
              <View style={styles.presetText}>
                <Text style={styles.presetName}>{p.name}</Text>
                {describePreset(p) ? <Text style={styles.presetHint}>{describePreset(p)}</Text> : null}
              </View>
            </Pressable>
          ))}
          <Pressable onPress={() => setNaming(true)} style={[styles.presetRow, { marginTop: 4 }]}>
            <Ionicons name="add-circle-outline" size={20} color="#FACC15" />
            <Text style={[styles.presetName, { color: palette.accent }]}>Save current settings…</Text>
          </Pressable>
          <Text style={styles.presetFoot}>Long-press a saved preset to delete it.</Text>
        </Sheet>
      )}
      {naming && (
        <NamePrompt
          title="Save preset"
          message="Saves exposure, white balance, focus, format and monitoring settings."
          onSubmit={savePreset}
          onCancel={() => setNaming(false)}
        />
      )}
    </View>
  );
}

// The selected mode always sits centred over the shutter, like the stock camera;
// the strip slides when the mode changes (labels have different widths).
function ModeStrip<M extends string>({ modes, mode, disabled, onSelect }: { modes: readonly M[]; mode: M; disabled: boolean; onSelect: (m: M) => void }) {
  const [width, setWidth] = useState(0);
  const [items, setItems] = useState<Partial<Record<string, { x: number; w: number }>>>({});
  const [shift] = useState(() => new Animated.Value(0));
  const placed = useRef(false);
  const item = items[mode];
  useEffect(() => {
    if (!width || !item) return;
    const to = width / 2 - (item.x + item.w / 2);
    // JS driver on purpose: a native-driven translate isn't seen by Pressable's
    // hit check, so after the first slide taps on the modes did nothing.
    if (placed.current) Animated.spring(shift, { toValue: to, useNativeDriver: false, speed: 18, bounciness: 4 }).start();
    else shift.setValue(to);
    placed.current = true;
  }, [width, item, shift]);
  return (
    <View style={styles.modes} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.modeRow, { opacity: width && item ? 1 : 0, transform: [{ translateX: shift }] }]}>
        {modes.map((m) => (
          <Pressable
            key={m}
            onPress={() => onSelect(m)}
            disabled={disabled}
            hitSlop={8}
            onLayout={(e) => {
              const { x, width: w } = e.nativeEvent.layout;
              setItems((prev) => (prev[m]?.x === x && prev[m]?.w === w ? prev : { ...prev, [m]: { x, w } }));
            }}
          >
            <Text style={[styles.modeText, mode === m && styles.modeOn]}>{m === 'timelapse' ? 'TIME-LAPSE' : m === 'slowmo' ? 'SLO-MO' : m.toUpperCase()}</Text>
          </Pressable>
        ))}
      </Animated.View>
    </View>
  );
}

/** Clip length a time-lapse of `seconds` makes (same schedule as TimeLapseEncoder.intervalMs; 30 fps). */
function timeLapseClipSeconds(seconds: number): number {
  const stages: [number, number][] = [
    [60, 0.5],
    [300, 1],
    [1200, 2],
    [Infinity, 4],
  ];
  let frames = 0;
  let from = 0;
  for (const [until, interval] of stages) {
    const span = Math.max(0, Math.min(seconds, until) - from);
    frames += span / interval;
    from = until;
    if (seconds <= until) break;
  }
  return frames / 30;
}

/** Exposure compensation within what this camera allows. */
function clampEv(ev: number, caps: { minEV?: number; maxEV?: number } | null | undefined): number {
  const min = caps?.minEV ?? 0;
  const max = caps?.maxEV ?? 0;
  if (max <= min) return 0;
  return Math.max(min, Math.min(max, ev));
}

function describePreset(p: Preset): string {
  const parts: string[] = [];
  const v = p.settings;
  if (v.mode) parts.push(v.mode === 'video' ? 'Video' : 'Photo');
  if (v.exposureMode === 'manual') parts.push(`ISO ${v.iso} · ${formatShutter(v.shutter ?? 0)}`);
  if (v.whiteBalanceMode === 'manual') parts.push(`${v.temperature}K`);
  if (v.appleLog) parts.push('Log');
  if (v.raw) parts.push('RAW');
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  permTitle: { color: palette.text, fontSize: 22, fontFamily: font.bold, marginTop: 16 },
  permButton: { backgroundColor: palette.text, borderRadius: radius.pill, paddingHorizontal: 28, paddingVertical: 14, marginTop: 24 },
  permButtonText: { color: '#000', fontFamily: font.semibold, fontSize: 16 },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  // Floating glass pills over the viewfinder (design B).
  glassPill: { ...glass, flexDirection: 'row', alignItems: 'center', gap: 2, padding: 4, borderRadius: 24, flexShrink: 1 },
  topButton: { alignItems: 'center', minWidth: 40, minHeight: 40, justifyContent: 'center', paddingHorizontal: 2 },
  topLabel: { color: palette.text, fontSize: 9, fontFamily: font.monoMedium, marginTop: 1, letterSpacing: 0.6 },
  topValue: { color: palette.text, fontSize: 13, lineHeight: 18, fontFamily: font.monoSemibold },
  topLabelOn: { color: palette.accent },
  nightButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: palette.accent },
  nightButtonOff: { backgroundColor: 'rgba(255,255,255,0.1)' },
  nightText: { color: '#000', fontSize: 14, fontFamily: font.semibold },
  proPill: { ...glass, height: 48, paddingHorizontal: 18, borderRadius: 24, justifyContent: 'center' },
  proText: { color: palette.text, fontSize: 13, fontFamily: font.semibold, letterSpacing: 0.8 },
  rec: { ...glass, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 22 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.rec },
  recDotStarting: { backgroundColor: palette.muted },
  recDotPaused: { backgroundColor: palette.accent },
  recText: { color: palette.text, fontSize: 16, fontFamily: font.monoMedium, fontVariant: ['tabular-nums'] },
  badge: { color: '#000', backgroundColor: palette.accent, fontSize: 10, fontFamily: font.monoSemibold, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },

  histogramWrap: { position: 'absolute' },
  notice: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  noticeText: { ...glass, color: palette.text, fontSize: 13, fontFamily: font.medium, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, overflow: 'hidden' },
  zoomBadge: {
    position: 'absolute',
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    ...glass,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  zoomText: { color: palette.text, fontFamily: font.monoMedium, fontSize: 13 },

  processing: { ...glass, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22 },
  processingText: { color: palette.text, fontFamily: font.medium },
  looksRow: { paddingHorizontal: 12, gap: 8, paddingVertical: 6 },
  lookChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  lookChipOn: { backgroundColor: palette.accent },
  lookChipText: { color: palette.text, fontSize: 12, fontFamily: font.semibold },
  lookChipTextOn: { color: '#000' },
  focusWrap: { position: 'absolute', width: 72, height: 72 },
  focusMark: { width: 72, height: 72, borderWidth: 1.5, borderColor: 'rgba(250,204,21,0.9)', borderRadius: 6 },
  lockBadge: {
    position: 'absolute',
    top: -30,
    alignSelf: 'center',
    color: '#000',
    backgroundColor: palette.accent,
    fontSize: 10,
    fontFamily: font.monoSemibold,
    letterSpacing: 0.6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  evTrack: { position: 'absolute', left: 80, top: 0, width: 24, height: 72, alignItems: 'center' },
  evSun: { position: 'absolute', width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  evValue: { position: 'absolute', top: 76, color: palette.accent, fontSize: 11, fontFamily: font.monoSemibold, width: 40, textAlign: 'center' },
  countdown: { color: palette.text, fontSize: 120, fontFamily: font.mono },

  // The glass tray: everything you touch to shoot lives in one floating card.
  bottom: { position: 'absolute', ...glass, backgroundColor: 'rgba(18,18,20,0.62)', borderColor: 'rgba(255,255,255,0.12)', borderRadius: radius.bar, paddingTop: 12, paddingBottom: 16, overflow: 'hidden' },
  params: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 6, paddingVertical: 4 },
  param: { alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 10, minWidth: 56 },
  paramActive: { backgroundColor: 'rgba(250,204,21,0.15)' },
  paramTitle: { color: palette.muted, fontSize: 9, fontFamily: font.monoMedium, letterSpacing: 0.8 },
  paramValue: { color: palette.text, fontSize: 14, fontFamily: font.monoSemibold, fontVariant: ['tabular-nums'], marginTop: 1 },
  paramValueManual: { color: palette.accent },

  lenses: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 4 },
  lens: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  lensOn: { backgroundColor: 'rgba(255,255,255,0.22)' },
  lensText: { color: '#C8C8CC', fontSize: 12, fontFamily: font.semibold },
  lensTextOn: { color: palette.text, fontFamily: font.bold, fontSize: 13 },

  modes: { marginTop: 14, overflow: 'hidden' },
  modeRow: { flexDirection: 'row', alignSelf: 'flex-start', gap: 26 },
  modeText: { color: palette.muted, fontSize: 13, fontFamily: font.semibold, letterSpacing: 0.8 },
  modeOn: { color: palette.accent },

  captureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 26, marginTop: 16 },
  thumb: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  videoPhoto: { borderRadius: 24, borderWidth: 2, borderColor: palette.text },
  videoPhotoDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.text },
  thumbImage: { width: '100%', height: '100%', borderRadius: 14 },
  pending: {
    position: 'absolute',
    top: -8,
    right: -10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: palette.action,
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1.5,
    borderColor: '#000',
  },
  pendingText: { color: '#fff', fontSize: 10, fontFamily: font.monoSemibold },
  shutter: { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: palette.text, alignItems: 'center', justifyContent: 'center' },
  // Yellow ring = Lens is doing something smart (Night) for this shot.
  shutterNight: { borderColor: palette.accent },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: palette.text },
  shutterVideo: { backgroundColor: palette.rec },
  shutterRec: { width: 28, height: 28, borderRadius: 6 },
  flip: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },

  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 8, minHeight: 56 },
  presetText: { flex: 1 },
  presetName: { color: palette.text, fontSize: 15, fontFamily: font.semibold },
  presetHint: { color: palette.muted, fontSize: 12, fontFamily: font.mono, marginTop: 2 },
  presetFoot: { color: palette.dim, fontSize: 12, fontFamily: font.regular, paddingHorizontal: 18, paddingTop: 6 },
});
