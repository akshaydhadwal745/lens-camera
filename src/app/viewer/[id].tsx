import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ZoomableImage } from '@/components/ZoomableImage';

import { isImagingAvailable } from '../../../modules/lens-camera';
import { saveLabel, saveToDevice, shareMedia } from '@/lib/actions';
import { formatBytes, formatDate, formatDuration, formatEta, formatRate } from '@/lib/format';
import { hasEdit, useFullQuality, webCanShowOriginal } from '@/lib/full-view';
import { confirmAndDelete } from '@/lib/delete-flow';
import { providerInfo } from '@/lib/storage/providers';
import { removeSharedItem, selectGallery, selectShared, useStore } from '@/lib/store';
import { GalleryItem, viewUri } from '@/lib/types';
import { keepOnly, prefetchVideo } from '@/lib/video-prefetch';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

const isWeb = Platform.OS === 'web';

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
            <Ionicons name="play" size={40} color="#fff" style={{ marginLeft: 4 }} />
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
  const where =
    item.sync === 'synced'
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
  return <Text style={[styles.sub, item.sync === 'failed' && { color: colors.danger }]}>{where}</Text>;
}

function Action({
  icon,
  label,
  onPress,
  disabled,
  color = '#fff',
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.action, disabled && { opacity: 0.35 }]} accessibilityLabel={label}>
      <Ionicons name={icon} size={24} color={color} />
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export default function ViewerScreen() {
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const shared = source === 'shared';
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

  useEffect(() => {
    if (items.length === 0) router.back();
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
            <VideoPage item={item} width={width} height={height} source={source} onTap={() => setChrome((c) => !c)} />
          )
        }
      />

      {chrome && (
        <>
          <View style={[styles.topBar, { paddingTop: insets.top + 4 }]}>
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Close" style={styles.barButton}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </Pressable>
            <View style={{ alignItems: 'center', flex: 1 }}>
              <Text style={styles.date}>{formatDate(current.createdAt)}</Text>
              <SyncLine item={current} />
            </View>
            {current.kind === 'photo' && !current.localUri && (current.remoteUrl || current.location) && !loadOriginalFor(current) && !(isWeb && !webCanShowOriginal(current)) ? (
              <Pressable
                onPress={() => setHd((prev) => new Set(prev).add(current.id))}
                style={styles.barButton}
                accessibilityLabel="Load full quality"
              >
                <Text style={styles.hd}>HD</Text>
              </Pressable>
            ) : (
              <Text style={[styles.sub, styles.barButton, { textAlign: 'center' }]}>
                {index + 1}/{items.length}
              </Text>
            )}
          </View>

          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 8 }]}>
            {!shared && isImagingAvailable && (
              <Action
                icon="color-wand-outline"
                label="Edit"
                onPress={() => router.push({ pathname: '/edit/[id]', params: { id: current.id } })}
              />
            )}
            {!shared && (
              <Action
                icon="paper-plane-outline"
                label="Send"
                disabled={current.sync !== 'synced'}
                onPress={() => router.push({ pathname: '/share', params: { ids: current.id } })}
              />
            )}
            <Action icon="share-outline" label="Share" disabled={busy} onPress={() => run(() => shareMedia(current))} />
            <Action
              icon="download-outline"
              label={saveLabel}
              disabled={busy}
              onPress={() => run(() => saveToDevice(current), isWeb ? undefined : 'Saved to Photos')}
            />
            <Action icon="trash-outline" label={shared ? 'Remove' : 'Delete'} color={colors.danger} disabled={busy} onPress={onDelete} />
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
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  barButton: { width: 56, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  hd: {
    color: '#000',
    backgroundColor: '#FACC15',
    fontWeight: '800',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  pendingVideo: { color: '#ccc', textAlign: 'center', marginTop: 12, fontSize: 13, paddingHorizontal: 24 },
  center: { alignItems: 'center', justifyContent: 'center' },
  playButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoLength: { color: '#fff', fontSize: 13, fontWeight: '600', marginTop: 10, textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 },
  date: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sub: { color: '#aaa', fontSize: 12, marginTop: 2 },
  transfer: { alignSelf: 'stretch', alignItems: 'center' },
  transferTrack: { alignSelf: 'stretch', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginTop: 4, overflow: 'hidden' },
  transferFill: { height: '100%', backgroundColor: '#3B82F6' },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  action: { alignItems: 'center', minWidth: 64, minHeight: 44, justifyContent: 'center' },
  actionText: { fontSize: 12, marginTop: 4 },
  navArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
