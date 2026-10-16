// Review one share request: who sent it and what (small thumbnails only; from
// someone new they stay hidden until "Show previews"), then Accept / Decline /
// Block. Nothing is shared until Accept (docs/design/sharing-consent.md).
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { STATUS_LABEL, whatText } from '@/components/SharesList';
import { Text } from '@/components/ui/Text';
import { api, ShareRequest } from '@/lib/api';
import { refreshShared } from '@/lib/store';
import { palette } from '@/lib/theme';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';
import { handleOf, who } from '@/lib/names';

export default function ShareRequestScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [r, setR] = useState<ShareRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [always, setAlways] = useState(false);
  const [busy, setBusy] = useState<'accept' | 'decline' | 'previews' | null>(null);

  useEffect(() => {
    api.shareRequest(id).then(setR, (e) => setError(errorMessage(e)));
  }, [id]);

  const showPreviews = async () => {
    setBusy('previews');
    try {
      setR(await api.shareRequest(id, true));
    } catch (e) {
      notify('Could not load previews', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const accept = async () => {
    if (!r) return;
    setBusy('accept');
    try {
      const res = await api.acceptShare(r.shareId, always);
      // The Shared tab reads the store: load the new items before going there.
      await refreshShared();
      notify('Accepted', `${res.count} item${res.count === 1 ? '' : 's'} from ${who(r.from)} ${res.count === 1 ? 'is' : 'are'} in your Shared tab.`);
      router.replace({ pathname: '/gallery', params: { tab: 'shared' } });
    } catch (e) {
      notify('Could not accept', errorMessage(e));
      setBusy(null);
    }
  };

  const decline = async (block: boolean) => {
    if (!r) return;
    if (block) {
      const ok = await confirmDestructive(
        `Block ${who(r.from)}?`,
        `You won't get shares from ${who(r.from)} again. They aren't told. You can unblock later.`,
        'Decline and block',
      );
      if (!ok) return;
    }
    setBusy('decline');
    try {
      await api.declineShare(r.shareId, block);
      router.back();
    } catch (e) {
      notify('Could not decline', errorMessage(e));
      setBusy(null);
    }
  };

  const cols = width >= 700 ? 6 : 4;
  const tile = Math.floor((Math.min(width, 900) - 32 - (cols - 1) * 4) / cols);
  const pending = r?.status === 'pending';

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={colors.link} />
        </Pressable>
        <Text style={styles.title}>Share request</Text>
        <View style={styles.headerButton} />
      </View>
      {!r ? (
        error ? <Text style={styles.note}>{error}</Text> : <ActivityIndicator color={palette.text} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 140, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
          <Text style={styles.headline}>
            {who(r.from)} wants to share {whatText(r)} with you
          </Text>
          <Text style={styles.meta}>
            {handleOf(r.from) ? `${handleOf(r.from)} · ` : ''}
            {r.from.account ? 'Signed-in account' : 'Guest phone'} · {r.knownSender ? 'You accepted from them before' : 'First time sharing with you'}
          </Text>
          {!pending ? <Text style={[styles.note, { color: palette.accent }]}>{STATUS_LABEL[r.status]}</Text> : null}

          {pending && r.thumbs ? (
            <View style={styles.grid}>
              {r.thumbs.map((t) => (
                <View key={t.id} style={{ width: tile, height: tile, borderRadius: 6, overflow: 'hidden', backgroundColor: '#1C1C1E' }}>
                  {t.thumbUrl ? <Image source={{ uri: t.thumbUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                  {t.kind === 'video' ? <Ionicons name="videocam" size={14} color="#fff" style={styles.videoMark} /> : null}
                </View>
              ))}
              {r.count > r.thumbs.length ? <Text style={styles.meta}>+{r.count - r.thumbs.length} more</Text> : null}
            </View>
          ) : pending ? (
            <View style={styles.hidden}>
              <Ionicons name="eye-off-outline" size={28} color="#86868B" />
              <Text style={styles.hiddenText}>Previews are hidden because this is someone new. Look only if you expect photos from {who(r.from)}.</Text>
              <Pressable style={styles.secondary} onPress={() => void showPreviews()} disabled={busy !== null}>
                {busy === 'previews' ? <ActivityIndicator color="#fff" /> : <Text style={styles.secondaryText}>Show previews</Text>}
              </Pressable>
            </View>
          ) : null}

          {pending ? (
            <View style={styles.alwaysRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.alwaysTitle}>Always accept from {who(r.from)}</Text>
                <Text style={styles.meta}>Their next shares go straight to your Shared tab (you can turn this off later).</Text>
              </View>
              <Switch value={always} onValueChange={setAlways} />
            </View>
          ) : null}
        </ScrollView>
      )}
      {pending ? (
        <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable style={[styles.button, styles.declineButton]} onPress={() => void decline(false)} disabled={busy !== null}>
            {busy === 'decline' ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Decline</Text>}
          </Pressable>
          <Pressable style={[styles.button, styles.acceptButton]} onPress={() => void accept()} disabled={busy !== null}>
            {busy === 'accept' ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Accept</Text>}
          </Pressable>
          <Pressable onPress={() => void decline(true)} disabled={busy !== null} hitSlop={8} style={styles.blockLink}>
            <Text style={styles.blockText}>Decline and block {who(r?.from, '')}</Text>
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
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  headline: { color: '#fff', fontSize: 22, fontWeight: '700', lineHeight: 28 },
  meta: { color: '#86868B', fontSize: 13, marginTop: 6, lineHeight: 18 },
  note: { color: '#86868B', fontSize: 15, marginTop: 16, paddingHorizontal: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 20, alignItems: 'center' },
  videoMark: { position: 'absolute', right: 4, bottom: 4 },
  hidden: { marginTop: 24, padding: 20, borderRadius: 16, backgroundColor: '#1C1C1E', alignItems: 'center', gap: 12 },
  hiddenText: { color: '#C7C7CC', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  secondary: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 980, backgroundColor: '#2C2C2E', minWidth: 140, alignItems: 'center' },
  secondaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  alwaysRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24, padding: 16, borderRadius: 16, backgroundColor: '#1C1C1E' },
  alwaysTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: 'rgba(0,0,0,0.92)', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { flex: 1, minHeight: 50, borderRadius: 980, alignItems: 'center', justifyContent: 'center' },
  declineButton: { backgroundColor: '#2C2C2E' },
  acceptButton: { backgroundColor: colors.action },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  blockLink: { width: '100%', alignItems: 'center', paddingVertical: 6 },
  blockText: { color: palette.danger, fontSize: 14 },
});
