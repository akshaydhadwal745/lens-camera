import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteForever, refreshTrash, restoreItem, useStore } from '@/lib/store';
import { TrashItem } from '@/lib/types';
import { chooseAction, colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

type Tab = 'trash' | 'archive';

const DAY = 24 * 3600 * 1000;
const GAP = 2;
const MAX_WIDTH = 900;

function daysLeft(until: number): number {
  return Math.max(0, Math.ceil((until - Date.now()) / DAY));
}

function caption(item: TrashItem): string {
  if (item.phase === 'recovering') return 'Recovering…';
  if (item.phase === 'archive') {
    const months = Math.max(1, Math.round(daysLeft(item.purgeAt) / 30));
    return `${months} mo left`;
  }
  const days = daysLeft(item.trashUntil);
  return days <= 1 ? 'Last day' : `${days} days`;
}

export default function TrashScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const trash = useStore((s) => s.trash);
  const loading = useStore((s) => s.trashLoading);
  const [tab, setTab] = useState<Tab>('trash');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void refreshTrash();
  }, []);

  const items = useMemo(
    () => trash.filter((t) => (tab === 'trash' ? t.phase === 'trash' : t.phase !== 'trash')),
    [trash, tab],
  );
  const counts = useMemo(
    () => ({ trash: trash.filter((t) => t.phase === 'trash').length, archive: trash.filter((t) => t.phase !== 'trash').length }),
    [trash],
  );

  const contentWidth = Math.min(width, MAX_WIDTH);
  const columns = Math.max(3, Math.round(contentWidth / 120));
  const tile = (contentWidth - GAP * (columns - 1)) / columns;

  const act = async (item: TrashItem) => {
    if (busy) return;
    if (item.phase === 'recovering') {
      notify('On its way back', 'Recovering from the Archive takes about 12 hours. It will appear in your gallery when it’s ready.');
      return;
    }
    const archived = item.phase === 'archive';
    const choice = await chooseAction(
      archived ? 'In the Archive' : 'In Trash',
      archived
        ? 'Recovering brings back the full-quality original. It takes about 12 hours.'
        : `Restore it to your library, or delete it for good. It moves to the Archive in ${daysLeft(item.trashUntil)} days.`,
      [
        { value: 'restore', label: archived ? 'Recover (about 12 hours)' : 'Restore' },
        { value: 'forever', label: 'Delete forever', destructive: true },
      ],
    );
    if (!choice) return;
    if (choice === 'forever') {
      const ok = await confirmDestructive(
        'Delete forever?',
        'Every copy is removed from the cloud. This can’t be undone, even by recovering from the Archive.',
        'Delete forever',
      );
      if (!ok) return;
    }
    setBusy(item.id);
    try {
      if (choice === 'forever') {
        await deleteForever(item.id);
      } else {
        const phase = await restoreItem(item.id);
        notify(
          phase === 'restored' ? 'Restored' : 'Recovery started',
          phase === 'restored' ? 'It’s back in your gallery.' : 'It will be back in your gallery in about 12 hours.',
        );
      }
    } catch (error) {
      notify('Something went wrong', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Deleted</Text>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>

      <View style={styles.tabs}>
        {(['trash', 'archive'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tab, tab === t && styles.tabOn]}
            accessibilityState={{ selected: tab === t }}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
              {t === 'trash' ? 'Trash' : 'Archive'}
              {counts[t] ? ` (${counts[t]})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.explain}>
        {tab === 'trash'
          ? 'Deleted items stay here for 30 days. Restore is instant. After that they move to the Archive.'
          : 'Kept for a year after the Trash. Recovering brings back the full-quality original in about 12 hours.'}
      </Text>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, width: contentWidth, alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshTrash} tintColor="#fff" />}
      >
        {items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name={tab === 'trash' ? 'trash-outline' : 'archive-outline'} size={40} color="#636366" />
            <Text style={styles.emptyText}>{loading ? 'Loading…' : tab === 'trash' ? 'Trash is empty' : 'Nothing in the Archive'}</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {items.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => act(item)}
                style={{ width: tile, height: tile }}
                accessibilityLabel={`${item.kind}, ${caption(item)}`}
              >
                <Image
                  source={item.thumbUrl ? { uri: item.thumbUrl } : undefined}
                  style={[StyleSheet.absoluteFill, { opacity: item.phase === 'trash' ? 1 : 0.6, backgroundColor: '#1C1C1E' }]}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
                {item.kind === 'video' && <Ionicons name="videocam" size={14} color="#fff" style={styles.videoMark} />}
                <View style={styles.caption}>
                  <Ionicons
                    name={item.phase === 'recovering' ? 'time-outline' : item.phase === 'archive' ? 'archive-outline' : 'trash-outline'}
                    size={11}
                    color="#fff"
                  />
                  <Text style={styles.captionText}>{busy === item.id ? 'Working…' : caption(item)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 56 },
  title: { color: '#fff', fontSize: 34, fontWeight: '700', letterSpacing: -1 },
  done: { color: colors.link, fontSize: 17, fontWeight: '600' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 4 },
  tab: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#2C2C2E', minHeight: 36, justifyContent: 'center' },
  tabOn: { backgroundColor: colors.text },
  tabText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  tabTextOn: { color: '#000' },
  explain: { color: '#86868B', fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingVertical: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  empty: { alignItems: 'center', gap: 10, paddingTop: 80 },
  emptyText: { color: colors.muted, fontSize: 15 },
  videoMark: { position: 'absolute', top: 6, right: 6 },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  captionText: { color: '#fff', fontSize: 11, fontWeight: '600' },
});
