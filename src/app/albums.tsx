// Albums: yours, and albums friends shared with you (docs/design/organise-and-share.md).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AlbumPicker } from '@/components/AlbumPicker';
import { Text } from '@/components/ui/Text';
import { Album, api, SharedAlbum } from '@/lib/api';
import { palette } from '@/lib/theme';
import { colors, errorMessage, notify } from '@/lib/ui';
import { who } from '@/lib/names';

export default function AlbumsScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [shared, setShared] = useState<SharedAlbum[]>([]);
  const [creating, setCreating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      api.albums().then(
        (r) => {
          if (!alive) return;
          setAlbums(r.albums);
          setShared(r.shared);
        },
        (error) => {
          if (!alive) return;
          setAlbums([]);
          notify('Could not load albums', errorMessage(error));
        },
      );
      return () => {
        alive = false;
      };
    }, []),
  );

  const content = Math.min(width, 900);
  const cols = content >= 700 ? 4 : 2;
  const card = Math.floor((content - 32 - (cols - 1) * 12) / cols);

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.link} />
        </Pressable>
        <Text style={styles.title}>Albums</Text>
        <Pressable onPress={() => setCreating(true)} hitSlop={10} style={styles.headerButton} accessibilityLabel="New album">
          <Ionicons name="add" size={28} color={colors.link} />
        </Pressable>
      </View>
      {albums === null ? (
        <ActivityIndicator color={palette.text} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, width: content, alignSelf: 'center' }}>
          {albums.length === 0 && shared.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="albums-outline" size={52} color={palette.surface3} />
              <Text style={styles.emptyTitle}>No albums yet</Text>
              <Text style={styles.emptyBody}>Group a trip, a party or a person. In the roll, hold a photo, pick more, then “Add to album”. Share a whole album in one go.</Text>
              <Pressable style={styles.primary} onPress={() => setCreating(true)}>
                <Text style={styles.primaryText}>New album</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.grid}>
            {albums.map((a) => (
              <Pressable key={a.id} style={{ width: card }} onPress={() => router.push({ pathname: '/album/[id]', params: { id: a.id } })} accessibilityRole="button">
                <View style={[styles.cover, { width: card, height: card }]}>
                  {a.cover?.thumbUrl ? <Image source={{ uri: a.cover.thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : <Ionicons name="images-outline" size={32} color="#48484A" />}
                </View>
                <Text style={styles.name} numberOfLines={1}>
                  {a.name}
                </Text>
                <Text style={styles.count}>
                  {a.count} item{a.count === 1 ? '' : 's'}
                </Text>
              </Pressable>
            ))}
          </View>
          {shared.length > 0 ? (
            <>
              <Text style={styles.section}>Shared with you</Text>
              {shared.map((s) => (
                <Pressable key={`${s.ownerId}-${s.id}`} style={styles.sharedRow} onPress={() => router.push({ pathname: '/album/[id]', params: { id: s.id, owner: s.ownerId, name: s.name, ownerName: who({ name: s.ownerName, realName: s.ownerRealName }), ...(s.event ? { event: '1' } : {}) } })}>
                  <Ionicons name="people-outline" size={22} color="#86868B" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.count}>from {who({ name: s.ownerName, realName: s.ownerRealName })}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#636366" />
                </Pressable>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}
      <AlbumPicker
        visible={creating}
        count={0}
        onClose={() => setCreating(false)}
        onPick={async (choice) => {
          if ('newName' in choice) {
            const { album } = await api.createAlbum(choice.newName);
            router.push({ pathname: '/album/[id]', params: { id: album.id } });
          } else {
            router.push({ pathname: '/album/[id]', params: { id: choice.id } });
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cover: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  name: { color: '#fff', fontSize: 15, fontWeight: '600', marginTop: 8 },
  count: { color: '#86868B', fontSize: 13, marginTop: 2 },
  section: { color: '#86868B', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', marginTop: 28, marginBottom: 6 },
  sharedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#2C2C2E' },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  emptyBody: { color: '#86868B', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 12 },
  primary: { marginTop: 8, backgroundColor: colors.action, borderRadius: 980, paddingHorizontal: 22, paddingVertical: 12 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
