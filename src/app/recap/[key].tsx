// One recap: preview every photo Lens picked, untick any you don't want, then
// save it as an album and/or make a film (rendered in the cloud from the
// photos' previews: a couple of minutes, no heat on the phone). Nothing is shared.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { api, Recap } from '@/lib/api';
import { markRecapSeen } from '@/lib/plus-prompt';
import { refreshRemote } from '@/lib/store';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

const GAP = 3;

export default function RecapScreen() {
  useEffect(() => markRecapSeen(), []);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { key } = useLocalSearchParams<{ key: string }>();
  const [recap, setRecap] = useState<Recap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.recap(key).then(
      (r) => setRecap(r.recap),
      (e) => setError(errorMessage(e)),
    );
  }, [key]);
  useEffect(load, [load]);

  // A film being made: look again every 10 s until it's in the roll.
  const rendering = recap?.film.status === 'rendering';
  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [rendering, load]);
  useEffect(() => {
    if (recap?.film.status === 'ready') void refreshRemote().catch(() => {});
  }, [recap?.film.status]);

  const items = useMemo(() => (recap?.items ?? []).filter((m): m is NonNullable<typeof m> => !!m), [recap]);
  const film = useMemo(() => new Set(recap?.filmIds ?? []), [recap]);
  const kept = items.filter((m) => !off.has(m.id)).map((m) => m.id);
  const keptFilm = kept.filter((id) => film.has(id));

  const cols = width >= 700 ? 5 : 3;
  const content = Math.min(width, 900);
  const tile = Math.floor((content - (cols - 1) * GAP) / cols);

  const toggle = (id: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (work: () => Promise<void>, failed: string) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      notify(failed, errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveAlbum = () =>
    run(async () => {
      const { albumId } = await api.recapAlbum(key, kept);
      notify('Saved as an album', `“${recap!.title}”, ${kept.length} items. Your photos stay where they are.`);
      router.push({ pathname: '/album/[id]', params: { id: albumId } });
    }, 'Could not save the album');

  const makeFilm = () =>
    run(async () => {
      await api.recapFilm(key, keptFilm);
      notify('Making your film', 'A couple of minutes. It appears in your roll, next to these photos.');
      load();
    }, 'Could not start the film');

  const dismiss = async () => {
    const ok = await confirmDestructive('Hide this recap?', 'It won’t be suggested again. Your photos aren’t touched.', 'Hide');
    if (!ok) return;
    await run(async () => {
      await api.dismissRecap(key);
      router.back();
    }, 'Could not hide it');
  };

  const f = recap?.film;

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.link} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {recap?.title ?? 'Recap'}
        </Text>
        <View style={styles.headerButton}>{busy ? <ActivityIndicator color={colors.link} /> : null}</View>
      </View>
      {error ? (
        <Text style={styles.empty}>{error}</Text>
      ) : !recap ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          key={cols}
          numColumns={cols}
          keyExtractor={(m) => m.id}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + 140, width: content, alignSelf: 'center' }}
          ListHeaderComponent={
            <View style={styles.intro}>
              <Text style={styles.sub}>
                {kept.length} of {items.length} kept · {keptFilm.length} in the film. Tap a photo to leave it out.
              </Text>
              {f?.status === 'ready' ? (
                <Pressable style={styles.filmReady} onPress={() => router.push({ pathname: '/viewer/[id]', params: { id: f.media.id, source: 'mine' } })}>
                  <Ionicons name="play-circle" size={22} color="#fff" />
                  <Text style={styles.filmReadyText}>Watch the film (in your roll)</Text>
                </Pressable>
              ) : f?.status === 'rendering' ? (
                <View style={styles.filmReady}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.filmReadyText}>Making the film… (it lands in your roll)</Text>
                </View>
              ) : f?.status === 'failed' ? (
                <Text style={[styles.sub, { color: '#FF453A' }]}>The film didn’t finish. Try again.</Text>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const out = off.has(item.id);
            return (
              <Pressable onPress={() => toggle(item.id)} style={{ width: tile, height: tile }} accessibilityLabel={out ? 'Left out: tap to keep' : 'Kept: tap to leave out'}>
                {item.thumbUrl ? <Image source={{ uri: item.thumbUrl }} style={[{ flex: 1 }, out && { opacity: 0.25 }]} contentFit="cover" /> : <View style={{ flex: 1, backgroundColor: '#1C1C1E' }} />}
                {film.has(item.id) && !out ? <Ionicons name="film-outline" size={14} color="#fff" style={styles.badge} /> : null}
                {out ? <Ionicons name="close-circle" size={20} color="#fff" style={styles.badge} /> : null}
              </Pressable>
            );
          }}
        />
      )}
      {recap ? (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[styles.button, styles.primary, (busy || !kept.length) && { opacity: 0.4 }]}
            disabled={busy || !kept.length}
            onPress={() => (recap.albumId ? router.push({ pathname: '/album/[id]', params: { id: recap.albumId } }) : void saveAlbum())}
          >
            <Text style={styles.buttonText}>{recap.albumId ? 'Open album' : 'Save as album'}</Text>
          </Pressable>
          <Pressable
            style={[styles.button, (busy || keptFilm.length < 2 || f?.status === 'rendering' || f?.status === 'ready') && { opacity: 0.4 }]}
            disabled={busy || keptFilm.length < 2 || f?.status === 'rendering' || f?.status === 'ready'}
            onPress={() => void makeFilm()}
          >
            <Text style={styles.buttonText}>{f?.status === 'ready' ? 'Film made' : 'Make film'}</Text>
          </Pressable>
          <Pressable style={styles.hide} onPress={() => void dismiss()} disabled={busy} accessibilityLabel="Hide this recap">
            <Ionicons name="eye-off-outline" size={20} color="#86868B" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  intro: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  sub: { color: '#86868B', fontSize: 13, lineHeight: 18 },
  empty: { color: '#86868B', fontSize: 14, lineHeight: 20, padding: 32, textAlign: 'center' },
  filmReady: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1C1C1E', borderRadius: 14, padding: 12 },
  filmReadyText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  badge: { position: 'absolute', right: 6, top: 6 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.92)' },
  button: { flex: 1, minHeight: 50, borderRadius: 980, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.action },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hide: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
