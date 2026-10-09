import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ComponentProps, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDate, formatDuration } from '@/lib/format';
import { providerInfo } from '@/lib/storage/providers';
import { useOriginal } from '@/lib/storage/useOriginal';
import { selectGallery, selectShared, useStore } from '@/lib/store';
import { viewUri } from '@/lib/types';
import { useStream } from '@/lib/useStream';

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
const SKIP_S = 10;
const HIDE_AFTER_MS = 3000;

// Player commands (the player object is mutable by design; keep writes out of render).
type Player = ReturnType<typeof useVideoPlayer>;
const seekTo = (p: Player, seconds: number) => {
  p.currentTime = seconds;
};
const setRate = (p: Player, rate: number) => {
  p.playbackRate = rate;
};
const setMuted = (p: Player, muted: boolean) => {
  p.muted = muted;
};

/**
 * Full-screen video player: our own controls (no overlap with the viewer's
 * action bar). Tap shows/hides the controls, double-tap left/right skips 10 s,
 * drag the bar to seek. Rotating the phone gives a landscape player.
 */
export default function PlayerScreen() {
  const { id, source: from } = useLocalSearchParams<{ id: string; source?: string }>();
  const items = useStore(from === 'shared' ? selectShared : selectGallery);
  const item = items.find((i) => i.id === id);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // Long cloud videos: adaptive streaming once converted; otherwise the original.
  const original = useOriginal(item);
  const stream = useStream(item, true);
  const source = stream.asking ? null : stream.url ? { uri: stream.url } : original;
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: player.bufferedPosition,
  });
  const { muted } = useEvent(player, 'mutedChange', { muted: player.muted });
  const { playbackRate } = useEvent(player, 'playbackRateChange', { playbackRate: player.playbackRate });
  const { videoTrack } = useEvent(player, 'videoTrackChange', { videoTrack: player.videoTrack });
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => setEnded(true));
    return () => sub.remove();
  }, [player]);

  const duration = player.duration || item?.duration || 0;

  // ---------- Controls visibility ----------
  // Always shown while paused/ended/scrubbing; while playing they hide after 3 s
  // without a touch (`activity` restarts the countdown).
  const [hidden, setHidden] = useState(false);
  const [activity, setActivity] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const controls = !hidden || !isPlaying || scrubbing != null;
  useEffect(() => {
    if (!isPlaying || scrubbing != null) return;
    const t = setTimeout(() => setHidden(true), HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, [isPlaying, scrubbing, activity]);
  const poke = useCallback(() => {
    setHidden(false);
    setActivity((a) => a + 1);
  }, []);

  // ---------- Actions ----------
  const [skipHint, setSkipHint] = useState<{ side: 'left' | 'right'; key: number } | null>(null);
  const togglePlay = () => {
    if (ended) {
      seekTo(player, 0);
      setEnded(false);
      player.play();
    } else if (isPlaying) player.pause();
    else player.play();
    poke();
  };
  const skip = (seconds: number) => {
    setEnded(false);
    player.seekBy(seconds);
    setSkipHint((prev) => ({ side: seconds < 0 ? 'left' : 'right', key: (prev?.key ?? 0) + 1 }));
    poke();
  };
  useEffect(() => {
    if (!skipHint) return;
    const t = setTimeout(() => setSkipHint(null), 600);
    return () => clearTimeout(t);
  }, [skipHint]);
  const cycleSpeed = () => {
    const i = SPEEDS.indexOf(playbackRate);
    setRate(player, SPEEDS[(i + 1) % SPEEDS.length] ?? 1);
    poke();
  };

  // Tap: show/hide controls. Double-tap on the left/right third: skip back/forward.
  const surface = Gesture.Exclusive(
    Gesture.Tap()
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd((e) => {
        if (e.x < width / 3) skip(-SKIP_S);
        else if (e.x > (width * 2) / 3) skip(SKIP_S);
        else togglePlay();
      }),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => (controls ? setHidden(true) : poke())),
  );

  // ---------- Scrubber ----------
  const [trackWidth, setTrackWidth] = useState(1);
  const fractionAt = (x: number) => Math.min(1, Math.max(0, x / trackWidth));
  const scrub = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .hitSlop({ top: 16, bottom: 16 })
    .onBegin((e) => setScrubbing(fractionAt(e.x) * duration))
    .onUpdate((e) => setScrubbing(fractionAt(e.x) * duration))
    .onFinalize((e) => {
      if (duration > 0) {
        seekTo(player, fractionAt(e.x) * duration);
        setEnded(false);
      }
      setScrubbing(null);
    });
  const shownTime = scrubbing ?? currentTime;
  const progress = duration > 0 ? Math.min(1, shownTime / duration) : 0;

  if (!item) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={styles.message}>This video is no longer here.</Text>
        <Pressable onPress={() => router.back()} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const loading = stream.asking || (!!source && status === 'loading');
  // Nothing to play on this phone (e.g. their own storage isn't signed in here).
  const unavailable = !source && !stream.asking
    ? item.location
      ? `The video is in your ${providerInfo(item.location.provider).name}. Sign in to it on this phone to play it.`
      : 'The video is still uploading from the other device'
    : null;
  const quality = videoTrack?.size?.height ? `${Math.min(videoTrack.size.width, videoTrack.size.height)}p` : null;

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={surface}>
        <View style={StyleSheet.absoluteFill}>
          {source ? (
            <VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls={false} />
          ) : (
            <Image source={{ uri: viewUri(item) }} style={{ width, height }} contentFit="contain" />
          )}
        </View>
      </GestureDetector>

      {skipHint && (
        <View pointerEvents="none" style={[styles.skipHint, skipHint.side === 'left' ? { left: 32 } : { right: 32 }]}>
          <Ionicons name={skipHint.side === 'left' ? 'play-back' : 'play-forward'} size={22} color="#fff" />
          <Text style={styles.skipText}>{SKIP_S} s</Text>
        </View>
      )}

      {loading && status !== 'error' && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator size="large" color="#fff" />
        </View>
      )}
      {(unavailable || (source && status === 'error')) && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          <Text style={styles.message}>{unavailable ?? 'This video can’t be played right now.'}</Text>
        </View>
      )}

      {controls && (
        <>
          <View style={[styles.top, { paddingTop: insets.top + 4, paddingLeft: insets.left + 8, paddingRight: insets.right + 8 }]}>
            <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconButton} accessibilityLabel="Close player">
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.title}>{formatDate(item.createdAt)}</Text>
              {stream.preparing && <Text style={styles.sub}>Preparing smooth playback for next time…</Text>}
            </View>
            <View style={styles.iconButton}>{quality && <Text style={styles.quality}>{quality}</Text>}</View>
          </View>

          {!loading && source && (
            <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.center]}>
              <View style={styles.centerRow}>
                <RoundButton icon="play-back" label={`Back ${SKIP_S} seconds`} onPress={() => skip(-SKIP_S)} />
                <RoundButton
                  big
                  icon={ended ? 'refresh' : isPlaying ? 'pause' : 'play'}
                  label={ended ? 'Replay' : isPlaying ? 'Pause' : 'Play'}
                  onPress={togglePlay}
                />
                <RoundButton icon="play-forward" label={`Forward ${SKIP_S} seconds`} onPress={() => skip(SKIP_S)} />
              </View>
            </View>
          )}

          <View style={[styles.bottom, { paddingBottom: insets.bottom + 12, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
            <View style={styles.timeRow}>
              <Text style={styles.time}>{formatDuration(shownTime)}</Text>
              <GestureDetector gesture={scrub}>
                <View
                  style={styles.track}
                  onLayout={(e: LayoutChangeEvent) => setTrackWidth(Math.max(1, e.nativeEvent.layout.width))}
                  accessibilityRole="adjustable"
                  accessibilityLabel="Seek"
                  accessibilityValue={{ min: 0, max: Math.round(duration), now: Math.round(shownTime) }}
                >
                  <View style={styles.trackBg}>
                    <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
                  </View>
                  <View style={[styles.thumb, scrubbing != null && styles.thumbActive, { left: `${progress * 100}%` }]} />
                </View>
              </GestureDetector>
              <Text style={styles.time}>{formatDuration(duration)}</Text>
            </View>
            <View style={styles.toolRow}>
              <Pressable
                onPress={() => {
                  setMuted(player, !muted);
                  poke();
                }}
                style={styles.tool}
                accessibilityLabel={muted ? 'Unmute' : 'Mute'}
              >
                <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color="#fff" />
              </Pressable>
              <Pressable onPress={cycleSpeed} style={styles.tool} accessibilityLabel={`Speed ${playbackRate}x`}>
                <Text style={styles.speed}>{playbackRate}×</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

function RoundButton({
  icon,
  label,
  onPress,
  big,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  big?: boolean;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[styles.round, big && styles.roundBig]} accessibilityLabel={label}>
      <Ionicons name={icon} size={big ? 38 : 24} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  message: { color: '#ccc', fontSize: 15, textAlign: 'center', paddingHorizontal: 24 },
  textButton: { marginTop: 16, paddingHorizontal: 16, paddingVertical: 10 },
  textButtonLabel: { color: '#FACC15', fontSize: 15, fontWeight: '600' },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  iconButton: { width: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sub: { color: '#aaa', fontSize: 12, marginTop: 2 },
  quality: {
    color: '#000',
    backgroundColor: '#fff',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 36 },
  round: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBig: { width: 76, height: 76, borderRadius: 38 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  time: { color: '#fff', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'center' },
  track: { flex: 1, height: 28, justifyContent: 'center' },
  trackBg: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: '#FACC15' },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: '#FACC15' },
  thumbActive: { width: 20, height: 20, borderRadius: 10, marginLeft: -10 },
  toolRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  tool: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  speed: { color: '#fff', fontSize: 15, fontWeight: '700' },
  skipHint: {
    position: 'absolute',
    top: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  skipText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
