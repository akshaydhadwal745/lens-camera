// Places: your photos grouped by where you took them (nearest city), from the
// position the camera saves when "Save location" is on. Only you see this:
// people you share with don't get it (docs/design/organise-and-share.md).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { api, PlaceGroup } from '@/lib/api';
import { saveLocationOn, setSaveLocation } from '@/lib/location-pref';
import { placeLine } from '@/lib/places';
import { backfillPlaces } from '@/lib/store';
import { palette } from '@/lib/theme';
import { colors, errorMessage, notify } from '@/lib/ui';

function dateRange(first: number, last: number): string {
  const f = new Date(first);
  const l = new Date(last);
  const fmt = (d: Date, year: boolean) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
  if (f.toDateString() === l.toDateString()) return fmt(l, true);
  return `${fmt(f, f.getFullYear() !== l.getFullYear())} – ${fmt(l, true)}`;
}

export default function PlacesScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [places, setPlaces] = useState<PlaceGroup[] | null>(null);
  const [locationOn, setLocationOn] = useState(saveLocationOn);

  useEffect(() => {
    let alive = true;
    // Photos uploaded before Places existed: send their positions once, then load.
    backfillPlaces()
      .catch(() => 0)
      .then(() => api.places())
      .then(
        (r) => alive && setPlaces(r.places),
        (error) => {
          if (!alive) return;
          setPlaces([]);
          notify('Could not load places', errorMessage(error));
        },
      );
    return () => {
      alive = false;
    };
  }, []);

  const content = Math.min(width, 900);
  const cols = content >= 700 ? 3 : 2;
  const card = Math.floor((content - 32 - (cols - 1) * 12) / cols);

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.link} />
        </Pressable>
        <Text style={styles.title}>Places</Text>
        <View style={styles.headerButton} />
      </View>
      {places === null ? (
        <ActivityIndicator color={palette.text} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, width: content, alignSelf: 'center' }}>
          {places.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="location-outline" size={52} color={palette.surface3} />
              <Text style={styles.emptyTitle}>{locationOn ? 'No places yet' : 'See your photos by place'}</Text>
              <Text style={styles.emptyBody}>
                {locationOn
                  ? 'New photos show up here grouped by city. Only you see where they were taken: people you share with get photos without the location.'
                  : 'Lens can group your photos by city. It needs the location saved in each photo, which is off. Only you see it: people you share with get photos without the location.'}
              </Text>
              {!locationOn ? (
                <Pressable style={styles.primary} onPress={async () => setLocationOn(await setSaveLocation(true))}>
                  <Text style={styles.primaryText}>Save location in new photos</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.grid}>
              {places.map((p) => (
                <Pressable key={p.key} style={{ width: card }} onPress={() => router.push({ pathname: '/place/[key]', params: { key: p.key, city: p.city } })} accessibilityRole="button">
                  <View style={[styles.cover, { width: card, height: card * 0.75 }]}>
                    {p.cover.thumbUrl ? <Image source={{ uri: p.cover.thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                  </View>
                  <Text style={styles.name} numberOfLines={1}>
                    {p.city}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {placeLine(p)}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {p.count} item{p.count === 1 ? '' : 's'} · {dateRange(p.first, p.last)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cover: { borderRadius: 14, overflow: 'hidden', backgroundColor: '#1C1C1E' },
  name: { color: '#fff', fontSize: 15, fontWeight: '600', marginTop: 8 },
  meta: { color: '#86868B', fontSize: 12, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  emptyBody: { color: '#86868B', fontSize: 14, lineHeight: 20, textAlign: 'center', paddingHorizontal: 12 },
  primary: { marginTop: 8, backgroundColor: colors.action, borderRadius: 980, paddingHorizontal: 22, paddingVertical: 12 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
