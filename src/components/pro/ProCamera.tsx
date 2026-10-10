import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
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
import { compact, EditRecipe, LOOKS } from '@/lib/edits';
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

function TopButton({ icon, label, active, onPress }: { icon?: IconName; label?: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.topButton} accessibilityRole="button" accessibilityLabel={label ?? icon}>
      {icon ? <Ionicons name={icon} size={18} color={active ? palette.accent : palette.text} /> : null}
      {label ? <Text style={[styles.topLabel, active && styles.topLabelOn]}>{label}</Text> : null}
    </Pressable>
  );
}

/** `onUnavailable`: the native camera couldn't start on this phone (fall back to the basic camera). */
export function ProCamera({ onUnavailable }: { onUnavailable?: (message: string) => void } = {}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isFocused = useIsFocused();
  const cameraRef = useRef<LensCameraHandle>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  // `stored`: what the user chose (saved). `s`: what the camera uses — with Pro
  // off, everything technical is automatic (effectiveSettings).
  const [stored, setS] = useState<ProSettings>(loadSettings);
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
  const [countdown, setCountdown] = useState<number | null>(null);
  const [focusMark, setFocusMark] = useState<{ x: number; y: number; key: number } | null>(null);
  const [previewSize, setPreviewSize] = useState({ width, height });
  const [processing, setProcessing] = useState<string | null>(null);
  const [lookDial, setLookDial] = useState(false);
  const [naming, setNaming] = useState(false);

  const items = useStore(selectGallery);
  const pending = useStore(selectPendingCount);
  const hot = useStore((st) => isHot(st.thermal));
  const latest = items[0];
  const flash = useRef(new Animated.Value(0)).current;
  const zoomStart = useRef(1);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist settings (debounced; dials change them rapidly).
  useEffect(() => {
    const t = setTimeout(() => saveSettings(stored), 400);
    return () => clearTimeout(t);
  }, [stored]);

  useEffect(() => {
    if (!recording) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

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
    if (kind === 'photo' && depth && s.mode === 'portrait') recipe.portrait = { aperture: s.portraitAperture };
    return compact(recipe) ?? undefined;
  };

  // Flash set to AUTO or ON is the user's choice for low light: it wins over automatic Night.
  const nightCandidate = !stored.pro && s.mode === 'photo' && lowLight && s.flash === 'off' && (!caps?.modes || caps.modes.includes('night'));
  const autoNight = nightCandidate && !nightOff;
  // Whether the top-left glass pill has anything in it (else it's hidden).
  const hasTools =
    stored.pro ||
    nightCandidate ||
    (s.mode === 'photo' || s.mode === 'portrait' ? caps?.flash !== false || !!caps?.screenFlash : s.mode !== 'night' && caps?.torch !== false);

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
      .finally(() => setRecording(false));
  };

  const onShutter = () => {
    if (s.mode === 'video') return toggleRecording();
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

  const gesture = useMemo(() => {
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => {
        if (sheet !== 'none') return;
        if (param) {
          setParam(null);
          return;
        }
        cameraRef.current?.focusAt(e.x / previewSize.width, e.y / previewSize.height).catch(() => {});
        setFocusMark({ x: e.x, y: e.y, key: Date.now() });
      });
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        zoomStart.current = s.zoom;
      })
      .onUpdate((e) => {
        const min = caps?.minZoom ?? 1;
        const max = caps?.maxZoom ?? 10;
        update({ zoom: Math.max(min, Math.min(max, zoomStart.current * e.scale)) });
      });
    return Gesture.Race(pinch, tap);
  }, [sheet, param, previewSize, s.zoom, caps, update]);

  useEffect(() => {
    if (!focusMark) return;
    const t = setTimeout(() => setFocusMark(null), 1200);
    return () => clearTimeout(t);
  }, [focusMark]);

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
  const modes = (['night', 'video', 'photo', 'portrait'] as const).filter(
    (m) => (!caps?.modes || caps.modes.includes(m)) && (stored.pro || m !== 'night'),
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
            torch={s.mode === 'video' && s.torch}
            zoom={s.zoom}
            exposureMode={manualExposureAvailable ? s.exposureMode : 'auto'}
            iso={s.iso}
            shutter={s.shutter}
            ev={s.ev}
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
          />

          <Framing grid={s.grid} guide={s.guide} width={previewSize.width} height={previewSize.height} />

          {s.level && (
            <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
              <LevelIndicator />
            </View>
          )}

          {focusMark && (
            <View pointerEvents="none" style={[styles.focusMark, { left: focusMark.x - 36, top: focusMark.y - 36 }]} />
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
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        {recording ? (
          <View style={styles.rec}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>{formatDuration(elapsed)}</Text>
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
              ) : s.mode === 'night' ? null : (
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
                <TopButton label={s.videoResolution === '4k' ? '4K' : 'HD'} active onPress={() => update({ videoResolution: s.videoResolution === '4k' ? '1080p' : '4k' })} />
              )}
              {stored.pro && s.mode === 'video' && caps?.appleLog && <TopButton label="LOG" active={s.appleLog} onPress={() => update({ appleLog: !s.appleLog })} />}
              {stored.pro && s.mode === 'video' && caps?.hdrVideo && !s.appleLog && (
                <TopButton label="HDR" active={s.hdrVideo} onPress={() => update({ hdrVideo: !s.hdrVideo })} />
              )}
              {stored.pro && s.mode === 'video' && (
                <TopButton
                  label={`${s.fps}`}
                  active={s.fps !== 30}
                  onPress={() => update({ fps: s.fps === 30 ? (caps?.fps60 ? 60 : 24) : s.fps === 60 ? 24 : 30 })}
                />
              )}
              {stored.pro && s.mode !== 'video' && (
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
        <View style={[styles.histogramWrap, { top: insets.top + 72 }]}>
          <Histogram data={analysis} />
        </View>
      )}

      <View style={[styles.zoomBadge, { top: insets.top + 72 }]} pointerEvents="none">
        <Text style={styles.zoomText}>{(lensFactor * s.zoom).toFixed(1)}×</Text>
        {stats?.adjusting ? <ActivityIndicator size="small" color={palette.accent} style={{ marginLeft: 6 }} /> : null}
      </View>

      {/* ---------- Bottom controls ---------- */}
      <View style={[styles.bottom, { bottom: insets.bottom + 12 }]}>
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

        {stored.pro && lookDial && s.look && (
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
        {stored.pro && (
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

        <View style={styles.modes}>
          {modes.map((m) => (
            <Pressable key={m} onPress={() => switchMode(m)} disabled={recording || busy} hitSlop={8}>
              <Text style={[styles.modeText, s.mode === m && styles.modeOn]}>{m.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.captureRow}>
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

          <Pressable
            onPress={onShutter}
            disabled={busy || !caps}
            style={({ pressed }) => [styles.shutter, (autoNight || s.mode === 'night') && styles.shutterNight, pressed && { transform: [{ scale: 0.94 }] }]}
            accessibilityLabel={s.mode === 'video' ? (recording ? 'Stop recording' : 'Record') : 'Take photo'}
          >
            <View style={[styles.shutterInner, s.mode === 'video' && styles.shutterVideo, recording && styles.shutterRec]} />
          </Pressable>

          <Pressable
            onPress={() => update({ position: s.position === 'back' ? 'front' : 'back', zoom: 1 })}
            disabled={recording}
            style={[styles.flip, recording && { opacity: 0.3 }]}
            accessibilityLabel="Switch camera"
          >
            <Ionicons name="camera-reverse-outline" size={24} color={palette.text} />
          </Pressable>
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
              <Text style={styles.presetName}>{p.name}</Text>
              <Text style={styles.presetHint}>{describePreset(p)}</Text>
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
  topLabelOn: { color: palette.accent },
  nightButton: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: palette.accent },
  nightButtonOff: { backgroundColor: 'rgba(255,255,255,0.1)' },
  nightText: { color: '#000', fontSize: 14, fontFamily: font.semibold },
  proPill: { ...glass, height: 48, paddingHorizontal: 18, borderRadius: 24, justifyContent: 'center' },
  proText: { color: palette.text, fontSize: 13, fontFamily: font.semibold, letterSpacing: 0.8 },
  rec: { ...glass, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 22 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.rec },
  recText: { color: palette.text, fontSize: 16, fontFamily: font.monoMedium, fontVariant: ['tabular-nums'] },
  badge: { color: '#000', backgroundColor: palette.accent, fontSize: 10, fontFamily: font.monoSemibold, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },

  histogramWrap: { position: 'absolute', right: 12 },
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
  focusMark: { position: 'absolute', width: 72, height: 72, borderWidth: 1.5, borderColor: 'rgba(250,204,21,0.9)', borderRadius: 6 },
  countdown: { color: palette.text, fontSize: 120, fontFamily: font.mono },

  // The glass tray: everything you touch to shoot lives in one floating card.
  bottom: { position: 'absolute', left: 12, right: 12, ...glass, backgroundColor: 'rgba(18,18,20,0.62)', borderColor: 'rgba(255,255,255,0.12)', borderRadius: radius.bar, paddingTop: 12, paddingBottom: 16, overflow: 'hidden' },
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

  modes: { flexDirection: 'row', justifyContent: 'center', gap: 26, marginTop: 14 },
  modeText: { color: palette.muted, fontSize: 13, fontFamily: font.semibold, letterSpacing: 0.8 },
  modeOn: { color: palette.accent },

  captureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 26, marginTop: 16 },
  thumb: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
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

  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, minHeight: 50 },
  presetName: { color: palette.text, fontSize: 15, fontFamily: font.semibold },
  presetHint: { color: palette.muted, fontSize: 12, fontFamily: font.mono, flex: 1, textAlign: 'right' },
  presetFoot: { color: palette.dim, fontSize: 12, fontFamily: font.regular, paddingHorizontal: 18, paddingTop: 6 },
});
