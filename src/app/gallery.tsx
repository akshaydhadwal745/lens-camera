import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
  ViewToken,
} from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isImagingAvailable } from '../../modules/lens-camera';
import { MediaTile } from '@/components/MediaTile';
import { WebUploader } from '@/components/WebUploader';
import {
  pasteEdit,
  refreshRemote,
  refreshShared,
  removeSharedItem,
  retryFailed,
  selectFailedCount,
  selectGallery,
  selectPendingCount,
  selectShared,
  isHot,
  selectGuestFull,
  selectStorageIndicator,
  selectStorageStuck,
  selectWaitingForWifi,
  useStore,
  selectTransferTotals,
  dismissSpaceFreed,
  canImport,
  importFromGallery,
} from '@/lib/store';
import { formatBytes, formatEta, formatRate } from '@/lib/format';
import { keepOnly, prefetchPhoto, prefetchVideo } from '@/lib/video-prefetch';
import { confirmAndDelete } from '@/lib/delete-flow';
import { loadDoc, saveDoc } from '@/lib/local-store';
import { providerInfo } from '@/lib/storage/providers';
import { GalleryItem } from '@/lib/types';
import { font, palette, type as typeStyle } from '@/lib/theme';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

const isWeb = Platform.OS === 'web';
const GAP = 4;
const TARGET_TILE = 130;
/** Film-strip edge on the left of the roll. */
const PERF = 18;
const SIDE = 16;
const MAX_CONTENT_WIDTH = 1400;

type Tab = 'mine' | 'shared';

type Row =
  | { type: 'day'; key: string; label: string; today: boolean }
  | { type: 'tiles'; key: string; tiles: { item: GalleryItem; frame?: number }[] };

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2 412": thin groups, like a frame counter. */
export function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/**
 * The roll: a day marker ("TODAY · 10 OCT · 42 FRAMES") then rows of tiles.
 * Items arrive newest first; frame numbers count up from the very first shot.
 */
function buildRows(items: GalleryItem[], columns: number, numbered: boolean): Row[] {
  const rows: Row[] = [];
  const now = new Date();
  const todayKey = now.toDateString();
  let i = 0;
  while (i < items.length) {
    const day = new Date(items[i].createdAt);
    const dayKey = day.toDateString();
    let j = i;
    while (j < items.length && new Date(items[j].createdAt).toDateString() === dayKey) j++;
    const count = j - i;
    const date = `${day.getDate()} ${MONTHS[day.getMonth()]}${day.getFullYear() !== now.getFullYear() ? ` ${day.getFullYear()}` : ''}`;
    const today = dayKey === todayKey;
    rows.push({
      type: 'day',
      key: `d-${dayKey}`,
      label: `${today ? 'TODAY · ' : ''}${date} · ${groupDigits(count)} ${numbered ? (count === 1 ? 'FRAME' : 'FRAMES') : 'SHARED'}`,
      today,
    });
    for (let k = i; k < j; k += columns) {
      const tiles = items.slice(k, Math.min(k + columns, j)).map((item, n) => ({ item, frame: numbered ? items.length - (k + n) : undefined }));
      rows.push({ type: 'tiles', key: `t-${tiles[0].item.ownerId ?? 'me'}-${tiles[0].item.id}`, tiles });
    }
    i = j;
  }
  return rows;
}

/** Sprocket holes down the edge of the roll. */
function Perfs({ height }: { height: number }) {
  const count = Math.max(1, Math.round(height / 22));
  return (
    <View style={[styles.perfs, { height }]} pointerEvents="none">
      {Array.from({ length: count }, (_, k) => (
        <View key={k} style={styles.perf} />
      ))}
    </View>
  );
}

/** "Uploading 1 video · 176 MB of 1.0 GB in cloud" + speed, time left and a bar. */
function UploadBanner({ pending }: { pending: number }) {
  const t = useStore(selectTransferTotals);
  const pct = t.total ? Math.min(100, Math.round((t.sent / t.total) * 100)) : 0;
  const details = [t.rate > 0 ? formatRate(t.rate) : '', formatEta(t.total - t.sent, t.rate)].filter(Boolean).join(' · ');
  return (
    <View style={[styles.banner, styles.uploadBanner]}>
      <View style={styles.uploadRow}>
        <ActivityIndicator size="small" color={palette.link} />
        <Text style={styles.bannerText}>
          Uploading {pending} to the cloud
          {t.count ? ` · ${formatBytes(t.sent)} of ${formatBytes(t.total)} (${pct}%)` : '…'}
        </Text>
      </View>
      {t.count > 0 && (
        <>
          <View style={styles.uploadTrack}>
            <View style={[styles.uploadFill, { width: `${pct}%` }]} />
          </View>
          {!!details && <Text style={styles.uploadDetails}>{details}</Text>}
        </>
      )}
    </View>
  );
}

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ tab?: Tab }>();
  const status = useStore((s) => s.status);
  const mine = useStore(selectGallery);
  const shared = useStore(selectShared);
  const pending = useStore(selectPendingCount);
  const failed = useStore(selectFailedCount);
  const waitingForWifi = useStore(selectWaitingForWifi);
  const storageStuck = useStore(selectStorageStuck);
  const indicator = useStore(selectStorageIndicator);
  const signedOut = useStore((s) => s.signedOut);
  const hot = useStore((s) => isHot(s.thermal));
  const guestFull = useStore(selectGuestFull);
  const isGuest = useStore((s) => !!s.identity && !s.identity.email);
  const [nudgeDismissed, setNudgeDismissed] = useState(() => loadDoc('signin-nudge-dismissed', false));
  const online = useStore((s) => s.online);
  const spaceFreed = useStore((s) => s.spaceFreed);
  const importWaitingForSpace = useStore((s) => s.importWaitingForSpace);
  const name = useStore((s) => s.identity?.name);
  const remoteLoading = useStore((s) => s.remoteLoading);
  const sharedLoading = useStore((s) => s.sharedLoading);

  const [tab, setTab] = useState<Tab>(params.tab === 'shared' ? 'shared' : 'mine');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const copiedEdit = useStore((s) => s.copiedEdit);
  const [pasting, setPasting] = useState(false);

  const [videosOnly, setVideosOnly] = useState(false);
  const all = tab === 'mine' ? mine : shared;
  const items = useMemo(() => (videosOnly ? all.filter((i) => i.kind === 'video') : all), [all, videosOnly]);
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH);
  const gridWidth = contentWidth - PERF - SIDE;
  const columns = Math.max(3, Math.floor(gridWidth / TARGET_TILE));
  const tileSize = Math.floor((gridWidth - GAP * (columns - 1)) / columns);
  const rows = useMemo(() => buildRows(items, columns, tab === 'mine'), [items, columns, tab]);

  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const switchTab = (next: Tab, videos = false) => {
    exitSelect();
    setTab(next);
    setVideosOnly(videos);
    if (next === 'shared') refreshShared();
  };

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onPress = useCallback(
    (item: GalleryItem) => {
      if (selecting) return toggle(item.id);
      router.push({ pathname: '/viewer/[id]', params: { id: item.id, source: tab } });
    },
    [selecting, tab, toggle],
  );

  // Intent preloading: finger on a tile = about to open it.
  const onPressIn = useCallback(
    (item: GalleryItem) => {
      if (selecting) return;
      if (item.kind === 'video') prefetchVideo(item, 'high');
      else prefetchPhoto(item);
    },
    [selecting],
  );

  // Scrolling stopped (or the gallery just opened): warm the videos nearest the
  // middle of the screen. Visibility changes keep coming while scrolling, so
  // 300 ms after the last one means "stopped here". FlatList needs one stable
  // callback for its whole life.
  const [settle] = useState(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (timer) clearTimeout(timer);
    };
    const onViewable = ({ viewableItems }: { viewableItems: ViewToken<Row>[] }) => {
      cancel();
      timer = setTimeout(() => {
        const visible = viewableItems.flatMap((v) => (v.item?.type === 'tiles' ? v.item.tiles.map((t) => t.item) : []));
        const middle = (visible.length - 1) / 2;
        const videos = visible
          .map((item, i) => ({ item, distance: Math.abs(i - middle) }))
          .filter((v) => v.item.kind === 'video')
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 2)
          .map((v) => v.item);
        keepOnly(videos.map((v) => v.id));
        videos.forEach((v) => prefetchVideo(v, 'medium'));
      }, 300);
    };
    return { onViewable, cancel };
  });
  useEffect(() => settle.cancel, [settle]);

  const onLongPress = useCallback(
    (item: GalleryItem) => {
      setSelecting(true);
      toggle(item.id);
    },
    [toggle],
  );

  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    const noun = ids.length === 1 ? 'item' : 'items';
    if (tab === 'shared') {
      if (!(await confirmDestructive(`Remove ${ids.length} ${noun}?`, 'They will be removed from your Shared list.', 'Remove'))) return;
      const chosen = shared.filter((s) => selected.has(s.id));
      await Promise.all(chosen.map((item) => removeSharedItem(item).catch(() => {})));
    } else {
      if (!(await confirmAndDelete(ids))) return;
    }
    exitSelect();
  };

  const shareSelected = () => {
    const ids = mine.filter((m) => selected.has(m.id)).map((m) => m.id);
    if (!ids.length) return;
    router.push({ pathname: '/share', params: { ids: ids.join(',') } });
    exitSelect();
  };

  const pasteSelected = async () => {
    const ids = mine.filter((m) => selected.has(m.id)).map((m) => m.id);
    if (!ids.length) return;
    setPasting(true);
    try {
      const done = await pasteEdit(ids);
      notify('Edit pasted', `Applied to ${done} of ${ids.length}. Originals are unchanged.`);
      exitSelect();
    } finally {
      setPasting(false);
    }
  };

  // Import: the user picks from their gallery; items upload one by one (copied only for the upload).
  const onImport = () => {
    importFromGallery()
      .then(({ added, skipped }) => {
        if (added) notify(`Importing ${added} item${added === 1 ? '' : 's'}`, 'They upload one by one at full quality. The originals stay in your phone gallery.');
        else if (skipped) notify('Already in Lens', `${skipped === 1 ? 'That item is' : 'Those items are'} already imported.`);
      })
      .catch((e) => notify('Import failed', errorMessage(e)));
  };

  const onRefresh = () => {
    (tab === 'mine' ? refreshRemote() : refreshShared()).catch((e) => notify('Refresh failed', errorMessage(e)));
  };

  if (status === 'needs-link') return <Redirect href="/link" />;

  const dismissNudge = () => {
    setNudgeDismissed(true);
    saveDoc('signin-nudge-dismissed', true);
  };

  const banner = signedOut && !isWeb ? (
    <Pressable style={styles.banner} onPress={() => router.push('/signin')}>
      <Ionicons name="person-circle-outline" size={18} color={palette.danger} />
      <Text style={styles.bannerText}>You were signed out. Tap to sign in and keep uploading</Text>
    </Pressable>
  ) : guestFull && !isWeb ? (
    <Pressable style={styles.banner} onPress={() => router.push('/signin')}>
      <Ionicons name="cloud-outline" size={18} color={palette.accent} />
      <Text style={styles.bannerText}>Free guest storage is full. Tap to sign in and get 100 GB free</Text>
    </Pressable>
  ) : hot && !isWeb ? (
    <View style={styles.banner}>
      <Ionicons name="thermometer-outline" size={18} color={palette.accent} />
      <Text style={styles.bannerText}>Phone is hot. Uploads are paused until it cools down</Text>
    </View>
  ) : storageStuck ? (
    // Phone nearly full and nothing is safe to remove yet: uploads must finish first.
    <View style={styles.banner}>
      <Ionicons name="warning-outline" size={18} color={palette.accent} />
      <Text style={styles.bannerText}>
        Phone almost full. Space frees up as {storageStuck} item{storageStuck === 1 ? '' : 's'} finish uploading
        {!online ? ' (offline now)' : ''}
      </Text>
    </View>
  ) : !online ? (
    <View style={styles.banner}>
      <Ionicons name="cloud-offline-outline" size={18} color={palette.muted} />
      <Text style={styles.bannerText}>Offline{pending ? `: ${pending} waiting to upload` : ''}</Text>
    </View>
  ) : failed ? (
    <Pressable style={styles.banner} onPress={retryFailed}>
      <Ionicons name="alert-circle-outline" size={18} color={palette.danger} />
      <Text style={styles.bannerText}>{failed} failed to upload. Tap to retry</Text>
    </Pressable>
  ) : importWaitingForSpace && pending ? (
    <Pressable style={styles.banner} onPress={() => router.push('/settings')}>
      <Ionicons name="phone-portrait-outline" size={18} color={palette.accent} />
      <Text style={styles.bannerText}>Imports wait for free space (they need room for one copy at a time). Tap for storage settings</Text>
    </Pressable>
  ) : pending && waitingForWifi === pending ? (
    <View style={styles.banner}>
      <Ionicons name="wifi-outline" size={18} color={palette.link} />
      <Text style={styles.bannerText}>{waitingForWifi} waiting for Wi-Fi (big files). Change in Settings</Text>
    </View>
  ) : pending ? (
    <UploadBanner pending={pending} />
  ) : spaceFreed && !isWeb ? (
    // The storage guardian removed originals: say so once, so playing from the cloud isn't a surprise.
    <View style={styles.banner}>
      <Ionicons name="phone-portrait-outline" size={18} color={palette.accent} />
      <Pressable style={{ flex: 1 }} onPress={() => router.push('/settings')}>
        <Text style={styles.bannerText}>
          Freed {formatBytes(spaceFreed.bytes)} on this phone (less than {spaceFreed.keepFreeGB} GB was free). {spaceFreed.count}{' '}
          {spaceFreed.count === 1 ? 'original is' : 'originals are'} safe in the cloud and play from there.
        </Text>
      </Pressable>
      <Pressable onPress={dismissSpaceFreed} hitSlop={10} accessibilityLabel="Dismiss">
        <Ionicons name="close" size={16} color="#86868B" />
      </Pressable>
    </View>
  ) : isGuest && !isWeb && !nudgeDismissed && mine.length >= 3 ? (
    <View style={styles.banner}>
      <Ionicons name="shield-checkmark-outline" size={18} color={palette.safe} />
      <Pressable style={{ flex: 1 }} onPress={() => router.push('/signin')}>
        <Text style={styles.bannerText}>Sign in so you never lose your photos</Text>
      </Pressable>
      <Pressable onPress={dismissNudge} hitSlop={10} accessibilityLabel="Dismiss">
        <Ionicons name="close" size={16} color="#86868B" />
      </Pressable>
    </View>
  ) : null;

  const rollStatus = getRollStatus();
  function getRollStatus() {
    if (tab === 'shared') return { text: `${groupDigits(shared.length)} FROM FRIENDS`, color: palette.muted };
    if (failed) return { text: `${failed} FAILED`, color: palette.danger };
    if (pending && !online) return { text: `${pending} WAITING · OFFLINE`, color: palette.muted };
    if (pending) return { text: `${pending} UPLOADING`, color: palette.link };
    return mine.length ? { text: 'ALL SAFE', color: palette.safe } : null;
  }
  const goCamera = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={[styles.head, { width: contentWidth }]}>
        <View style={styles.titleRow}>
          <Text style={[typeStyle.largeTitle, styles.titleText]} numberOfLines={1}>
            {selecting ? `${selected.size} selected` : 'The roll'}
          </Text>
          {selecting ? (
            <Pressable onPress={exitSelect} hitSlop={10} style={styles.headerButton}>
              <Text style={styles.headerAction}>Cancel</Text>
            </Pressable>
          ) : (
            <View style={styles.headerButtons}>
              {isWeb && tab === 'mine' && <WebUploader />}
              {canImport && tab === 'mine' && (
                <Pressable onPress={onImport} hitSlop={6} accessibilityLabel="Import from your phone gallery" style={styles.roundButton}>
                  <Ionicons name="add" size={22} color={palette.text} />
                </Pressable>
              )}
              {items.length > 0 && (
                <Pressable onPress={() => setSelecting(true)} hitSlop={6} accessibilityLabel="Select" style={styles.roundButton}>
                  <Ionicons name="checkmark-circle-outline" size={21} color={palette.text} />
                </Pressable>
              )}
              <Pressable onPress={() => router.push('/settings')} hitSlop={6} accessibilityLabel="Settings" style={styles.roundButton}>
                <Ionicons name="settings-outline" size={20} color={palette.text} />
              </Pressable>
            </View>
          )}
        </View>
        <Text style={[typeStyle.monoLabel, styles.statusLine]}>
          {tab === 'mine' ? `${groupDigits(mine.length)} FRAMES · NEVER ENDS` : 'SHARED WITH YOU'}
          {rollStatus ? ' · ' : ''}
          {rollStatus ? <Text style={[typeStyle.monoLabel, { color: rollStatus.color }]}>{rollStatus.text}</Text> : null}
        </Text>
        {!selecting && (
          <View style={styles.filters}>
            {(
              [
                ['All', 'mine', false],
                ['Videos', 'mine', true],
                ['Shared', 'shared', false],
              ] as const
            ).map(([label, t, videos]) => {
              const on = tab === t && videosOnly === videos;
              return (
                <Pressable
                  key={label}
                  onPress={() => switchTab(t, videos)}
                  style={[styles.filter, on && styles.filterOn]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.filterText, on && styles.filterTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
            {tab === 'mine' && indicator && (
              // Where new shots go + its health; opens Storage settings.
              <Pressable
                onPress={() => router.push('/storage')}
                style={styles.storageChip}
                accessibilityLabel={`Storage: ${indicator.label}, ${indicator.detail}`}
              >
                <Ionicons
                  name={indicator.target === 'lens' ? 'cloud-outline' : providerInfo(indicator.target).icon}
                  size={14}
                  color={indicator.level === 'ok' ? palette.muted : indicator.level === 'low' ? palette.accent : palette.danger}
                />
                <Text style={styles.storageChipText} numberOfLines={1}>
                  {indicator.detail}
                </Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {tab === 'mine' && banner}

      {items.length === 0 ? (
        <View style={[styles.fill, styles.center, { padding: 32 }]}>
          {(tab === 'mine' ? remoteLoading : sharedLoading) ? (
            <ActivityIndicator color={palette.text} />
          ) : (
            <>
              <Ionicons name={tab === 'shared' ? 'people-outline' : videosOnly ? 'videocam-outline' : 'film-outline'} size={56} color={palette.surface3} />
              <Text style={styles.emptyTitle}>
                {tab === 'shared' ? 'Nothing shared with you yet' : videosOnly ? 'No videos yet' : 'Your roll starts here'}
              </Text>
              <Text style={styles.emptyBody}>
                {tab === 'shared'
                  ? `Friends can find you by your name${name ? `, ${name}` : ''}.`
                  : isWeb
                    ? 'Photos and videos you take with Lens on your phone show up here.'
                    : 'Take your first shot. It goes straight to the cloud, and the roll never runs out.'}
              </Text>
              {canImport && tab === 'mine' && !videosOnly && (
                <Pressable onPress={onImport} style={styles.importButton} accessibilityRole="button">
                  <Ionicons name="images-outline" size={18} color={palette.link} />
                  <Text style={styles.importButtonText}>Import from your phone</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      ) : (
        <FlatList
          key={`${tab}-${columns}`}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={({ item: row }) =>
            row.type === 'day' ? (
              <View style={styles.dayRow}>
                <Perfs height={34} />
                <Text style={[styles.dayText, row.today && { color: palette.accent }]}>{row.label}</Text>
              </View>
            ) : (
              <View style={[styles.tileRow, { height: tileSize + GAP }]}>
                <Perfs height={tileSize + GAP} />
                {row.tiles.map(({ item, frame }) => (
                  <MediaTile
                    key={`${item.ownerId ?? 'me'}-${item.id}`}
                    item={item}
                    size={tileSize}
                    frame={frame}
                    selecting={selecting}
                    selected={selected.has(item.id)}
                    showOwner={tab === 'shared'}
                    onPress={onPress}
                    onLongPress={onLongPress}
                    onPressIn={onPressIn}
                  />
                ))}
              </View>
            )
          }
          contentContainerStyle={{ paddingTop: 6, paddingBottom: insets.bottom + 100, width: contentWidth, alignSelf: 'center' }}
          onViewableItemsChanged={settle.onViewable}
          initialNumToRender={16}
          windowSize={7}
          refreshControl={
            <RefreshControl refreshing={tab === 'mine' ? remoteLoading : sharedLoading} onRefresh={onRefresh} tintColor={palette.text} />
          }
        />
      )}

      {!selecting && !isWeb && (
        <Pressable onPress={goCamera} style={[styles.keepShooting, { bottom: insets.bottom + 20 }]} accessibilityRole="button" accessibilityLabel="Back to the camera">
          <Ionicons name="camera-outline" size={22} color="#000" />
          <Text style={styles.keepShootingText}>Keep shooting</Text>
        </Pressable>
      )}

      {selecting && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 10 }]}>
          {tab === 'mine' && copiedEdit && isImagingAvailable && (
            <Pressable onPress={pasteSelected} disabled={!selected.size || pasting} style={styles.actionButton}>
              {pasting ? (
                <ActivityIndicator color={palette.text} />
              ) : (
                <Ionicons name="clipboard-outline" size={22} color={selected.size ? palette.text : '#636366'} />
              )}
              <Text style={[styles.actionText, !selected.size && { color: '#636366' }]}>Paste edit</Text>
            </Pressable>
          )}
          {tab === 'mine' && (
            <Pressable onPress={shareSelected} disabled={!selected.size} style={styles.actionButton}>
              <Ionicons name="paper-plane-outline" size={22} color={selected.size ? palette.text : '#636366'} />
              <Text style={[styles.actionText, !selected.size && { color: '#636366' }]}>Send to friends</Text>
            </Pressable>
          )}
          <Pressable onPress={deleteSelected} disabled={!selected.size} style={styles.actionButton}>
            <Ionicons name="trash-outline" size={22} color={selected.size ? colors.danger : '#636366'} />
            <Text style={[styles.actionText, { color: selected.size ? colors.danger : '#636366' }]}>
              {tab === 'mine' ? 'Delete' : 'Remove'}
            </Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },

  // Design D, "the roll": big title, a mono status line, filter chips.
  head: { alignSelf: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  titleText: { flex: 1 },
  statusLine: { marginTop: 4 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roundButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.surface, alignItems: 'center', justifyContent: 'center' },
  headerButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 4 },
  headerAction: { color: palette.link, fontSize: 17 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  filter: { paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: palette.surface, justifyContent: 'center' },
  filterOn: { backgroundColor: palette.text },
  filterText: { color: palette.soft, fontSize: 14, fontWeight: '500' },
  filterTextOn: { color: '#000', fontWeight: '600' },
  storageChip: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, flexShrink: 1, paddingLeft: 6 },
  storageChipText: { color: palette.muted, fontSize: 11, fontFamily: font.mono, flexShrink: 1 },

  dayRow: { flexDirection: 'row', alignItems: 'center', height: 34, paddingRight: SIDE },
  dayText: { color: palette.muted, fontSize: 11, fontFamily: font.monoMedium, letterSpacing: 1.3 },
  tileRow: { flexDirection: 'row', gap: GAP, paddingRight: SIDE },
  perfs: { width: PERF, marginRight: 0, alignItems: 'center', justifyContent: 'space-evenly' },
  perf: { width: 7, height: 10, borderRadius: 2, backgroundColor: palette.surface },

  importButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
    backgroundColor: palette.surface,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  importButtonText: { color: palette.link, fontSize: 15, fontWeight: '600' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: SIDE,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: palette.surface,
  },
  bannerText: { color: palette.text, fontSize: 13, fontWeight: '500', flexShrink: 1 },
  uploadBanner: { flexDirection: 'column', alignItems: 'stretch', gap: 8 },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  uploadTrack: { height: 4, borderRadius: 2, backgroundColor: palette.surface2, overflow: 'hidden' },
  uploadFill: { height: '100%', backgroundColor: palette.link },
  uploadDetails: { color: palette.muted, fontSize: 11, fontFamily: font.mono },

  emptyTitle: { color: palette.text, fontSize: 22, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  emptyBody: { color: palette.muted, fontSize: 15, textAlign: 'center', marginTop: 8, maxWidth: 360, lineHeight: 21 },

  keepShooting: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    paddingHorizontal: 28,
    borderRadius: 28,
    backgroundColor: palette.text,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  keepShootingText: { color: '#000', fontSize: 15, fontWeight: '600' },

  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    backgroundColor: 'rgba(28,28,30,0.97)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.surface2,
  },
  actionButton: { alignItems: 'center', minWidth: 100, minHeight: 44, justifyContent: 'center' },
  actionText: { color: palette.text, fontSize: 12, marginTop: 4 },
});
