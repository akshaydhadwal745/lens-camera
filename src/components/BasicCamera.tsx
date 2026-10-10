import { Ionicons } from '@expo/vector-icons';
import {
  CameraMode,
  CameraType,
  CameraView,
  FlashMode,
  useCameraPermissions,
  useMicrophonePermissions,
} from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { font, glass } from '@/lib/theme';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/IconButton';
import { LiveUploadPill } from '@/components/LiveUploadPill';
import { reportBasicPhoto } from '@/lib/diagnostics';
import { formatDuration } from '@/lib/format';
import { capture as saveCapture, finishLiveUpload, selectGallery, selectPendingCount, startLiveUpload, useStore } from '@/lib/store';
import { displayUri, newId } from '@/lib/types';

const FLASH_ORDER: FlashMode[] = ['off', 'auto', 'on'];
const TORCH_ORDER: FlashMode[] = ['off', 'on'];
const FLASH_ICON = { off: 'flash-off', auto: 'flash-outline', on: 'flash', screen: 'flash' } as const;
const TIMERS = [0, 3, 10] as const;
type TimerSeconds = (typeof TIMERS)[number];

function haptic() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Camera built on expo-camera; used in Expo Go, where the pro module isn't available. */
export function BasicCamera() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const isFocused = useIsFocused();
  const items = useStore(selectGallery);
  const pending = useStore(selectPendingCount);
  const online = useStore((s) => s.online);

  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [mode, setMode] = useState<CameraMode>('picture');
  const [zoom, setZoom] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const [timer, setTimer] = useState<TimerSeconds>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  /** Id of the upload running while recording (null: uploads after you stop). */
  const [liveId, setLiveId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);

  const elapsedRef = useRef(0);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const zoomStart = useRef(0);
  const shutterOpacity = useRef(new Animated.Value(0)).current;

  // Recording clock.
  useEffect(() => {
    if (!recording) return;
    elapsedRef.current = 0;
    setElapsed(0);
    const id = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  // Cancel any running countdown when leaving the screen.
  useEffect(() => {
    if (!isFocused && countdownTimer.current) {
      clearInterval(countdownTimer.current);
      countdownTimer.current = null;
      setCountdown(null);
    }
  }, [isFocused]);

  // Latest zoom for the pinch handler, so the gesture isn't rebuilt (and
  // re-attached) on every zoom step, which made pinching stutter.
  const zoomRef = useRef(0);
  const recordingRef = useRef(false);
  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  // The refs below are read in gesture callbacks (event time), not during render.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        zoomStart.current = zoomRef.current;
      })
      .onUpdate((e) => {
        const next = Math.min(1, Math.max(0, zoomStart.current + (e.scale - 1) * 0.25));
        zoomRef.current = next;
        setZoom(next);
      });
    const doubleTap = Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd(() => {
        if (!recordingRef.current) setFacing((f) => (f === 'back' ? 'front' : 'back'));
      });
    return Gesture.Simultaneous(pinch, doubleTap);
  }, []);
  /* eslint-enable react-hooks/refs */

  const flashScreen = () => {
    shutterOpacity.setValue(1);
    Animated.timing(shutterOpacity, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  };

  const takePhoto = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    haptic();
    flashScreen();
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        saveCapture({ kind: 'photo', sourceUri: photo.uri, width: photo.width, height: photo.height });
        reportBasicPhoto(photo.width, photo.height);
      }
    } catch (error) {
      Alert.alert('Could not take photo', String(error));
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    if (!cameraRef.current) return;
    if (!micPermission?.granted) {
      const result = await requestMicPermission();
      setMuted(!result.granted);
    }
    haptic();
    setRecording(true);
    // Upload while recording (Android, Wi-Fi by default): most of the video is
    // in the cloud by the time you press stop.
    const id = newId();
    const live = startLiveUpload(id);
    setLiveId(live ? id : null);
    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: 600 });
      if (video?.uri) {
        const entry = saveCapture({ kind: 'video', sourceUri: video.uri, duration: elapsedRef.current, id, live: !!live });
        if (live) void finishLiveUpload(live, entry);
      } else {
        live?.cancel();
      }
    } catch (error) {
      live?.cancel();
      Alert.alert('Recording failed', String(error));
    } finally {
      setRecording(false);
    }
  };

  const stopRecording = () => {
    haptic();
    cameraRef.current?.stopRecording();
  };

  const capture = () => {
    if (mode === 'video') {
      return recording ? stopRecording() : startRecording();
    }
    if (countdown !== null) {
      // Tapping during a countdown cancels it.
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      countdownTimer.current = null;
      setCountdown(null);
      return;
    }
    if (timer === 0) return takePhoto();

    let remaining: number = timer;
    setCountdown(remaining);
    countdownTimer.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownTimer.current) clearInterval(countdownTimer.current);
        countdownTimer.current = null;
        setCountdown(null);
        takePhoto();
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  };

  const cycleFlash = () =>
    setFlash((f) => {
      const order = mode === 'video' ? TORCH_ORDER : FLASH_ORDER;
      const i = order.indexOf(f);
      return order[(i + 1) % order.length];
    });
  const changeMode = (m: CameraMode) => {
    setMode(m);
    if (m === 'video' && flash === 'auto') setFlash('off');
  };
  const cycleTimer = () => setTimer((t) => TIMERS[(TIMERS.indexOf(t) + 1) % TIMERS.length]);
  const flip = () => setFacing((f) => (f === 'back' ? 'front' : 'back'));

  // ---- Permission states ----
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
        <Text style={styles.permBody}>Lens needs your camera to take photos and videos.</Text>
        <Pressable
          style={styles.permButton}
          onPress={() =>
            cameraPermission.canAskAgain ? requestCameraPermission() : Linking.openSettings()
          }
        >
          <Text style={styles.permButtonText}>
            {cameraPermission.canAskAgain ? 'Allow camera' : 'Open Settings'}
          </Text>
        </Pressable>
        <Pressable style={styles.permLink} onPress={() => router.push('/gallery')}>
          <Text style={styles.permLinkText}>Open gallery instead</Text>
        </Pressable>
      </View>
    );
  }

  const latest = items[0];
  const showCamera = isFocused || Platform.OS === 'ios';
  const torch = mode === 'video' && flash === 'on';

  const shutter = (
    <Pressable
      onPress={capture}
      disabled={!ready || busy}
      accessibilityRole="button"
      accessibilityLabel={mode === 'video' ? (recording ? 'Stop recording' : 'Start recording') : 'Take photo'}
      style={({ pressed }) => [styles.shutterOuter, pressed && { transform: [{ scale: 0.94 }] }]}
    >
      <View
        style={[
          styles.shutterInner,
          mode === 'video' && styles.shutterVideo,
          recording && styles.shutterRecording,
        ]}
      />
    </Pressable>
  );

  const thumbnail = (
    <Pressable
      onPress={() => router.push('/gallery')}
      disabled={recording}
      accessibilityRole="button"
      accessibilityLabel="Open gallery"
      style={styles.thumb}
    >
      {latest ? (
        displayUri(latest) ? (
          <Image source={{ uri: displayUri(latest) }} style={styles.thumbImage} contentFit="cover" />
        ) : (
          <View style={[styles.thumbImage, styles.center, { backgroundColor: '#2C2C2E' }]}>
            <Ionicons name="videocam" size={22} color="#fff" />
          </View>
        )
      ) : (
        <Ionicons name="images-outline" size={24} color="#fff" />
      )}
      {pending > 0 && (
        <View style={[styles.pendingBadge, !online && styles.pendingOffline]}>
          <Ionicons name={online ? 'cloud-upload' : 'cloud-offline'} size={10} color="#fff" />
          <Text style={styles.pendingText}>{pending}</Text>
        </View>
      )}
    </Pressable>
  );

  const flipButton = (
    <Pressable
      onPress={flip}
      disabled={recording}
      accessibilityRole="button"
      accessibilityLabel="Switch camera"
      style={[styles.flip, recording && { opacity: 0.3 }]}
    >
      <Ionicons name="camera-reverse-outline" size={28} color="#fff" />
    </Pressable>
  );

  const modeSwitch = (
    <View style={[styles.modes, landscape && styles.modesVertical]}>
      {(['video', 'picture'] as const).map((m) => (
        <Pressable
          key={m}
          disabled={recording}
          onPress={() => changeMode(m)}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === m }}
          hitSlop={8}
        >
          <Text style={[styles.modeText, mode === m && styles.modeActive]}>{m === 'picture' ? 'PHOTO' : 'VIDEO'}</Text>
        </Pressable>
      ))}
    </View>
  );

  const toolButtons = (
    <>
      <IconButton
        icon={FLASH_ICON[flash]}
        active={flash !== 'off'}
        label={mode === 'video' ? (flash === 'on' ? 'TORCH' : 'OFF') : flash.toUpperCase()}
        onPress={cycleFlash}
        accessibilityLabel={`Flash ${flash}`}
      />
      <IconButton
        icon="grid-outline"
        active={showGrid}
        label="GRID"
        onPress={() => setShowGrid((g) => !g)}
        accessibilityLabel={showGrid ? 'Hide grid' : 'Show grid'}
      />
      {mode === 'picture' && (
        <IconButton
          icon="timer-outline"
          active={timer > 0}
          label={timer ? `${timer}s` : 'OFF'}
          onPress={cycleTimer}
          accessibilityLabel={`Timer ${timer ? `${timer} seconds` : 'off'}`}
        />
      )}
    </>
  );

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={gesture}>
        <View style={styles.fill} collapsable={false}>
          {showCamera && (
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              flash={mode === 'picture' ? flash : 'off'}
              enableTorch={torch}
              zoom={zoom}
              mode={mode}
              mute={muted}
              active={isFocused}
              mirror={facing === 'front'}
              onCameraReady={() => setReady(true)}
              onMountError={(e) => Alert.alert('Camera error', e.message)}
            />
          )}

          {showGrid && (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <View style={[styles.gridLine, { left: '33.33%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
              <View style={[styles.gridLine, { left: '66.66%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
              <View style={[styles.gridLine, { top: '33.33%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
              <View style={[styles.gridLine, { top: '66.66%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
            </View>
          )}

          {countdown !== null && (
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
              <Text style={styles.countdown}>{countdown}</Text>
            </View>
          )}

          {zoom > 0.01 && (
            <View pointerEvents="none" style={[styles.zoomBadge, landscape ? { bottom: 24 + insets.bottom } : { bottom: 200 + insets.bottom }]}>
              <Text style={styles.zoomText}>{(1 + zoom * 9).toFixed(1)}×</Text>
            </View>
          )}

          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.shutterFlash, { opacity: shutterOpacity }]} />
        </View>
      </GestureDetector>

      {/* Top / side toolbar */}
      <View
        style={[
          styles.toolbar,
          landscape
            ? { left: insets.left + 8, top: insets.top + 16, bottom: insets.bottom + 16, flexDirection: 'column' }
            : { top: insets.top + 8, left: 16, right: 16, flexDirection: 'row' },
        ]}
      >
        {recording ? (
          <View style={styles.recBadge}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>{formatDuration(elapsed)}</Text>
            <LiveUploadPill liveId={liveId} />
          </View>
        ) : (
          toolButtons
        )}
      </View>

      {/* Capture controls */}
      {landscape ? (
        <View style={[styles.sideControls, { right: insets.right + 16, top: insets.top + 16, bottom: insets.bottom + 16 }]}>
          {flipButton}
          {modeSwitch}
          {shutter}
          {thumbnail}
        </View>
      ) : (
        <View style={[styles.bottomControls, { bottom: insets.bottom + 12 }]}>
          {modeSwitch}
          <View style={styles.captureRow}>
            {thumbnail}
            {shutter}
            {flipButton}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },

  permTitle: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 16 },
  permBody: { color: '#A1A1A6', fontSize: 15, textAlign: 'center', marginTop: 8, maxWidth: 320 },
  permButton: { backgroundColor: '#F5F5F7', borderRadius: 980, paddingHorizontal: 28, paddingVertical: 14, marginTop: 24 },
  permButtonText: { color: '#000', fontWeight: '600', fontSize: 16 },
  permLink: { marginTop: 16, padding: 8 },
  permLinkText: { color: '#2997FF', fontSize: 15 },

  toolbar: {
    position: 'absolute',
    justifyContent: 'space-around',
    alignItems: 'center',
    ...glass,
    borderRadius: 24,
    padding: 4,
  },
  recBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, flexShrink: 1 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF3B30' },
  recText: { color: '#fff', fontSize: 16, fontFamily: font.monoMedium, fontVariant: ['tabular-nums'] },

  // The glass tray (design B), floating above the bottom edge.
  bottomControls: {
    position: 'absolute',
    left: 12,
    right: 12,
    ...glass,
    backgroundColor: 'rgba(18,18,20,0.62)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 34,
    paddingTop: 14,
    paddingBottom: 18,
  },
  captureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    marginTop: 16,
  },
  sideControls: {
    position: 'absolute',
    width: 96,
    alignItems: 'center',
    justifyContent: 'space-between',
    ...glass,
    backgroundColor: 'rgba(18,18,20,0.62)',
    borderRadius: 48,
    paddingVertical: 20,
  },

  modes: { flexDirection: 'row', justifyContent: 'center', gap: 24 },
  modesVertical: { flexDirection: 'column', gap: 12 },
  modeText: { color: '#A1A1A6', fontSize: 13, fontWeight: '600', letterSpacing: 0.8 },
  modeActive: { color: '#FACC15' },

  shutterOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff' },
  shutterVideo: { backgroundColor: '#FF3B30' },
  shutterRecording: { width: 28, height: 28, borderRadius: 6 },

  thumb: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  thumbImage: { width: '100%', height: '100%', borderRadius: 14 },
  pendingBadge: {
    position: 'absolute',
    top: -8,
    right: -10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#0071E3',
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1.5,
    borderColor: '#000',
  },
  pendingOffline: { backgroundColor: '#636366' },
  pendingText: { color: '#fff', fontSize: 10, fontFamily: font.monoSemibold },
  flip: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.5)' },
  countdown: { color: '#fff', fontSize: 120, fontFamily: font.mono },
  zoomBadge: {
    position: 'absolute',
    alignSelf: 'center',
    ...glass,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  zoomText: { color: '#F5F5F7', fontFamily: font.monoMedium },
  shutterFlash: { backgroundColor: '#000' },
});
