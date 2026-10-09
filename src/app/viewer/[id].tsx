import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isImagingAvailable } from '../../../modules/lens-camera';
import { saveLabel, saveToDevice, shareMedia } from '@/lib/actions';
import { formatDate } from '@/lib/format';
import { confirmAndDelete } from '@/lib/delete-flow';
import { providerInfo } from '@/lib/storage/providers';
import { useOriginal } from '@/lib/storage/useOriginal';
import { useStream } from '@/lib/useStream';
import { removeSharedItem, selectGallery, selectShared, useStore } from '@/lib/store';
import { GalleryItem, viewUri } from '@/lib/types';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

const isWeb = Platform.OS === 'web';

function PhotoPage({
  item,
  width,
  height,
  onTap,
  loadOriginal,
}: {
  item: GalleryItem;
  width: number;
  height: number;
  onTap: () => void;
  /** Fetch the full-quality cloud original (Wi-Fi, or the user tapped HD). */
  loadOriginal: boolean;
}) {
  // Show the preview instantly; swap in the original when allowed. A local
  // original (this device) is always used as-is.
  const preview = viewUri(item);
  // Lens URL or the user's own storage (with auth headers).
  const original = useOriginal(item, !item.localUri && loadOriginal);
  const showOriginal = !item.localUri && loadOriginal && original ? original : null;
  // iOS ScrollView supports native pinch-to-zoom.
  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={{ width, height }}
      maximumZoomScale={4}
      minimumZoomScale={1}
      centerContent
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      bouncesZoom
    >
      <Pressable onPress={onTap} style={{ width, height }}>
        <Image
          source={showOriginal ?? { uri: preview }}
          placeholder={showOriginal && preview ? { uri: preview } : undefined}
          placeholderContentFit="contain"
          style={{ width, height }}
          contentFit="contain"
          cachePolicy="memory-disk"
          transition={200}
        />
      </Pressable>
    </ScrollView>
  );
}

function VideoPage({ item, width, height, active }: { item: GalleryItem; width: number; height: number; active: boolean }) {
  const original = useOriginal(item);
  // Long videos from the cloud: adaptive 540p/1080p streaming once converted.
  const stream = useStream(item, active);
  const source = stream.asking ? null : stream.url ? { uri: stream.url } : original;
  const player = useVideoPlayer(source, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);

  if (!source && stream.asking) {
    return (
      <View style={{ width, height, justifyContent: 'center' }}>
        <Image source={{ uri: viewUri(item) }} style={{ width, height: height * 0.8 }} contentFit="contain" />
        <ActivityIndicator color="#fff" style={StyleSheet.absoluteFill} />
      </View>
    );
  }

  if (!source) {
    // Only the poster frame is in the cloud so far.
    return (
      <View style={{ width, height, justifyContent: 'center' }}>
        <Image source={{ uri: viewUri(item) }} style={{ width, height: height * 0.8 }} contentFit="contain" />
        <Text style={styles.pendingVideo}>
          {item.location
            ? item.ownerName
              ? 'The full video is in the sender’s own storage'
              : `The video is in your ${providerInfo(item.location.provider).name}. Sign in to it on this phone to play it.`
            : 'The video is still uploading from the other device'}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ width, height, justifyContent: 'center' }}>
      <VideoView player={player} style={{ width, height: height * 0.8 }} contentFit="contain" nativeControls />
      {stream.preparing && <Text style={styles.pendingVideo}>Preparing smooth playback for next time…</Text>}
    </View>
  );
}

function SyncLine({ item }: { item: GalleryItem }) {
  const progress = useStore((s) => (s.uploadingId === item.id ? s.progress : null));
  if (item.ownerName) return <Text style={styles.sub}>From {item.ownerName}</Text>;
  const where =
    item.sync === 'synced'
      ? item.location
        ? `In your ${providerInfo(item.location.provider).name}${item.localUri ? ' · on this device' : ''}`
        : item.localUri
        ? 'In the cloud · on this device'
        : item.previewUri?.startsWith('file:')
          ? 'In the cloud · preview on this device'
          : 'In the cloud'
      : item.sync === 'uploading'
        ? `Uploading ${Math.round((progress ?? 0) * 100)}%`
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
  // On mobile data, originals load only when the user asks (HD); on Wi-Fi automatically.
  // The web always shows previews (browsers can't decode HEIC/RAW); "Open original" downloads.
  const [hd, setHd] = useState<Set<string>>(new Set());
  const loadOriginalFor = (item: GalleryItem) => !isWeb && (!cellular || hd.has(item.id));
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<GalleryItem>>(null);

  const current = items[Math.min(index, items.length - 1)];

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
            />
          ) : (
            <VideoPage item={item} width={width} height={height} active={i === index} />
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
            {current.kind === 'photo' && !current.localUri && (current.remoteUrl || current.location) && !loadOriginalFor(current) && !isWeb ? (
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
  pendingVideo: { color: '#ccc', textAlign: 'center', marginTop: 12, fontSize: 13 },
  date: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sub: { color: '#aaa', fontSize: 12, marginTop: 2 },
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
