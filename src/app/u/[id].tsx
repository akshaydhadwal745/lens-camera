// A friend's "My Lens code" scanned with the phone's own camera (App Link
// /u/<id>, or lens://u/<id> from the website page): shows exactly that person,
// then pick photos → the usual share screen with them already chosen.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RollPicker } from '@/components/RollPicker';
import { Text } from '@/components/ui/Text';
import { api, Person } from '@/lib/api';
import { useStore } from '@/lib/store';
import { colors, errorMessage } from '@/lib/ui';
import { handleOf, who } from '@/lib/names';

const NO_PICKS = new Set<string>();

export default function PersonCodeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const identity = useStore((s) => s.identity);
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const mine = !!identity && identity.id === id;

  useEffect(() => {
    if (!identity || !id || mine) return;
    api.lookupUser(id).then(
      (r) => setPerson(r.user),
      (e) => setError(errorMessage(e)),
    );
  }, [identity, id, mine]);

  const facts = person
    ? [handleOf(person), person.account ? 'Signed-in account' : 'Guest phone', person.sharedBefore ? 'Shared before' : 'New to you'].filter(Boolean).join(' · ')
    : '';

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} style={styles.headerButton} accessibilityLabel="Close">
          <Text style={styles.headerAction}>Close</Text>
        </Pressable>
        <Text style={styles.title}>Lens code</Text>
        <View style={styles.headerButton} />
      </View>
      <View style={styles.body}>
        {mine ? (
          <>
            <Ionicons name="qr-code-outline" size={48} color={colors.muted} />
            <Text style={styles.lead}>This is your own code</Text>
            <Text style={styles.hint}>Friends scan it to share photos with exactly you.</Text>
          </>
        ) : error ? (
          <>
            <Ionicons name="alert-circle-outline" size={48} color={colors.danger} />
            <Text style={styles.lead}>Code not found</Text>
            <Text style={styles.hint}>{error === 'Not found' ? 'This Lens code no longer works. Ask your friend to show it again.' : error}</Text>
          </>
        ) : !person ? (
          <ActivityIndicator color={colors.link} />
        ) : (
          <>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{who(person).slice(0, 1).toUpperCase()}</Text>
            </View>
            <Text style={styles.lead}>{who(person)}</Text>
            <Text style={styles.hint}>{facts}</Text>
            <Pressable style={styles.primary} onPress={() => setPicking(true)} accessibilityRole="button">
              <Text style={styles.primaryText}>Pick photos to share</Text>
            </Pressable>
            <Text style={[styles.hint, { marginTop: 16 }]}>They accept the share before anything reaches them.</Text>
          </>
        )}
      </View>
      {person ? (
        <RollPicker
          visible={picking}
          title={`Share with ${who(person)}`}
          exclude={NO_PICKS}
          max={50}
          onClose={() => setPicking(false)}
          onPick={async (ids) => {
            setPicking(false);
            router.replace({ pathname: '/share', params: { ids: ids.join(','), to: person.id } });
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 64, justifyContent: 'center' },
  headerAction: { color: colors.link, fontSize: 17 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 60 },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 36, fontWeight: '700' },
  lead: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  hint: { color: '#86868B', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  primary: { marginTop: 24, minHeight: 50, paddingHorizontal: 28, borderRadius: 980, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
