import { Ionicons } from '@expo/vector-icons';
import { useEvent } from 'expo';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoSource, VideoView } from 'expo-video';
import { ComponentProps, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LensImaging } from '../../../modules/lens-camera';

import { compact, isNeutral, withoutTrim } from '@/lib/edits';
import { formatDate, formatDuration } from '@/lib/format';
import { font, glass, palette } from '@/lib/theme';
import { providerInfo } from '@/lib/storage/providers';
import type { MediaSource } from '@/lib/storage/types';
import { useOriginal } from '@/lib/storage/useOriginal';
import { saveEdit, selectGallery, selectShared, useStore } from '@/lib/store';
import { viewUri } from '@/lib/types';
import { useStream } from '@/lib/useStream';
import { takePreloaded } from '@/lib/video-prefetch';

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
const setUp = (p: Player) => {
  p.loop = false;
  p.timeUpdateEventInterval = 0.25;
  p.play();
};
/** Cloud files go through the player's disk cache (replays and preloaded starts are free). */
const withCaching = (source: MediaSource | null): VideoSource | null =>
  source ? { ...source, ...(source.uri.startsWith('http') ? { useCaching: true } : {}) } : null;

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

  // A player warmed up by intent preloading (finger on the tile, poster in the
  // viewer) already has the first seconds buffered: take it and play at once.
  const [preloaded] = useState(() => (id ? takePreloaded(id) : null));
  // Otherwise: long cloud videos stream once converted; else the original.
  const original = useOriginal(item, !preloaded);
  const stream = useStream(item, true);
  const source = preloaded || stream.asking ? null : stream.url ? { uri: stream.url, useCaching: true } : withCaching(original);
  const created = useVideoPlayer(source, setUp);
  const player = preloaded ?? created;
  const hasSource = !!preloaded || !!source;
  useEffect(() => {
    if (!preloaded) return;
    setUp(preloaded);
    return () => preloaded.release(); // it's ours now
  }, [preloaded]);

  // The look chosen when recording (or in the editor) is a recipe, not baked
  // into the file: play it live with the same GPU shader the thumbnail used.
  // Looks/colour only: a trim alone needs no shader.
  const colourOnly = withoutTrim(item?.edit);
  const edit = colourOnly && !isNeutral(colourOnly) ? colourOnly : null;
  const editKey = edit ? JSON.stringify(edit) : '';
  useEffect(() => {
    if (!edit || !LensImaging?.setVideoLook) return; // no look: leave the player alone
    LensImaging.setVideoLook(player, edit).catch(() => {});
  }, [player, editKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ---------- Trim (checklist 6.2): a removable edit; the original stays whole ----------
  const savedTrim = item?.edit?.trim;
  const trimStart = savedTrim?.start ?? 0;
  const trimEnd = savedTrim?.end ?? duration;
  // Trim editor: the range being chosen (null = not editing).
  const [trimming, setTrimming] = useState<{ start: number; end: number } | null>(null);
  // Start at the trim start once the video is ready.
  const [startedAt, setStartedAt] = useState<string | null>(null);
  if (status === 'readyToPlay' && startedAt !== item?.id && item) {
    setStartedAt(item.id);
    if (trimStart > 0) seekTo(player, trimStart);
  }
  // Stop at the trim end (not while editing the trim), from the player's own time events.
  const trimEndAt = savedTrim?.end;
  useEffect(() => {
    if (trimming || trimEndAt === undefined) return;
    const sub = player.addListener('timeUpdate', ({ currentTime: t }) => {
      if (t >= trimEndAt - 0.05 && player.playing) {
        player.pause();
        setEnded(true);
      }
    });
    return () => sub.remove();
  }, [player, trimEndAt, trimming]);
  const saveTrim = async () => {
    if (!item || !trimming) return;
    const full = trimming.start <= 0.05 && trimming.end >= duration - 0.05;
    const next = compact({ ...(item.edit ?? {}), trim: full ? undefined : { start: trimming.start, end: trimming.end >= duration - 0.05 ? undefined : trimming.end } });
    setTrimming(null);
    await saveEdit(item.id, next);
    seekTo(player, full ? 0 : trimming.start);
  };

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
      seekTo(player, trimming ? trimming.start : trimStart);
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
    .onBegin((e) => (trimming ? moveTrimHandle(e.x) : setScrubbing(fractionAt(e.x) * duration)))
    .onUpdate((e) => (trimming ? moveTrimHandle(e.x) : setScrubbing(fractionAt(e.x) * duration)))
    .onFinalize((e) => {
      if (trimming) return;
      if (duration > 0) {
        // Seeks stay inside the trimmed part.
        const t = Math.min(trimEnd, Math.max(trimStart, fractionAt(e.x) * duration));
        seekTo(player, t);
        setEnded(false);
      }
      setScrubbing(null);
    });
  /** Trim editor: the nearer handle follows the finger (≥ 0.5 s apart) and the frame there is shown. */
  const moveTrimHandle = (x: number) => {
    if (!trimming || duration <= 0) return;
    const t = fractionAt(x) * duration;
    const startSide = Math.abs(t - trimming.start) <= Math.abs(t - trimming.end);
    const next = startSide
      ? { start: Math.max(0, Math.min(t, trimming.end - 0.5)), end: trimming.end }
      : { start: trimming.start, end: Math.min(duration, Math.max(t, trimming.start + 0.5)) };
    setTrimming(next);
    player.pause();
    seekTo(player, startSide ? next.start : next.end);
  };
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

  const loading = (!preloaded && stream.asking) || (hasSource && status === 'loading');
  // Nothing to play on this phone (e.g. their own storage isn't signed in here).
  const unavailable = !hasSource && !stream.asking
    ? item.location
      ? `The video is in your ${providerInfo(item.location.provider).name}. Sign in to it on this phone to play it.`
      : 'The video is still uploading from the other device'
    : null;
  const quality = videoTrack?.size?.height ? `${Math.min(videoTrack.size.width, videoTrack.size.height)}p` : null;

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={surface}>
        <View style={StyleSheet.absoluteFill}>
          {hasSource ? (
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
      {(unavailable || (hasSource && status === 'error')) && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          <Text style={styles.message}>{unavailable ?? 'This video can’t be played right now.'}</Text>
        </View>
      )}

      {controls && (
        <>
          <View style={[styles.top, { paddingTop: insets.top + 8, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]} pointerEvents="box-none">
            <Pressable onPress={() => router.back()} hitSlop={6} style={styles.glassCircle} accessibilityLabel="Close player">
              <Ionicons name="chevron-back" size={24} color={palette.text} />
            </Pressable>
            <View style={styles.infoPill}>
              <Text style={styles.title} numberOfLines={1}>{formatDate(item.createdAt)}</Text>
              {stream.preparing && <Text style={styles.sub} numberOfLines={1}>Preparing smooth playback for next time…</Text>}
            </View>
            {quality && (
              <View style={styles.qualityPill}>
                <Text style={styles.quality}>{quality}</Text>
              </View>
            )}
          </View>

          {!loading && hasSource && (
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

          <View style={[styles.bottom, { bottom: insets.bottom + 16, left: insets.left + 16, right: insets.right + 16 }]}>
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
                    {!trimming && <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />}
                    {trimming && duration > 0 && (
                      // Kept part in yellow; the cut-off ends stay dim.
                      <View style={[styles.trimRange, { left: `${(trimming.start / duration) * 100}%`, width: `${((trimming.end - trimming.start) / duration) * 100}%` }]} />
                    )}
                  </View>
                  {trimming && duration > 0 ? (
                    <>
                      <View style={[styles.trimHandle, { left: `${(trimming.start / duration) * 100}%` }]} />
                      <View style={[styles.trimHandle, { left: `${(trimming.end / duration) * 100}%` }]} />
                    </>
                  ) : (
                    <View style={[styles.thumb, scrubbing != null && styles.thumbActive, { left: `${progress * 100}%` }]} />
                  )}
                </View>
              </GestureDetector>
              <Text style={styles.time}>{formatDuration(duration)}</Text>
            </View>
            {trimming ? (
              <View style={styles.toolRow}>
                <Pressable onPress={() => setTrimming(null)} style={styles.tool} accessibilityLabel="Cancel trim">
                  <Text style={styles.trimText}>Cancel</Text>
                </Pressable>
                <Text style={styles.trimInfo}>{formatDuration(trimming.end - trimming.start)}</Text>
                <Pressable onPress={() => void saveTrim()} style={styles.tool} accessibilityLabel="Save trim">
                  <Text style={[styles.trimText, { color: palette.accent }]}>Save</Text>
                </Pressable>
              </View>
            ) : (
            <View style={styles.toolRow}>
              <Pressable
                onPress={() => {
                  setMuted(player, !muted);
                  poke();
                }}
                style={styles.tool}
                accessibilityLabel={muted ? 'Unmute' : 'Mute'}
              >
                <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={22} color={palette.text} />
              </Pressable>
              {from !== 'shared' && hasSource && (
                <Pressable
                  onPress={() => {
                    setTrimming({ start: trimStart, end: savedTrim?.end ?? duration });
                    player.pause();
                    poke();
                  }}
                  style={styles.tool}
                  accessibilityLabel="Trim"
                >
                  <Ionicons name="cut-outline" size={22} color={savedTrim ? palette.accent : palette.text} />
                </Pressable>
              )}
              <Pressable onPress={cycleSpeed} style={styles.tool} accessibilityLabel={`Speed ${playbackRate}x`}>
                <Text style={styles.speed}>{playbackRate}×</Text>
              </Pressable>
            </View>
            )}
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
  message: { color: '#E8E8ED', fontSize: 15, textAlign: 'center', paddingHorizontal: 24 },
  textButton: { marginTop: 16, paddingHorizontal: 16, paddingVertical: 10 },
  textButtonLabel: { color: palette.link, fontSize: 15, fontWeight: '600' },
  // Design B: glass controls over the video.
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  glassCircle: { ...glass, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  infoPill: { ...glass, flexShrink: 1, minHeight: 48, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 24, justifyContent: 'center' },
  title: { color: palette.text, fontSize: 14, fontWeight: '600' },
  sub: { color: '#C8C8CC', fontSize: 11, marginTop: 1 },
  // Same glass and height as the back button and date pill beside it.
  qualityPill: { ...glass, marginLeft: 'auto', height: 48, paddingHorizontal: 14, borderRadius: 24, justifyContent: 'center' },
  quality: { color: palette.text, fontSize: 12, fontFamily: font.monoSemibold },
  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 36 },
  round: {
    ...glass,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBig: { width: 76, height: 76, borderRadius: 38 },
  bottom: {
    ...glass,
    backgroundColor: 'rgba(18,18,20,0.62)',
    borderColor: 'rgba(255,255,255,0.12)',
    position: 'absolute',
    borderRadius: 28,
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 14,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  time: { color: palette.text, fontSize: 12, fontFamily: font.monoMedium, fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'center' },
  track: { flex: 1, height: 28, justifyContent: 'center' },
  trackBg: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: palette.text },
  thumb: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: palette.text },
  thumbActive: { width: 20, height: 20, borderRadius: 10, marginLeft: -10 },
  toolRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  trimRange: { position: 'absolute', top: 0, bottom: 0, backgroundColor: palette.accent },
  trimHandle: { position: 'absolute', width: 10, height: 24, borderRadius: 3, marginLeft: -5, backgroundColor: palette.accent },
  trimText: { color: palette.text, fontSize: 15, fontFamily: font.semibold },
  trimInfo: { color: palette.muted, fontSize: 13, fontFamily: font.mono },
  tool: { minWidth: 48, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  speed: { color: palette.text, fontSize: 14, fontFamily: font.monoSemibold },
  skipHint: {
    ...glass,
    position: 'absolute',
    top: '45%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  skipText: { color: palette.text, fontSize: 14, fontFamily: font.monoSemibold },
});
