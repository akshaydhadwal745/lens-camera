import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router, useLocalSearchParams } from 'expo-router';
import { ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ZoomableImage } from '@/components/ZoomableImage';

import { isImagingAvailable } from '../../../modules/lens-camera';
import { saveLabel, saveToDevice, shareMedia } from '@/lib/actions';
import { formatBytes, formatDate, formatDuration, formatEta, formatRate } from '@/lib/format';
import { hasEdit, useFullQuality, useMotionVideo, webCanShowOriginal } from '@/lib/full-view';
import { confirmAndDelete } from '@/lib/delete-flow';
import { providerInfo } from '@/lib/storage/providers';
import { refreshShared, removeSharedItem, saveEdit, selectGallery, selectShared, useStore } from '@/lib/store';
import { compact } from '@/lib/edits';
import { GalleryItem, viewUri } from '@/lib/types';
import { keepOnly, prefetchVideo } from '@/lib/video-prefetch';
import { font, glass, palette } from '@/lib/theme';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

const isWeb = Platform.OS === 'web';

/** Plays a motion photo's clip once over the photo, then gets out of the way. */
function MotionPlayer({ uri, onEnd }: { uri: string; onEnd: () => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.muted = true;
    p.play();
  });
  useEffect(() => {
    const sub = player.addListener('playToEnd', onEnd);
    return () => sub.remove();
  }, [player, onEnd]);
  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={onEnd} accessibilityLabel="Stop motion">
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
    </Pressable>
  );
}

function PhotoPage({
  item,
  width,
  height,
  onTap,
  loadOriginal,
  onZoom,
}: {
  item: GalleryItem;
  width: number;
  height: number;
  onTap: () => void;
  /** Full quality is allowed now (Wi-Fi, this phone's own file, or the user asked: HD / zoom). */
  loadOriginal: boolean;
  onZoom: (zoomed: boolean) => void;
}) {
  // The preview shows instantly. Full quality replaces it when allowed: the
  // original, or for an edited photo the original rendered with its edit.
  // (A photo with an edit never shows the unedited original.)
  const edited = hasEdit(item);
  const preview = edited ? (item.previewUri ?? item.thumbUri) : viewUri(item);
  const full = useFullQuality(item, loadOriginal || (!!item.localUri && !isWeb));
  return (
    <ZoomableImage
      source={full ?? (preview ? { uri: preview } : undefined)}
      placeholder={full && preview ? { uri: preview } : undefined}
      width={width}
      height={height}
      onTap={onTap}
      onZoomChange={onZoom}
    />
  );
}

/**
 * A video in the swipe viewer: poster + play button. Playing happens on its own
 * full-screen page (`/player/[id]`), so the player's controls never collide
 * with the viewer's action bar.
 */
function VideoPage({
  item,
  width,
  height,
  source,
  onTap,
}: {
  item: GalleryItem;
  width: number;
  height: number;
  source?: string;
  onTap: () => void;
}) {
  // Playable: on this phone, in Lens storage, or in our own connected storage.
  const playable = !!item.localUri || !!item.remoteUrl || (!!item.location && !item.ownerName);
  const open = () => router.push({ pathname: '/player/[id]', params: { id: item.id, ...(source ? { source } : {}) } });
  return (
    <Pressable style={{ width, height, justifyContent: 'center' }} onPress={onTap} accessibilityLabel="Show or hide controls">
      <Image source={{ uri: viewUri(item) }} style={{ width, height: height * 0.8 }} contentFit="contain" />
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.center]}>
        {playable ? (
          <Pressable onPress={open} style={styles.playButton} accessibilityLabel="Play video" hitSlop={12}>
            <Ionicons name="play" size={36} color={palette.text} style={{ marginLeft: 4 }} />
          </Pressable>
        ) : (
          <Text style={styles.pendingVideo}>
            {item.location
              ? 'The full video is in the sender’s own storage'
              : 'The video is still uploading from the other device'}
          </Text>
        )}
        {playable && item.duration != null && <Text style={styles.videoLength}>{formatDuration(item.duration)}</Text>}
      </View>
    </Pressable>
  );
}

function SyncLine({ item }: { item: GalleryItem }) {
  const transfer = useStore((s) => s.transfers[item.id]);
  if (item.ownerName) return <Text style={styles.sub}>From {item.ownerName}</Text>;
  if (item.sync === 'uploading' && transfer) {
    const pct = transfer.total ? Math.round((transfer.sent / transfer.total) * 100) : 0;
    const extra = [transfer.rate > 0 ? formatRate(transfer.rate) : '', transfer.recording ? 'recording' : formatEta(transfer.total - transfer.sent, transfer.rate)]
      .filter(Boolean)
      .join(' · ');
    return (
      <View style={styles.transfer}>
        <Text style={styles.sub}>
          On phone {formatBytes(transfer.total)} · in cloud {formatBytes(transfer.sent)} ({pct}%)
        </Text>
        <View style={styles.transferTrack}>
          <View style={[styles.transferFill, { width: `${pct}%` }]} />
        </View>
        {!!extra && <Text style={styles.sub}>{extra}</Text>}
      </View>
    );
  }
  return <Text style={[styles.sub, item.sync === 'failed' && { color: colors.danger }]} numberOfLines={2}>{whereText(item)}</Text>;
}

/** Where this item lives right now, in words. */
function whereText(item: GalleryItem): string {
  return item.sync === 'synced'
      ? item.location
        ? `In your ${providerInfo(item.location.provider).name}${item.localUri ? ' · on this device' : ''}`
        : item.localUri
        ? '✓ Safe in the cloud · also on this device'
        : item.offloadReason === 'space'
          ? 'In the cloud · removed from phone to free space'
          : item.offloadReason === 'age'
            ? 'In the cloud · removed from phone after the keep period'
            : item.previewUri?.startsWith('file:')
              ? '✓ Safe in the cloud · preview on this device'
              : 'In the cloud'
      : item.sync === 'uploading'
        ? 'Uploading…'
        : item.sync === 'partial'
          ? item.localUri
            ? 'Preview in the cloud · original waiting to upload'
            : 'Preview · full-quality original still uploading'
        : item.sync === 'failed'
          ? `Upload failed: ${item.error ?? 'unknown error'}`
          : 'Waiting to upload';
}

/** "12 MP · 3.1 MB" / "4K · 0:48 · 180 MB" for the info pill. */
function metaText(item: GalleryItem): string {
  const parts: string[] = [];
  const long = Math.max(item.width ?? 0, item.height ?? 0);
  if (item.kind === 'photo' && item.width && item.height) parts.push(`${Math.max(1, Math.round((item.width * item.height) / 1e6))} MP`);
  if (item.kind === 'video' && long) parts.push(long >= 3840 ? '4K' : long >= 1920 ? 'HD' : `${Math.min(item.width ?? 0, item.height ?? 0)}p`);
  if (item.kind === 'video' && item.duration != null) parts.push(formatDuration(item.duration));
  if (item.size) parts.push(formatBytes(item.size));
  return parts.join(' · ');
}

/** An icon in the glass action bar (its label is for screen readers). */
function Action({
  icon,
  label,
  onPress,
  disabled,
  color = palette.text,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.action, pressed && { backgroundColor: 'rgba(255,255,255,0.1)' }, disabled && { opacity: 0.35 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={23} color={color} />
    </Pressable>
  );
}

/**
 * Opened straight from a link, a refresh or a new tab (web), the roll may not be
 * loaded yet: wait for the item, then show the viewer (it positions itself on
 * its first render). Never navigate before the app's navigator exists, which
 * blanked the page ("Attempted to navigate before mounting the Root Layout").
 */
export default function ViewerScreen() {
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const shared = source === 'shared';
  const insets = useSafeAreaInsets();
  const items = useStore(shared ? selectShared : selectGallery);
  const found = items.some((i) => i.id === id);
  const booting = useStore((s) => s.status === 'booting');
  const remoteFetched = useStore((s) => s.remoteFetchedAt > 0);
  // The Shared list is only fetched on demand: fetch it if this item isn't there yet.
  const [sharedChecked, setSharedChecked] = useState(!shared);
  useEffect(() => {
    if (!shared || found) return;
    let live = true;
    refreshShared()
      .catch(() => {})
      .finally(() => live && setSharedChecked(true));
    return () => {
      live = false;
    };
  }, [shared]); // eslint-disable-line react-hooks/exhaustive-deps
  if (found) return <ViewerBody id={id} shared={shared} />;
  const loading = booting || (shared ? !sharedChecked : !remoteFetched);
  return (
    <View style={[styles.fill, styles.missing, { paddingTop: insets.top + 12 }]}>
      {loading ? (
        <ActivityIndicator color={palette.text} />
      ) : (
        <>
          <Text style={styles.missingTitle}>This item isn’t here</Text>
          <Text style={styles.missingText}>It may have been deleted, or it was shared with another account.</Text>
          <Pressable
            style={styles.missingButton}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/gallery'))}
            accessibilityRole="button"
          >
            <Text style={styles.missingButtonText}>Go to the roll</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function ViewerBody({ id, shared }: { id: string; shared: boolean }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const items = useStore(shared ? selectShared : selectGallery);

  const initialIndex = useMemo(() => Math.max(0, items.findIndex((i) => i.id === id)), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [index, setIndex] = useState(initialIndex);
  const [chrome, setChrome] = useState(true);
  const cellular = useStore((s) => s.cellular);
  // Full quality: automatically on Wi-Fi; on mobile data when the user taps HD
  // or zooms in (a slow connection keeps the preview until it arrives). The web
  // shows originals browsers can draw (JPEG/PNG…); HEIC/RAW stay previews there.
  const [hd, setHd] = useState<Set<string>>(new Set());
  const [zoomed, setZoomed] = useState(false);
  const loadOriginalFor = (item: GalleryItem) =>
    (isWeb ? webCanShowOriginal(item) : true) && (!cellular || hd.has(item.id));
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<GalleryItem>>(null);

  const current = items[Math.min(index, items.length - 1)];
  const motion = useMotionVideo(current);
  const [playingMotion, setPlayingMotion] = useState<string | null>(null);
  const stopMotion = useCallback(() => setPlayingMotion(null), []);

  // Intent preloading: a video's poster on screen means ▶ is likely next;
  // its neighbours are a swipe away (those only on Wi-Fi, see video-prefetch).
  const prev = items[index - 1];
  const next = items[index + 1];
  useEffect(() => {
    keepOnly([current?.id, prev?.id, next?.id].filter((x): x is string => !!x));
    prefetchVideo(current, 'high');
    prefetchVideo(next, 'low');
    prefetchVideo(prev, 'low');
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everything here was deleted (e.g. the last item): leave. Opened from a link there's no history: the roll.
  useEffect(() => {
    if (items.length === 0) {
      if (router.canGoBack()) router.back();
      else router.replace('/gallery');
    }
  }, [items.length]);

  // Keep the current page aligned after rotation (width change).
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: index * width, animated: false });
  }, [width]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < items.length) setIndex(next);
  };

  const go = (delta: number) => {
    const next = Math.min(items.length - 1, Math.max(0, index + delta));
    listRef.current?.scrollToOffset({ offset: next * width, animated: true });
    setIndex(next);
  };

  useEffect(() => {
    if (!isWeb) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'Escape') router.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const run = async (action: () => Promise<void>, success?: string) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await action();
      if (success) notify(success);
    } catch (error) {
      notify('Something went wrong', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () =>
    run(async () => {
      const deletingLast = index >= items.length - 1;
      if (shared) {
        if (!(await confirmDestructive('Remove from Shared?', 'Only removes it from your list.', 'Remove'))) return;
        await removeSharedItem(current);
      } else if (!(await confirmAndDelete([current.id]))) {
        return;
      }
      if (deletingLast) setIndex((i) => Math.max(0, i - 1));
    });

  if (!current) return <View style={styles.fill} />;
  const safe = current.sync === 'synced' && !current.ownerName;
  const meta = metaText(current);

  return (
    <View style={styles.fill}>
      <FlatList
        ref={listRef}
        key={width}
        data={items}
        keyExtractor={(item) => `${item.ownerId ?? 'me'}-${item.id}`}
        horizontal
        pagingEnabled
        scrollEnabled={!zoomed}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={Math.min(index, items.length - 1)}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onScroll={onScroll}
        scrollEventThrottle={32}
        windowSize={3}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        renderItem={({ item, index: i }) =>
          item.kind === 'photo' ? (
            <PhotoPage
              item={item}
              width={width}
              height={height}
              onTap={() => setChrome((c) => !c)}
              loadOriginal={loadOriginalFor(item)}
              onZoom={(z) => {
                setZoomed(z);
                // Zooming in means the detail matters: fetch full quality.
                if (z) setHd((prev) => (prev.has(item.id) ? prev : new Set(prev).add(item.id)));
              }}
            />
          ) : (
            <VideoPage item={item} width={width} height={height} source={shared ? 'shared' : 'mine'} onTap={() => setChrome((c) => !c)} />
          )
        }
      />

      {playingMotion && playingMotion === motion && <MotionPlayer uri={playingMotion} onEnd={stopMotion} />}

      {chrome && (
        <>
          {/* Design B: glass controls float over the photo. */}
          <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <Pressable onPress={() => router.back()} hitSlop={6} accessibilityLabel="Back to the roll" style={styles.glassCircle}>
              <Ionicons name="chevron-back" size={24} color={palette.text} />
            </Pressable>
            <View style={styles.infoPill}>
              <Text style={styles.date} numberOfLines={1}>
                {formatDate(current.createdAt)}
              </Text>
              {safe && meta ? <Text style={styles.sub} numberOfLines={1}>{meta}</Text> : <SyncLine item={current} />}
            </View>
            <View style={styles.topRight}>
              {motion && (
                // Motion photo: play the moments around the shot.
                <Pressable onPress={() => setPlayingMotion(motion)} style={styles.hdPill} accessibilityLabel="Play motion">
                  <Text style={styles.hd}>▶ MOTION</Text>
                </Pressable>
              )}
              {!shared && current.edit?.burst && current.edit.burst.count > 1 && (
                // Smart burst: where this shot sits; a non-pick can become the one the roll shows.
                <Pressable
                  onPress={() => {
                    if (current.edit?.burst?.pick) return;
                    const id = current.edit!.burst!.id;
                    const old = items.find((i) => i.edit?.burst?.id === id && i.edit.burst.pick);
                    void saveEdit(current.id, compact({ ...current.edit, burst: { ...current.edit!.burst!, pick: true } }));
                    if (old) void saveEdit(old.id, compact({ ...old.edit, burst: { ...old.edit!.burst!, pick: false } }));
                    notify('Burst', 'This shot now shows in your roll.');
                  }}
                  style={styles.hdPill}
                  accessibilityLabel={current.edit.burst.pick ? 'Burst: the pick' : 'Burst: make this the pick'}
                >
                  <Text style={styles.hd}>
                    {current.edit.burst.pick ? '⧉ PICK' : '⧉ MAKE PICK'} · {items.filter((i) => i.edit?.burst?.id === current.edit!.burst!.id).length}
                  </Text>
                </Pressable>
              )}
              {current.kind === 'photo' && !current.localUri && (current.remoteUrl || current.location) && !loadOriginalFor(current) && !(isWeb && !webCanShowOriginal(current)) ? (
                <Pressable onPress={() => setHd((prev) => new Set(prev).add(current.id))} style={styles.hdPill} accessibilityLabel="Load full quality">
                  <Text style={styles.hd}>HD</Text>
                </Pressable>
              ) : null}
              {safe ? (
                <Pressable onPress={() => notify('Safe', whereText(current))} style={styles.safePill} accessibilityLabel={`Safe. ${whereText(current)}`}>
                  <Ionicons name="checkmark" size={14} color={palette.safe} />
                  <Text style={styles.safeText}>Safe</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <View style={[styles.bottomBar, { bottom: insets.bottom + 16 }]}>
            <Action icon="share-outline" label="Share" disabled={busy} onPress={() => run(() => shareMedia(current))} />
            {!shared && (
              <Action
                icon="paper-plane-outline"
                label="Send to friends"
                disabled={current.sync !== 'synced'}
                onPress={() => router.push({ pathname: '/share', params: { ids: current.id } })}
              />
            )}
            {!shared && isImagingAvailable && (
              <Pressable
                onPress={() => router.push({ pathname: '/edit/[id]', params: { id: current.id } })}
                style={({ pressed }) => [styles.editPill, pressed && { opacity: 0.85 }]}
                accessibilityRole="button"
                accessibilityLabel="Edit"
              >
                <Ionicons name="color-wand-outline" size={18} color="#000" />
                <Text style={styles.editText}>Edit</Text>
              </Pressable>
            )}
            <Action
              icon="download-outline"
              label={saveLabel}
              disabled={busy}
              onPress={() => run(() => saveToDevice(current), isWeb ? undefined : 'Saved to Photos')}
            />
            <Action icon="trash-outline" label={shared ? 'Remove' : 'Delete'} disabled={busy} onPress={onDelete} />
          </View>

          {isWeb && width > 700 && (
            <>
              {index > 0 && (
                <Pressable onPress={() => go(-1)} style={[styles.navArrow, { left: 16 }]} accessibilityLabel="Previous">
                  <Ionicons name="chevron-back" size={32} color="#fff" />
                </Pressable>
              )}
              {index < items.length - 1 && (
                <Pressable onPress={() => go(1)} style={[styles.navArrow, { right: 16 }]} accessibilityLabel="Next">
                  <Ionicons name="chevron-forward" size={32} color="#fff" />
                </Pressable>
              )}
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  missing: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  missingTitle: { color: palette.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
  missingText: { color: '#86868B', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  missingButton: { marginTop: 12, minHeight: 44, paddingHorizontal: 22, borderRadius: 980, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center' },
  missingButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  glassCircle: { ...glass, width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  infoPill: { ...glass, flexShrink: 1, minHeight: 48, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 24, justifyContent: 'center' },
  topRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  safePill: { ...glass, flexDirection: 'row', alignItems: 'center', gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 16 },
  safeText: { color: palette.text, fontSize: 12, fontWeight: '600' },
  hdPill: { height: 32, paddingHorizontal: 10, borderRadius: 16, backgroundColor: palette.accent, justifyContent: 'center' },
  hd: { color: '#000', fontFamily: font.monoSemibold, fontSize: 12 },
  pendingVideo: { color: palette.soft, textAlign: 'center', marginTop: 12, fontSize: 13, paddingHorizontal: 24 },
  center: { alignItems: 'center', justifyContent: 'center' },
  playButton: {
    ...glass,
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoLength: { color: palette.text, fontSize: 12, fontFamily: font.monoMedium, marginTop: 10, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 },
  date: { color: palette.text, fontSize: 14, fontWeight: '600' },
  sub: { color: '#C8C8CC', fontSize: 11, marginTop: 1 },
  transfer: { alignSelf: 'stretch' },
  transferTrack: { alignSelf: 'stretch', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 4, overflow: 'hidden' },
  transferFill: { height: '100%', backgroundColor: palette.link },
  bottomBar: {
    ...glass,
    backgroundColor: 'rgba(18,18,20,0.62)',
    borderColor: 'rgba(255,255,255,0.12)',
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    // Edit sits in the middle with two actions on each side, evenly spaced.
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 32,
  },
  action: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  editPill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 52, paddingHorizontal: 22, borderRadius: 26, backgroundColor: palette.text },
  editText: { color: '#000', fontSize: 15, fontWeight: '600' },
  navArrow: {
    ...glass,
    position: 'absolute',
    top: '50%',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
