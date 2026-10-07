import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AnalysisResult,
  Capabilities,
  CameraStats,
  LensCameraHandle,
  LensCameraView,
} from '../../../modules/lens-camera';
import { Framing, Histogram, LevelIndicator } from './Monitors';
import { Choice, Sheet, Toggle } from './Sheet';
import { ValueDial } from './ValueDial';
import { formatDuration } from '@/lib/format';
import {
  BUILT_IN_PRESETS,
  formatEv,
  formatFocus,
  formatShutter,
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
import { capture, selectGallery, selectPendingCount, useStore } from '@/lib/store';
import { displayUri } from '@/lib/types';

type IconName = ComponentProps<typeof Ionicons>['name'];

function haptic(style = Haptics.ImpactFeedbackStyle.Medium) {
  Haptics.impactAsync(style).catch(() => {});
}

function TopButton({ icon, label, active, onPress }: { icon?: IconName; label?: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.topButton} accessibilityRole="button" accessibilityLabel={label ?? icon}>
      {icon ? <Ionicons name={icon} size={20} color={active ? '#FACC15' : '#fff'} /> : null}
      {label ? <Text style={[styles.topLabel, active && styles.topLabelOn]}>{label}</Text> : null}
    </Pressable>
  );
}

export function ProCamera() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isFocused = useIsFocused();
  const cameraRef = useRef<LensCameraHandle>(null);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [s, setS] = useState<ProSettings>(loadSettings);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [stats, setStats] = useState<CameraStats | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [param, setParam] = useState<ManualParam | null>(null);
  const [sheet, setSheet] = useState<'none' | 'monitor' | 'presets'>('none');
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [focusMark, setFocusMark] = useState<{ x: number; y: number; key: number } | null>(null);
  const [previewSize, setPreviewSize] = useState({ width, height });

  const items = useStore(selectGallery);
  const pending = useStore(selectPendingCount);
  const latest = items[0];
  const flash = useRef(new Animated.Value(0)).current;
  const zoomStart = useRef(1);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist settings (debounced; dials change them rapidly).
  useEffect(() => {
    const t = setTimeout(() => saveSettings(s), 400);
    return () => clearTimeout(t);
  }, [s]);

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

  const takePhoto = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    haptic();
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: 220, useNativeDriver: true }).start();
    try {
      const photo = await cameraRef.current.takePhoto({ raw: s.raw && !!caps?.raw, flash: s.flash });
      capture({ kind: 'photo', sourceUri: photo.uri, width: photo.width, height: photo.height });
    } catch (error) {
      Alert.alert('Could not take photo', error instanceof Error ? error.message : String(error));
    } finally {
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
    cameraRef.current
      .startRecording()
      .then((video) => {
        capture({ kind: 'video', sourceUri: video.uri, duration: video.duration });
      })
      .catch((error) => Alert.alert('Recording failed', error instanceof Error ? error.message : String(error)))
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

  const switchMode = async (mode: 'photo' | 'video') => {
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

  const savePreset = () => {
    Alert.prompt('Save preset', 'Saves exposure, white balance, focus, format and monitoring settings.', (name) => {
      const trimmed = name?.trim();
      if (!trimmed) return;
      const next = [...presets, snapshotPreset(trimmed, s)];
      setPresets(next);
      savePresets(next);
    });
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

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill} collapsable={false} onLayout={(e) => setPreviewSize(e.nativeEvent.layout)}>
          <LensCameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            active={isFocused}
            position={s.position}
            lens={s.position === 'front' ? 'wide' : s.lens}
            mode={s.mode}
            videoResolution={s.videoResolution}
            appleLog={s.mode === 'video' && s.appleLog}
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
            analysis={{
              peaking: peakingOn,
              zebra: s.zebra,
              zebraLevel: s.zebraLevel,
              falseColor: s.falseColor,
              histogram: s.histogram,
            }}
            onReady={(e) => setCaps(e.nativeEvent)}
            onStats={(e) => setStats(e.nativeEvent)}
            onAnalysis={(e) => setAnalysis(e.nativeEvent)}
            onError={(e) => Alert.alert('Camera', e.nativeEvent.message)}
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

          {countdown !== null && (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
              <Text style={styles.countdown}>{countdown}</Text>
            </View>
          )}

          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: flash }]} />
        </View>
      </GestureDetector>

      {/* ---------- Top HUD ---------- */}
      <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
        {recording ? (
          <View style={styles.rec}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>{formatDuration(elapsed)}</Text>
            {s.appleLog && <Text style={styles.badge}>LOG</Text>}
            <Text style={styles.badge}>{s.videoResolution === '4k' ? '4K' : 'HD'}</Text>
          </View>
        ) : (
          <>
            {s.mode === 'photo' ? (
              caps?.flash !== false && (
                <TopButton
                  icon={s.flash === 'off' ? 'flash-off' : s.flash === 'auto' ? 'flash-outline' : 'flash'}
                  label={s.flash.toUpperCase()}
                  active={s.flash !== 'off'}
                  onPress={() => update({ flash: s.flash === 'off' ? 'auto' : s.flash === 'auto' ? 'on' : 'off' })}
                />
              )
            ) : (
              caps?.torch !== false && (
                <TopButton icon={s.torch ? 'flashlight' : 'flashlight-outline'} label="TORCH" active={s.torch} onPress={() => update({ torch: !s.torch })} />
              )
            )}
            {s.mode === 'photo' && caps?.raw && (
              <TopButton label={caps.proRaw ? 'ProRAW' : 'RAW'} active={s.raw} onPress={() => update({ raw: !s.raw })} />
            )}
            {s.mode === 'video' && (
              <TopButton label={s.videoResolution === '4k' ? '4K' : 'HD'} active onPress={() => update({ videoResolution: s.videoResolution === '4k' ? '1080p' : '4k' })} />
            )}
            {s.mode === 'video' && caps?.appleLog && <TopButton label="LOG" active={s.appleLog} onPress={() => update({ appleLog: !s.appleLog })} />}
            {s.mode === 'photo' && (
              <TopButton
                icon="timer-outline"
                label={s.timer ? `${s.timer}s` : 'OFF'}
                active={s.timer > 0}
                onPress={() => update({ timer: s.timer === 0 ? 3 : s.timer === 3 ? 10 : 0 })}
              />
            )}
            <TopButton icon="pulse" label="MONITOR" active={s.peaking || s.zebra || s.falseColor} onPress={() => setSheet('monitor')} />
            <TopButton icon="bookmark-outline" label="PRESETS" onPress={() => setSheet('presets')} />
          </>
        )}
      </View>

      {s.histogram && (
        <View style={[styles.histogramWrap, { top: insets.top + 64 }]}>
          <Histogram data={analysis} />
        </View>
      )}

      <View style={[styles.zoomBadge, { top: insets.top + 64 }]} pointerEvents="none">
        <Text style={styles.zoomText}>{(lensFactor * s.zoom).toFixed(1)}×</Text>
        {stats?.adjusting ? <ActivityIndicator size="small" color="#FACC15" style={{ marginLeft: 6 }} /> : null}
      </View>

      {/* ---------- Bottom controls ---------- */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {param && dialScale && (
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

        {s.position === 'back' && lenses.length > 1 && (
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
          {(['video', 'photo'] as const).map((m) => (
            <Pressable key={m} onPress={() => switchMode(m)} disabled={recording} hitSlop={8}>
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
                <View style={[styles.thumbImage, styles.center, { backgroundColor: '#222' }]}>
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
            style={({ pressed }) => [styles.shutter, pressed && { transform: [{ scale: 0.94 }] }]}
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
            <Ionicons name="camera-reverse-outline" size={26} color="#fff" />
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
          <Pressable onPress={savePreset} style={[styles.presetRow, { marginTop: 4 }]}>
            <Ionicons name="add-circle-outline" size={20} color="#FACC15" />
            <Text style={[styles.presetName, { color: '#FACC15' }]}>Save current settings…</Text>
          </Pressable>
          <Text style={styles.presetFoot}>Long-press a saved preset to delete it.</Text>
        </Sheet>
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
  permTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 16 },
  permButton: { backgroundColor: '#FACC15', borderRadius: 24, paddingHorizontal: 28, paddingVertical: 12, marginTop: 24 },
  permButtonText: { color: '#000', fontWeight: '700', fontSize: 16 },

  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  topButton: { alignItems: 'center', minWidth: 44, minHeight: 40, justifyContent: 'center' },
  topLabel: { color: '#fff', fontSize: 10, fontWeight: '700', marginTop: 2, letterSpacing: 0.5 },
  topLabelOn: { color: '#FACC15' },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' },
  recText: { color: '#fff', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  badge: { color: '#000', backgroundColor: '#FACC15', fontSize: 10, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, overflow: 'hidden' },

  histogramWrap: { position: 'absolute', right: 12 },
  zoomBadge: {
    position: 'absolute',
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  zoomText: { color: '#FACC15', fontWeight: '700', fontSize: 13 },

  focusMark: { position: 'absolute', width: 72, height: 72, borderWidth: 1.5, borderColor: '#FACC15', borderRadius: 4 },
  countdown: { color: '#fff', fontSize: 120, fontWeight: '200' },

  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingTop: 6 },
  params: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 6, paddingVertical: 4 },
  param: { alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8, minWidth: 60 },
  paramActive: { backgroundColor: 'rgba(250,204,21,0.15)' },
  paramTitle: { color: '#999', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  paramValue: { color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 1 },
  paramValueManual: { color: '#FACC15' },

  lenses: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 6 },
  lens: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  lensOn: { backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: '#FACC15' },
  lensText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  lensTextOn: { color: '#FACC15' },

  modes: { flexDirection: 'row', justifyContent: 'center', gap: 28, marginTop: 10 },
  modeText: { color: '#fff', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  modeOn: { color: '#FACC15' },

  captureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32, marginTop: 12 },
  thumb: { width: 52, height: 52, borderRadius: 10, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: '#111' },
  thumbImage: { width: '100%', height: '100%', borderRadius: 8 },
  pending: {
    position: 'absolute',
    top: -8,
    right: -10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1.5,
    borderColor: '#000',
  },
  pendingText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  shutterVideo: { backgroundColor: '#FF3B30' },
  shutterRec: { width: 28, height: 28, borderRadius: 6 },
  flip: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },

  presetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, minHeight: 50 },
  presetName: { color: '#fff', fontSize: 15, fontWeight: '600' },
  presetHint: { color: '#888', fontSize: 12, flex: 1, textAlign: 'right' },
  presetFoot: { color: '#666', fontSize: 12, paddingHorizontal: 18, paddingTop: 6 },
});
