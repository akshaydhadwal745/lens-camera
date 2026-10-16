// Top of the Shared tab: share requests waiting for you (nothing is shared until
// you accept) and a way to what you've sent (cancel / revoke).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { palette } from '@/lib/theme';
import { colors } from '@/lib/ui';
import { who } from '@/lib/names';

export function SharesStrip() {
  const [pending, setPending] = useState(0);
  const [first, setFirst] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api
        .sharesIn()
        .then((r) => {
          setPending(r.pending);
          const first = r.requests.find((x) => x.status === 'pending');
          setFirst(first ? who(first.from) : null);
        })
        .catch(() => {});
    void load();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void load());
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.wrap}>
      {pending > 0 ? (
        <Pressable style={styles.request} onPress={() => router.push('/shares')} accessibilityRole="button">
          <Ionicons name="mail-unread-outline" size={20} color="#000" />
          <Text style={styles.requestText} numberOfLines={2}>
            {pending === 1 && first ? `${first} wants to share with you` : `${pending} shares waiting for you`}
          </Text>
          <Text style={styles.review}>Review</Text>
        </Pressable>
      ) : null}
      <View style={styles.links}>
        <Pressable onPress={() => router.push('/shares')} hitSlop={8}>
          <Text style={styles.link}>Requests</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/shares/sent')} hitSlop={8}>
          <Text style={styles.link}>Sent</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  request: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.accent, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  requestText: { flex: 1, color: '#000', fontSize: 15, fontWeight: '600' },
  review: { color: '#000', fontSize: 15, fontWeight: '700' },
  links: { flexDirection: 'row', gap: 20, justifyContent: 'flex-end' },
  link: { color: colors.link, fontSize: 15 },
});
