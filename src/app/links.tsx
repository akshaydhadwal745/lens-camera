// Settings → Sharing → Share links (docs/features/share-links.md): every link
// you made, whether it still works, how often it was viewed, who opened it in
// Lens; Turn off ends the link and everyone's access to what it shared.
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { api, ShareLink } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { who } from '@/lib/names';
import { palette } from '@/lib/theme';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

const STATUS: Record<ShareLink['status'], string> = { active: 'Works', expired: 'Expired', revoked: 'Turned off', used: 'Opened' };

function what(l: ShareLink): string {
  const parts = [l.photos ? `${l.photos} photo${l.photos === 1 ? '' : 's'}` : '', l.videos ? `${l.videos} video${l.videos === 1 ? '' : 's'}` : ''].filter(Boolean);
  return parts.join(' and ') || `${l.count} items`;
}

export default function LinksScreen() {
  const insets = useSafeAreaInsets();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      api.links().then(
        (r) => setLinks(r.links),
        (error) => {
          setLinks((l) => l ?? []);
          notify('Could not load your links', errorMessage(error));
        },
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const turnOff = async (l: ShareLink) => {
    const opened = l.claims?.length ?? 0;
    const ok = await confirmDestructive(
      'Turn this link off?',
      opened
        ? `The link stops working, and the ${opened === 1 ? 'person' : `${opened} people`} who opened it in Lens lose access to these ${what(l)}.`
        : 'The link stops working at once.',
      'Turn off',
    );
    if (!ok) return;
    setBusy(l.token);
    try {
      await api.revokeLink(l.token);
      await load();
    } catch (error) {
      notify('Could not turn it off', errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Back">
          <Text style={styles.headerAction}>Done</Text>
        </Pressable>
        <Text style={styles.title}>Share links</Text>
        <View style={styles.headerButton} />
      </View>
      {links === null ? (
        <ActivityIndicator color={colors.link} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={links}
          keyExtractor={(l) => l.token}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor="#fff"
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
            />
          }
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="link-outline" size={44} color={palette.surface3} />
              <Text style={styles.emptyTitle}>No links yet</Text>
              <Text style={styles.hint}>Pick photos, tap Share, then “Share by link” to send them to someone without Lens.</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item: l }) => {
            const live = l.status === 'active';
            return (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.name}>{what(l)}</Text>
                  <Text style={[styles.status, live && { color: palette.safe }]}>{STATUS[l.status]}</Text>
                </View>
                <Text style={styles.meta}>
                  {l.mode === 'one' ? 'One person' : 'Anyone with the link'} · {live ? `until ${formatDate(l.expiresAt)}` : `made ${formatDate(l.createdAt)}`}
                  {l.mode === 'anyone' ? ` · viewed ${l.opens}×` : ''}
                  {l.withLocation ? ' · with location' : ''}
                </Text>
                {l.claims?.length ? <Text style={styles.meta}>Opened in Lens by {l.claims.map((c) => who(c)).join(', ')}</Text> : null}
                {live || l.status === 'used' ? (
                  <View style={styles.actions}>
                    {live ? (
                      <Pressable
                        style={styles.action}
                        onPress={() => void Clipboard.setStringAsync(l.url).then(() => notify('Link copied'))}
                        accessibilityRole="button"
                      >
                        <Text style={styles.actionText}>Copy</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={styles.action} onPress={() => void turnOff(l)} disabled={busy !== null} accessibilityRole="button">
                      {busy === l.token ? <ActivityIndicator color={palette.danger} /> : <Text style={[styles.actionText, { color: palette.danger }]}>Turn off</Text>}
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 64, justifyContent: 'center' },
  headerAction: { color: colors.link, fontSize: 17 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  card: { backgroundColor: '#1C1C1E', borderRadius: 18, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  name: { color: '#fff', fontSize: 16, fontWeight: '600', flex: 1 },
  status: { color: '#86868B', fontSize: 13, fontWeight: '600' },
  meta: { color: '#86868B', fontSize: 13, lineHeight: 18, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  action: { minHeight: 36, paddingHorizontal: 16, borderRadius: 980, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, marginTop: 60, gap: 8 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  hint: { color: '#86868B', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
