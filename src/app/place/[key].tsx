// One place: its photos, newest first (owner only).
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MediaTile } from '@/components/MediaTile';
import { Text } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { selectGallery, useStore } from '@/lib/store';
import { palette } from '@/lib/theme';
import type { GalleryItem } from '@/lib/types';
import { colors, errorMessage, notify } from '@/lib/ui';

const GAP = 3;

export default function PlaceScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { key, city } = useLocalSearchParams<{ key: string; city?: string }>();
  const gallery = useStore(selectGallery);
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    api.placeItems(key).then(
      (r) => setIds(r.items.map((m) => m.id)),
      (error) => {
        setIds([]);
        notify('Could not load this place', errorMessage(error));
      },
    );
  }, [key]);

  const items = useMemo<GalleryItem[] | null>(() => {
    if (!ids) return null;
    const byId = new Map(gallery.map((g) => [g.id, g]));
    return ids.map((id) => byId.get(id)).filter((g): g is GalleryItem => !!g);
  }, [ids, gallery]);

  const content = Math.min(width, 900);
  const cols = content >= 700 ? 5 : 3;
  const tile = Math.floor((content - (cols - 1) * GAP) / cols);

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.link} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {city ?? 'Place'}
        </Text>
        <View style={styles.headerButton} />
      </View>
      {items === null ? (
        <ActivityIndicator color={palette.text} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          key={cols}
          numColumns={cols}
          keyExtractor={(g) => g.id}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + 40, width: content, alignSelf: 'center' }}
          renderItem={({ item }) => (
            <MediaTile item={item} size={tile} selecting={false} selected={false} onPress={(g) => router.push({ pathname: '/viewer/[id]', params: { id: g.id, source: 'mine' } })} onLongPress={() => {}} />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#fff', fontSize: 17, fontWeight: '700' },
});
