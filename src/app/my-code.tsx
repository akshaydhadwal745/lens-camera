// "My Lens code": friends scan it in Lens (Send → Scan code) to pick exactly you.
import { router } from 'expo-router';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QrCode } from '@/components/QrCode';
import { personCodeUrl } from '@/lib/person-code';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/ui';

export default function MyCodeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const identity = useStore((s) => s.identity);
  const size = Math.min(width - 96, 300);
  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Close">
          <Text style={styles.headerAction}>Done</Text>
        </Pressable>
        <Text style={styles.title}>My Lens code</Text>
        <View style={styles.headerButton} />
      </View>
      {identity ? (
        <View style={styles.body}>
          <View style={styles.card}>
            <QrCode value={personCodeUrl(identity.id)} size={size} />
          </View>
          <Text style={styles.name}>{identity.name}</Text>
          <Text style={styles.hint}>
            Friends scan this in Lens (Send → Scan code) to share with exactly you. You still choose whether to accept what they send.
          </Text>
        </View>
      ) : (
        <Text style={styles.hint}>Connecting…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 64, justifyContent: 'center' },
  headerAction: { color: colors.link, fontSize: 17 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  body: { alignItems: 'center', paddingTop: 32, paddingHorizontal: 24 },
  card: { padding: 16, backgroundColor: '#fff', borderRadius: 20 },
  name: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 20 },
  hint: { color: '#86868B', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 12, paddingHorizontal: 16 },
});
