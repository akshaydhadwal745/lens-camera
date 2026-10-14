// An event album link (lens.instagrowapp.com/e/<code>, from a QR code or a chat):
// what the album is, a peek at its photos, and Join. Joining is your consent:
// you then see everyone's photos and can add yours (docs/design/switch-features.md §3).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { api, EventInfo } from '@/lib/api';
import { refreshShared, useStore } from '@/lib/store';
import { colors, errorMessage, notify } from '@/lib/ui';

const GAP = 3;

export default function EventScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { code } = useLocalSearchParams<{ code: string }>();
  const identity = useStore((s) => s.identity);
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!identity) return;
    api.eventInfo(code).then(setInfo, (e) => setError(errorMessage(e)));
  }, [code, identity]);

  const open = (r: { albumId: string; ownerId: string; name: string }, isOwner: boolean) => {
    if (isOwner) router.replace({ pathname: '/album/[id]', params: { id: r.albumId, name: r.name } });
    else router.replace({ pathname: '/album/[id]', params: { id: r.albumId, owner: r.ownerId, name: r.name, ownerName: info?.event.ownerName, event: '1' } });
  };

  const join = async () => {
    if (!info) return;
    setBusy(true);
    try {
      const r = await api.joinEvent(code);
      await refreshShared();
      open(r, info.event.isOwner);
    } catch (e) {
      notify('Could not join', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cols = 4;
  const content = Math.min(width, 700);
  const tile = Math.floor((content - (cols - 1) * GAP) / cols);
  const e = info?.event;

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} style={styles.headerButton} accessibilityLabel="Close">
          <Ionicons name="close" size={26} color={colors.link} />
        </Pressable>
      </View>
      {error ? (
        <View style={styles.center}>
          <Text style={styles.lead}>This link doesn’t work</Text>
          <Text style={styles.hint}>{error}. Ask whoever shared it for a new one.</Text>
        </View>
      ) : !e ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={info!.items}
          numColumns={cols}
          keyExtractor={(i) => i.id}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={{ gap: GAP, paddingBottom: insets.bottom + 120, width: content, alignSelf: 'center' }}
          ListHeaderComponent={
            <View style={styles.intro}>
              <Text style={styles.kicker}>EVENT ALBUM</Text>
              <Text style={styles.name}>{e.name}</Text>
              <Text style={styles.hint}>
                By {e.ownerName} · {e.count} {e.count === 1 ? 'item' : 'items'} · {e.people} {e.people === 1 ? 'person' : 'people'}
              </Text>
              <Text style={styles.small}>
                {e.joined || e.isOwner
                  ? 'You’re in. Open it to see everything and add your photos.'
                  : 'Join to see every photo in full quality and add yours. Your photos stay yours: remove them, or leave, any time.'}
              </Text>
            </View>
          }
          ListEmptyComponent={<Text style={[styles.small, { textAlign: 'center', marginTop: 20 }]}>No photos yet. Be the first to add some.</Text>}
          renderItem={({ item }) => (
            <View style={{ width: tile, height: tile, backgroundColor: '#1C1C1E' }}>
              {item.thumbUrl ? <Image source={{ uri: item.thumbUrl }} style={{ flex: 1 }} contentFit="cover" /> : null}
              {item.kind === 'video' ? <Ionicons name="play" size={16} color="#fff" style={styles.play} /> : null}
            </View>
          )}
        />
      )}
      {e ? (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable
            style={[styles.join, busy && { opacity: 0.6 }]}
            disabled={busy}
            onPress={() => (e.joined || e.isOwner ? open({ albumId: e.albumId, ownerId: e.ownerId, name: e.name }, e.isOwner) : void join())}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.joinText}>{e.joined || e.isOwner ? 'Open album' : 'Join and add photos'}</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 44, justifyContent: 'center' },
  center: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 60 },
  intro: { paddingHorizontal: 20, paddingBottom: 16 },
  kicker: { color: '#FACC15', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  name: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 6 },
  lead: { color: '#fff', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  hint: { color: '#86868B', fontSize: 14, lineHeight: 20, marginTop: 6 },
  small: { color: '#AEAEB2', fontSize: 14, lineHeight: 20, marginTop: 12 },
  play: { position: 'absolute', right: 6, bottom: 6 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.92)' },
  join: { minHeight: 52, borderRadius: 980, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center' },
  joinText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
