// Settings → Sharing → Blocked people (docs/design/sharing-consent.md): who you
// blocked (Review → "Decline and block"), with Unblock. Blocked people's shares
// never reach you and they never show as nearby or as a People suggestion.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { api, BlockedPerson } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

export default function BlockedScreen() {
  const insets = useSafeAreaInsets();
  const [people, setPeople] = useState<BlockedPerson[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.blocked().then(
      (r) => setPeople(r.blocked),
      (error) => {
        setPeople([]);
        notify('Could not load blocked people', errorMessage(error));
      },
    );
  }, []);
  useEffect(load, [load]);

  const unblock = async (p: BlockedPerson) => {
    const name = p.name ?? 'this person';
    if (!(await confirmDestructive(`Unblock ${name}?`, 'They can send you share requests again. You still accept each one.', 'Unblock'))) return;
    setBusy(p.id);
    try {
      await api.setBlocked(p.id, false);
      setPeople((list) => list?.filter((x) => x.id !== p.id) ?? null);
      notify(`${name} unblocked`);
    } catch (error) {
      notify('Could not unblock', errorMessage(error));
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
        <Text style={styles.title}>Blocked people</Text>
        <View style={styles.headerButton} />
      </View>
      {people === null ? (
        <ActivityIndicator color={colors.link} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No one is blocked</Text>
              <Text style={styles.hint}>When you decline a share with “Decline and block”, that person shows up here and you can unblock them.</Text>
            </View>
          }
          ListFooterComponent={
            people.length ? (
              <Text style={[styles.hint, { marginTop: 14 }]}>Blocked people can’t send you shares, don’t see you nearby and aren’t suggested by People. They aren’t told.</Text>
            ) : null
          }
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.name ?? 'Deleted account'}
                </Text>
                {item.at ? <Text style={styles.meta}>Blocked {formatDate(item.at)}</Text> : null}
              </View>
              <Pressable onPress={() => void unblock(item)} disabled={busy !== null} style={styles.button} accessibilityRole="button">
                {busy === item.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Unblock</Text>}
              </Pressable>
            </View>
          )}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#1C1C1E' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#2C2C2E' },
  name: { color: '#fff', fontSize: 16, fontWeight: '600' },
  meta: { color: '#86868B', fontSize: 13, marginTop: 2 },
  button: { minHeight: 36, minWidth: 92, paddingHorizontal: 16, borderRadius: 980, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, marginTop: 60 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  hint: { color: '#86868B', fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
