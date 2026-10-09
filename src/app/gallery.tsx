import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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
} from '@/lib/store';
import { confirmAndDelete } from '@/lib/delete-flow';
import { loadDoc, saveDoc } from '@/lib/local-store';
import { providerInfo } from '@/lib/storage/providers';
import { GalleryItem } from '@/lib/types';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

const isWeb = Platform.OS === 'web';
const GAP = 2;
const TARGET_TILE = 120;
const MAX_CONTENT_WIDTH = 1400;

type Tab = 'mine' | 'shared';

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
  const name = useStore((s) => s.identity?.name);
  const remoteLoading = useStore((s) => s.remoteLoading);
  const sharedLoading = useStore((s) => s.sharedLoading);

  const [tab, setTab] = useState<Tab>(params.tab === 'shared' ? 'shared' : 'mine');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const copiedEdit = useStore((s) => s.copiedEdit);
  const [pasting, setPasting] = useState(false);

  const items = tab === 'mine' ? mine : shared;
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH);
  const columns = Math.max(3, Math.floor(contentWidth / TARGET_TILE));
  const tileSize = (contentWidth - GAP * (columns - 1)) / columns;

  const exitSelect = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const switchTab = (next: Tab) => {
    exitSelect();
    setTab(next);
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

  const onRefresh = () => {
    (tab === 'mine' ? refreshRemote() : refreshShared()).catch((e) => notify('Refresh failed', errorMessage(e)));
  };

  if (status === 'needs-link') return <Redirect href="/link" />;

  const dismissNudge = () => {
    setNudgeDismissed(true);
    saveDoc('signin-nudge-dismissed', true);
  };

  const banner = signedOut && !isWeb ? (
    <Pressable style={[styles.banner, { backgroundColor: '#7F1D1D' }]} onPress={() => router.push('/signin')}>
      <Ionicons name="person-circle-outline" size={16} color="#fff" />
      <Text style={styles.bannerText}>You were signed out. Tap to sign in and keep uploading</Text>
    </Pressable>
  ) : guestFull && !isWeb ? (
    <Pressable style={[styles.banner, { backgroundColor: '#7C2D12' }]} onPress={() => router.push('/signin')}>
      <Ionicons name="cloud-outline" size={16} color="#fff" />
      <Text style={styles.bannerText}>Free guest storage is full. Tap to sign in and get 100 GB free</Text>
    </Pressable>
  ) : hot && !isWeb ? (
    <View style={[styles.banner, { backgroundColor: '#9A3412' }]}>
      <Ionicons name="thermometer-outline" size={16} color="#fff" />
      <Text style={styles.bannerText}>Phone is hot. Uploads are paused until it cools down</Text>
    </View>
  ) : storageStuck ? (
    // Phone nearly full and nothing is safe to remove yet: uploads must finish first.
    <View style={[styles.banner, { backgroundColor: '#7C2D12' }]}>
      <Ionicons name="warning-outline" size={16} color="#fff" />
      <Text style={styles.bannerText}>
        Phone almost full. Space frees up as {storageStuck} item{storageStuck === 1 ? '' : 's'} finish uploading
        {!online ? ' (offline now)' : ''}
      </Text>
    </View>
  ) : !online ? (
    <View style={[styles.banner, { backgroundColor: '#334155' }]}>
      <Ionicons name="cloud-offline-outline" size={16} color="#fff" />
      <Text style={styles.bannerText}>Offline{pending ? `: ${pending} waiting to upload` : ''}</Text>
    </View>
  ) : failed ? (
    <Pressable style={[styles.banner, { backgroundColor: '#7F1D1D' }]} onPress={retryFailed}>
      <Ionicons name="alert-circle-outline" size={16} color="#fff" />
      <Text style={styles.bannerText}>{failed} failed to upload. Tap to retry</Text>
    </Pressable>
  ) : pending && waitingForWifi === pending ? (
    <View style={[styles.banner, { backgroundColor: '#334155' }]}>
      <Ionicons name="wifi-outline" size={16} color="#fff" />
      <Text style={styles.bannerText}>{waitingForWifi} waiting for Wi-Fi (big files). Change in Settings</Text>
    </View>
  ) : pending ? (
    <View style={[styles.banner, { backgroundColor: '#1E3A8A' }]}>
      <ActivityIndicator size="small" color="#fff" />
      <Text style={styles.bannerText}>Uploading {pending} to the cloud…</Text>
    </View>
  ) : isGuest && !isWeb && !nudgeDismissed && mine.length >= 3 ? (
    <View style={[styles.banner, { backgroundColor: '#1C1C1E' }]}>
      <Ionicons name="shield-checkmark-outline" size={16} color={colors.accent} />
      <Pressable style={{ flex: 1 }} onPress={() => router.push('/signin')}>
        <Text style={styles.bannerText}>Sign in so you never lose your photos</Text>
      </Pressable>
      <Pressable onPress={dismissNudge} hitSlop={10} accessibilityLabel="Dismiss">
        <Ionicons name="close" size={16} color="#888" />
      </Pressable>
    </View>
  ) : null;

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {selecting ? (
            <Pressable onPress={exitSelect} hitSlop={10} style={styles.headerButton}>
              <Text style={styles.headerAction}>Cancel</Text>
            </Pressable>
          ) : !isWeb ? (
            <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back to camera" style={styles.headerButton}>
              <Ionicons name="chevron-back" size={26} color={colors.accent} />
              <Text style={styles.headerAction}>Camera</Text>
            </Pressable>
          ) : (
            <Text style={styles.brand}>Lens</Text>
          )}
        </View>

        <View style={styles.headerCenter}>
          {selecting ? (
            <Text style={styles.title}>{selected.size} selected</Text>
          ) : (
            <View style={styles.tabs}>
              {(['mine', 'shared'] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => switchTab(t)}
                  style={[styles.tab, tab === t && styles.tabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t }}
                >
                  <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === 'mine' ? 'Mine' : 'Shared'}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={[styles.headerSide, { justifyContent: 'flex-end' }]}>
          {isWeb && !selecting && tab === 'mine' && <WebUploader />}
          {!selecting && items.length > 0 && (
            <Pressable onPress={() => setSelecting(true)} hitSlop={10} style={styles.headerButton}>
              <Text style={styles.headerAction}>Select</Text>
            </Pressable>
          )}
          {!selecting && (
            <Pressable onPress={() => router.push('/settings')} hitSlop={10} accessibilityLabel="Settings" style={styles.headerButton}>
              <Ionicons name="person-circle-outline" size={26} color={colors.accent} />
            </Pressable>
          )}
        </View>
      </View>

      {tab === 'mine' && banner}

      {items.length === 0 ? (
        <View style={[styles.fill, styles.center, { padding: 32 }]}>
          {(tab === 'mine' ? remoteLoading : sharedLoading) ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name={tab === 'mine' ? 'images-outline' : 'people-outline'} size={64} color="#444" />
              <Text style={styles.emptyTitle}>{tab === 'mine' ? 'No photos or videos yet' : 'Nothing shared with you yet'}</Text>
              <Text style={styles.emptyBody}>
                {tab === 'shared'
                  ? `Friends can find you by your name${name ? `, ${name}` : ''}.`
                  : isWeb
                    ? 'Photos and videos you take with Lens on your iPhone or iPad show up here.'
                    : 'Go back to the camera and take your first shot. It goes straight to the cloud.'}
              </Text>
            </>
          )}
        </View>
      ) : (
        <FlatList
          key={`${tab}-${columns}`}
          data={items}
          keyExtractor={(item) => `${item.ownerId ?? 'me'}-${item.id}`}
          numColumns={columns}
          renderItem={({ item }) => (
            <MediaTile
              item={item}
              size={tileSize}
              selecting={selecting}
              selected={selected.has(item.id)}
              showOwner={tab === 'shared'}
              onPress={onPress}
              onLongPress={onLongPress}
            />
          )}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + (selecting ? 90 : 64), width: contentWidth, alignSelf: 'center' }}
          initialNumToRender={columns * 8}
          windowSize={7}
          refreshControl={
            <RefreshControl refreshing={tab === 'mine' ? remoteLoading : sharedLoading} onRefresh={onRefresh} tintColor="#fff" />
          }
        />
      )}

      {!selecting && tab === 'mine' && indicator && (
        // Where new shots go + its health; opens Storage settings.
        <Pressable
          onPress={() => router.push('/storage')}
          style={[styles.storagePill, { bottom: insets.bottom + 12 }]}
          accessibilityLabel={`Storage: ${indicator.label}, ${indicator.detail}`}
        >
          <Ionicons
            name={indicator.target === 'lens' ? 'cloud-outline' : providerInfo(indicator.target).icon}
            size={15}
            color="#fff"
          />
          <Text style={styles.storagePillText}>
            {indicator.label} · {indicator.detail}
          </Text>
          {indicator.level !== 'ok' && (
            <View style={[styles.storageDot, { backgroundColor: indicator.level === 'low' ? '#FBBF24' : colors.danger }]} />
          )}
        </Pressable>
      )}

      {selecting && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 10 }]}>
          {tab === 'mine' && copiedEdit && isImagingAvailable && (
            <Pressable onPress={pasteSelected} disabled={!selected.size || pasting} style={styles.actionButton}>
              {pasting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Ionicons name="clipboard-outline" size={22} color={selected.size ? '#fff' : '#555'} />
              )}
              <Text style={[styles.actionText, !selected.size && { color: '#555' }]}>Paste edit</Text>
            </Pressable>
          )}
          {tab === 'mine' && (
            <Pressable onPress={shareSelected} disabled={!selected.size} style={styles.actionButton}>
              <Ionicons name="paper-plane-outline" size={22} color={selected.size ? '#fff' : '#555'} />
              <Text style={[styles.actionText, !selected.size && { color: '#555' }]}>Send to friends</Text>
            </Pressable>
          )}
          <Pressable onPress={deleteSelected} disabled={!selected.size} style={styles.actionButton}>
            <Ionicons name="trash-outline" size={22} color={selected.size ? colors.danger : '#555'} />
            <Text style={[styles.actionText, { color: selected.size ? colors.danger : '#555' }]}>
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
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  headerSide: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  headerCenter: { alignItems: 'center' },
  headerButton: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 6 },
  headerAction: { color: colors.accent, fontSize: 17 },
  brand: { color: '#fff', fontSize: 20, fontWeight: '800', paddingHorizontal: 8 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  tabs: { flexDirection: 'row', backgroundColor: '#1C1C1E', borderRadius: 9, padding: 2 },
  tab: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 7 },
  tabActive: { backgroundColor: '#3A3A3C' },
  tabText: { color: '#8E8E93', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  bannerText: { color: '#fff', fontSize: 13, fontWeight: '500' },

  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  emptyBody: { color: '#888', fontSize: 15, textAlign: 'center', marginTop: 8, maxWidth: 360 },

  storagePill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(28,28,30,0.95)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3A3A3C',
  },
  storagePillText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  storageDot: { width: 8, height: 8, borderRadius: 4 },

  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
    backgroundColor: 'rgba(17,17,17,0.95)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#333',
  },
  actionButton: { alignItems: 'center', minWidth: 100, minHeight: 44, justifyContent: 'center' },
  actionText: { color: '#fff', fontSize: 12, marginTop: 4 },
});
