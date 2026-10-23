// The roll's Lens Plus card at a natural moment (src/lib/plus-prompt-rules.ts decides when).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/Text';
import { markPlusShown, PlusReason } from '@/lib/plus-prompt';
import { palette } from '@/lib/theme';
import { track } from '@/lib/usage';

const COPY: Record<PlusReason, { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }> = {
  storage95: { icon: 'alert-circle-outline', title: 'Lens storage is almost full', body: 'New backups pause soon. Lens Plus gives you 50 GB, from ₹59 a month.' },
  storage80: { icon: 'pie-chart-outline', title: '80% of your Lens storage is used', body: 'Lens Plus gives you 50 GB in full quality, from ₹59 a month.' },
  welcome: { icon: 'calendar-outline', title: 'Your welcome storage ends this week', body: 'Lock in Lens Plus now: ₹0 today, and backups never pause.' },
  backups20: { icon: 'shield-checkmark-outline', title: '20 photos safe in full quality', body: 'Keep it that way after your welcome: lock in Lens Plus, ₹0 today.' },
  recap: { icon: 'film-outline', title: 'Keep every trip in full quality', body: 'Lens Plus gives you 50 GB for every photo and video.' },
};

export function PlusOffer({ reason, onClose }: { reason: PlusReason; onClose: () => void }) {
  useEffect(() => {
    markPlusShown(reason);
    track(`plus_card_${reason}`);
  }, [reason]);
  const c = COPY[reason];
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Ionicons name={c.icon} size={18} color={palette.link} />
        <Text style={styles.title}>{c.title}</Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Not now">
          <Ionicons name="close" size={16} color="#86868B" />
        </Pressable>
      </View>
      <Text style={styles.body}>{c.body}</Text>
      <Pressable
        style={styles.button}
        onPress={() => {
          onClose();
          router.push(`/plus?from=${reason}` as never);
        }}
        accessibilityRole="button"
      >
        <Text style={styles.buttonText}>See Lens Plus</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 8, marginBottom: 4, padding: 14, borderRadius: 16, backgroundColor: palette.surface, gap: 8 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: palette.text, fontSize: 15, fontWeight: '600', flex: 1 },
  body: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  button: { alignSelf: 'flex-start', backgroundColor: palette.link, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 18 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
