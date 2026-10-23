import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { AlbumPicker } from '@/components/AlbumPicker';
import { useNearbyPeople } from '@/lib/nearby';
import { peopleSupported } from '@/lib/people';
import { api } from '@/lib/api';
import { SharesStrip } from '@/components/SharesStrip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
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
  selectQuotaWaiting,
  selectStorageIndicator,
  selectStorageStuck,
  selectWaitingForWifi,
  useStore,
  selectTransferTotals,
  dismissSpaceFreed,
  canImport,
  scanCameraNow,
  importFromGallery,
} from '@/lib/store';
import { autoBackupEnabled, autoBackupOffered, autoBackupSupported, enableAutoBackup, markAutoBackupOffered } from '@/lib/auto-backup';
import { formatBytes, formatEta, formatRate } from '@/lib/format';
import { keepOnly, prefetchPhoto, prefetchVideo } from '@/lib/video-prefetch';
import { confirmAndDelete } from '@/lib/delete-flow';
import { loadDoc, saveDoc } from '@/lib/local-store';
import { nextPrompt, PromptKind } from '@/lib/review-prompt';
import { FeedbackPrompt } from '@/components/FeedbackPrompt';
import { PlusOffer } from '@/components/PlusOffer';
import { razorpayHere } from '@/lib/pay-channel';
import { nextPlusOffer, PlusReason } from '@/lib/plus-prompt';
import { isBurstExtra } from '@/lib/edits';
import { providerInfo } from '@/lib/storage/providers';
import { GalleryItem } from '@/lib/types';
import { font, palette, type as typeStyle } from '@/lib/theme';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';
import { who } from '@/lib/names';

const isWeb = Platform.OS === 'web';
const GAP = 4;
const TARGET_TILE = 130;
/** Film-strip edge on the left of the roll. */
const PERF = 20;
/** Same 20 px gutter as the header, so titles, banners, day markers and tiles share one left edge. */
const SIDE = 20;
const DAY_ROW = 34;
const PERF_PITCH = 22;
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
    // Where most of that day's photos were taken (own items with a saved location): "12 OCT · GOA".
    const places = new Map<string, number>();
    for (let k = i; k < j; k++) {
      const city = items[k].place?.city;
      if (city) places.set(city, (places.get(city) ?? 0) + 1);
    }
    const city = [...places.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    rows.push({
      type: 'day',
      key: `d-${dayKey}`,
      label: `${today ? 'TODAY · ' : ''}${date}${city ? ` · ${city.toUpperCase()}` : ''} · ${groupDigits(count)} ${numbered ? (count === 1 ? 'FRAME' : 'FRAMES') : 'SHARED'}`,
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

/** "1.0 GB of 5.0 GB" → "1/5 GB", "800 MB of 5.0 GB" → "800 MB/5 GB": fits next to the chips on a 360 px phone. */
function compactUsage(detail: string): string {
  const m = /^(.+) of (.+)$/.exec(detail);
  if (!m) return detail;
  const [used, total] = [m[1], m[2]].map((v) => v.replace(/\.0 /, ' '));
  const unit = / GB$/;
  return unit.test(used) && unit.test(total) ? `${used.replace(unit, '')}/${total}` : `${used}/${total}`;
}

/** Sprocket holes down the edge of the roll, on one even pitch for the whole roll (`top` = the row's offset in it). */
function Perfs({ height, top }: { height: number; top: number }) {
  const first = (PERF_PITCH - (top % PERF_PITCH)) % PERF_PITCH;
  const holes: number[] = [];
  for (let y = first; y + 10 <= height; y += PERF_PITCH) holes.push(y);
  return (
    <View style={[styles.perfs, { height }]} pointerEvents="none">
      {holes.map((y) => (
        <View key={y} style={[styles.perf, { top: y }]} />
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

/** Once: offer to back up photos taken with the phone's own camera too (src/lib/auto-backup.ts). */
function CameraBackupOffer({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const close = () => {
    markAutoBackupOffered();
    onClose();
  };
  return (
    <View style={[styles.banner, styles.offer]}>
      <Ionicons name="camera-outline" size={18} color={palette.link} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={styles.bannerText}>Back up photos from your phone’s own camera too? Everything you shoot, in any camera app, safe in full quality.</Text>
        <View style={styles.offerButtons}>
          <Pressable
            style={styles.offerPrimary}
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              const on = await enableAutoBackup(30);
              setBusy(false);
              if (on) {
                void scanCameraNow();
                notify('Camera backup is on', 'New photos and videos from your camera app back up automatically, starting with the last 30 days.');
              } else notify('Lens needs access to your photos', 'Allow it in the next prompt, or later in Settings → Uploads.');
              close();
            }}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.offerPrimaryText}>Turn on</Text>}
          </Pressable>
          <Pressable onPress={close} hitSlop={8}>
            <Text style={styles.offerSecondary}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function GalleryScreen() {
  const insets = useSafeAreaInsets();
  // Shown once, to people who already use Lens (a few photos in), when the app supports it.
  const [showCameraOffer, setShowCameraOffer] = useState(() => autoBackupSupported && !autoBackupEnabled() && !autoBackupOffered());
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
  const quotaWaiting = useStore(selectQuotaWaiting);
  const isGuest = useStore((s) => !!s.identity && !s.identity.email);
  const [nudgeDismissed, setNudgeDismissed] = useState(() => loadDoc('signin-nudge-dismissed', false));
  const online = useStore((s) => s.online);
  const spaceFreed = useStore((s) => s.spaceFreed);
  const importWaitingForSpace = useStore((s) => s.importWaitingForSpace);
  const name = useStore((s) => s.identity?.name);
  const remoteLoading = useStore((s) => s.remoteLoading);
  const sharedLoading = useStore((s) => s.sharedLoading);

  // The feedback loop (src/lib/review-prompt.ts): decided once when the roll opens, only when calm.
  const [prompt, setPrompt] = useState<PromptKind | null>(null);
  const calm = !pending && !failed && online && !isGuestBanner();
  function isGuestBanner() {
    return isGuest && !isWeb && !nudgeDismissed && mine.length >= 3;
  }
  // Lens Plus at natural moments (src/lib/plus-prompt-rules.ts): before the feedback card, one card at a time.
  const [plusReason, setPlusReason] = useState<PlusReason | null>(null);
  const plusChosen = useRef(false);
  const storageInfo = useStore((s) => s.storage);
  useEffect(() => {
    if (plusReason || prompt || !calm || !storageInfo?.signedIn) return;
    const lens = storageInfo.lens;
    const paid = lens.paidPlan && lens.paidPlan.status !== 'lapsed';
    const t = setTimeout(() => {
      const reason = nextPlusOffer({ eligible: razorpayHere && !paid && !lens.plus, usedBytes: lens.usedBytes, quotaBytes: lens.quotaBytes, welcomeUntil: lens.welcomeUntil, backups: mine.length });
      if (reason) {
        plusChosen.current = true;
        setPlusReason(reason);
      }
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calm, storageInfo]);
  useEffect(() => {
    if (isWeb || prompt || plusReason || !calm) return;
    const t = setTimeout(() => !plusChosen.current && setPrompt(nextPrompt({ photos: mine.length, calm })), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calm]);


  const [tab, setTab] = useState<Tab>(params.tab === 'shared' ? 'shared' : 'mine');
  const [selecting, setSelecting] = useState(false);
  const [albumPicking, setAlbumPicking] = useState(false);
  // Lens users on this Wi-Fi (opt-in on both sides, verified by the server): while the roll is open.
  const nearby = useNearbyPeople(!isWeb);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const copiedEdit = useStore((s) => s.copiedEdit);
  const [pasting, setPasting] = useState(false);

  const [videosOnly, setVideosOnly] = useState(false);
  const all = tab === 'mine' ? mine : shared;
  // Burst shots other than the pick stay out of the roll (the pick shows ⧉ N; browse them in the viewer).
  const items = useMemo(() => all.filter((i) => (!videosOnly || i.kind === 'video') && !isBurstExtra(i.edit)), [all, videosOnly]);
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH);
  const gridWidth = contentWidth - PERF - SIDE;
  const columns = Math.max(3, Math.floor(gridWidth / TARGET_TILE));
  const tileSize = Math.floor((gridWidth - GAP * (columns - 1)) / columns);
  const rows = useMemo(() => buildRows(items, columns, tab === 'mine'), [items, columns, tab]);
  const rowTops = useMemo(() => {
    const tops: number[] = [];
    for (let k = 0, y = 0; k < rows.length; k++) {
      tops.push(y);
      y += rows[k].type === 'day' ? DAY_ROW : tileSize + GAP;
    }
    return tops;
  }, [rows, tileSize]);

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
      <Text style={styles.bannerText}>Free guest storage is full. Tap to sign in: 40 GB free for 3 months</Text>
    </Pressable>
  ) : quotaWaiting && !isWeb ? (
    // Over the storage limit: nothing is lost, new photos wait on the phone (server over-limit.ts).
    <Pressable style={styles.banner} onPress={() => router.push('/storage')}>
      <Ionicons name="pause-circle-outline" size={18} color={palette.accent} />
      <Text style={styles.bannerText}>
        Backups paused: {quotaWaiting} {quotaWaiting === 1 ? 'photo waits' : 'photos wait'} on this phone. Your Lens storage is full. Tap for options
      </Text>
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
  ) : showCameraOffer && mine.length >= 3 && tab === 'mine' && !selecting ? (
    <CameraBackupOffer onClose={() => setShowCameraOffer(false)} />
  ) : plusReason && tab === 'mine' && !selecting ? (
    <PlusOffer reason={plusReason} onClose={() => setPlusReason(null)} />
  ) : prompt && tab === 'mine' && !selecting ? (
    <FeedbackPrompt kind={prompt} onClose={() => setPrompt(null)} />
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
          {tab === 'mine' ? `${groupDigits(mine.length)} ${mine.length === 1 ? 'FRAME' : 'FRAMES'} · NEVER ENDS` : 'SHARED WITH YOU'}
          {rollStatus ? ' · ' : ''}
          {rollStatus ? <Text style={[typeStyle.monoLabel, { color: rollStatus.color }]}>{rollStatus.text}</Text> : null}
        </Text>
        {!selecting && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll} contentContainerStyle={styles.filters}>
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
            <Pressable onPress={() => router.push('/albums')} style={styles.filter} accessibilityRole="button" accessibilityLabel="Albums">
              <Text style={styles.filterText}>Albums</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/recaps')} style={styles.filter} accessibilityRole="button" accessibilityLabel="Recaps">
              <Text style={styles.filterText}>Recaps</Text>
            </Pressable>
            {!isWeb ? (
              <Pressable onPress={() => router.push('/places')} style={styles.filter} accessibilityRole="button" accessibilityLabel="Places">
                <Text style={styles.filterText}>Places</Text>
              </Pressable>
            ) : null}
            {peopleSupported ? (
              <Pressable onPress={() => router.push('/people')} style={styles.filter} accessibilityRole="button" accessibilityLabel="People">
                <Text style={styles.filterText}>People</Text>
              </Pressable>
            ) : null}
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
                  {compactUsage(indicator.detail)}
                </Text>
              </Pressable>
            )}
          </ScrollView>
        )}
      </View>

      {tab === 'mine' && banner}
      {tab === 'mine' && !selecting && nearby.length > 0 ? (
        <Pressable style={styles.nearbyStrip} onPress={() => setSelecting(true)} accessibilityRole="button">
          <Ionicons name="wifi" size={16} color={palette.accent} />
          <Text style={styles.nearbyText} numberOfLines={1}>
            {nearby.length === 1 ? `${who(nearby[0])} is nearby` : `${who(nearby[0])} and ${nearby.length - 1} more nearby`}
          </Text>
          <Text style={styles.nearbyAction}>Pick photos</Text>
        </Pressable>
      ) : null}
      {tab === 'shared' && <SharesStrip />}

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
                  ? `Friends find you by your full name${name ? `, ${name}` : ''}, or by scanning Settings → My Lens code. You accept each share first.`
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
          renderItem={({ item: row, index }) =>
            row.type === 'day' ? (
              <View style={styles.dayRow}>
                <Perfs height={DAY_ROW} top={rowTops[index] ?? 0} />
                <Text style={[styles.dayText, row.today && { color: palette.accent }]}>{row.label}</Text>
              </View>
            ) : (
              <View style={[styles.tileRow, { height: tileSize + GAP }]}>
                <Perfs height={tileSize + GAP} top={rowTops[index] ?? 0} />
                <View style={styles.tiles}>
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
            <Pressable onPress={() => setAlbumPicking(true)} disabled={!selected.size} style={styles.actionButton}>
              <Ionicons name="albums-outline" size={22} color={selected.size ? palette.text : '#636366'} />
              <Text style={[styles.actionText, !selected.size && { color: '#636366' }]}>Add to album</Text>
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
      <AlbumPicker
        visible={albumPicking}
        count={selected.size}
        onClose={() => setAlbumPicking(false)}
        onPick={async (choice) => {
          // Only what's in the cloud can be in an album (it lives there); the rest is skipped and said so.
          const chosen = [...selected];
          const ready = chosen.filter((id) => mine.find((g) => g.id === id)?.sync === 'synced');
          if (!ready.length) throw new Error('These are still uploading. Add them once they are in the cloud.');
          const name = 'newName' in choice ? choice.newName : choice.name;
          if ('newName' in choice) await api.createAlbum(choice.newName, ready);
          else await api.editAlbum(choice.id, { add: ready });
          const skipped = chosen.length - ready.length;
          notify('Added to album', `${ready.length} item${ready.length === 1 ? '' : 's'} in “${name}”.${skipped ? ` ${skipped} still uploading ${skipped === 1 ? 'was' : 'were'} skipped.` : ''}`);
          exitSelect();
        }}
      />
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
  nearbyStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginTop: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: palette.surface },
  nearbyText: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  nearbyAction: { color: palette.link, fontSize: 14, fontWeight: '600' },
  // Scrolls sideways: chips (filters, Albums, Places, storage) don't fit a 360 dp phone.
  filtersScroll: { marginTop: 14, flexGrow: 0 },
  filters: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 },
  filter: { paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: palette.surface, justifyContent: 'center' },
  filterOn: { backgroundColor: palette.text },
  filterText: { color: palette.soft, fontSize: 14, fontWeight: '500' },
  filterTextOn: { color: '#000', fontWeight: '600' },
  storageChip: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, flexShrink: 1, paddingLeft: 6 },
  storageChipText: { color: palette.muted, fontSize: 11, fontFamily: font.mono, flexShrink: 1 },

  dayRow: { flexDirection: 'row', alignItems: 'center', height: DAY_ROW, paddingRight: SIDE },
  dayText: { color: palette.muted, fontSize: 11, fontFamily: font.monoMedium, letterSpacing: 1.3 },
  tileRow: { flexDirection: 'row', paddingRight: SIDE },
  tiles: { flexDirection: 'row', gap: GAP },
  perfs: { width: PERF },
  perf: { position: 'absolute', left: 7, width: 7, height: 10, borderRadius: 2, backgroundColor: palette.surface },

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
  offer: { alignItems: 'flex-start' },
  offerButtons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  offerPrimary: { backgroundColor: palette.link, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 7, minWidth: 80, alignItems: 'center' },
  offerPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  offerSecondary: { color: palette.muted, fontSize: 13, fontWeight: '500' },
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
