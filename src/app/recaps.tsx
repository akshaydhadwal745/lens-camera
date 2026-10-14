// Recaps (docs/design/switch-features.md §4): trips and events Lens found in
// your roll. Nothing is saved or shared on its own: open one to preview, then
// save it as an album and/or make a short film (made in the cloud, so the
// phone stays cool), or dismiss it.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { api, Recap } from '@/lib/api';
import { colors, errorMessage } from '@/lib/ui';

export default function RecapsScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [recaps, setRecaps] = useState<Recap[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api.recaps().then(
        (r) => {
          setRecaps(r.recaps);
          setError(null);
        },
        (e) => setError(errorMessage(e)),
      );
    }, []),
  );

  const card = Math.min(width, 700) - 32;

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.link} />
        </Pressable>
        <Text style={styles.title}>Recaps</Text>
        <View style={styles.headerButton} />
      </View>
      {error ? (
        <Text style={styles.empty}>{error}</Text>
      ) : recaps === null ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={recaps}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: insets.bottom + 32, width: Math.min(width, 700), alignSelf: 'center' }}
          ListHeaderComponent={
            <Text style={styles.lead}>Trips and events Lens found in your roll. Open one to keep it as an album or a short film. Nothing is shared.</Text>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              Nothing yet. After a trip, or a day with lots of photos (a wedding, a party), a recap shows up here.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push({ pathname: '/recap/[key]', params: { key: item.key } })} style={[styles.card, { width: card }]} accessibilityRole="button">
              {item.cover?.previewUrl || item.cover?.thumbUrl ? (
                <Image source={{ uri: item.cover.previewUrl ?? item.cover.thumbUrl }} style={{ width: card, height: card * 0.6 }} contentFit="cover" />
              ) : (
                <View style={{ width: card, height: card * 0.6, backgroundColor: '#1C1C1E' }} />
              )}
              <View style={styles.cardText}>
                <Text style={styles.kicker}>{item.kind === 'trip' ? 'TRIP' : 'EVENT'}</Text>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardSub}>
                  {item.count} items
                  {item.film.status === 'ready' ? ' · film in your roll' : item.film.status === 'rendering' ? ' · making the film…' : ''}
                  {item.albumId ? ' · saved as album' : ''}
                </Text>
              </View>
            </Pressable>
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
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  lead: { color: '#86868B', fontSize: 14, lineHeight: 20, marginBottom: 4 },
  empty: { color: '#86868B', fontSize: 14, lineHeight: 20, padding: 32, textAlign: 'center' },
  card: { borderRadius: 20, overflow: 'hidden', backgroundColor: '#1C1C1E' },
  cardText: { padding: 16, gap: 4 },
  kicker: { color: '#FACC15', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  cardTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  cardSub: { color: '#86868B', fontSize: 13 },
});
