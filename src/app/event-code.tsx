// Event album QR (docs/design/switch-features.md §3): guests scan it with any
// camera (or open the link) to see the album, join and add their photos.
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Share, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QrCode } from '@/components/QrCode';
import { Text } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { colors, confirmDestructive, errorMessage, notify } from '@/lib/ui';

export default function EventCodeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ album: string; name?: string; url: string }>();
  const [busy, setBusy] = useState(false);
  const size = Math.min(width - 96, 300);
  const url = params.url;

  const share = () => {
    void Share.share({ message: `Add your photos to “${params.name ?? 'our album'}” on Lens: ${url}` });
  };

  const turnOff = async () => {
    const ok = await confirmDestructive(
      'Turn the link off?',
      'The QR code and link stop working at once. People already in the album stay, and their photos stay.',
      'Turn off',
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api.setEvent(params.album, false);
      router.back();
    } catch (error) {
      notify('Could not turn it off', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerButton} accessibilityLabel="Close">
          <Text style={styles.headerAction}>Done</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {params.name ?? 'Event'}
        </Text>
        <View style={styles.headerButton}>{busy ? <ActivityIndicator color={colors.link} /> : null}</View>
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.card}>
          <QrCode value={url} size={size} />
        </View>
        <Text style={styles.lead}>Everyone adds their photos here</Text>
        <Text style={styles.hint}>
          Guests scan this with their phone camera, or open the link. With Lens they join in one tap; without it they can still see the album in their
          browser. Anyone with the link can see the album and add photos, so share it with the people at your event.
        </Text>
        <Text style={styles.link} selectable>
          {url}
        </Text>
        <View style={styles.row}>
          <Pressable style={[styles.button, styles.primary]} onPress={share}>
            <Text style={styles.buttonText}>Share link</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() =>
              void Clipboard.setStringAsync(url).then(() => notify('Link copied', 'Paste it in your group chat.'))
            }
          >
            <Text style={styles.buttonText}>Copy</Text>
          </Pressable>
        </View>
        <Pressable
          style={[styles.button, { alignSelf: 'stretch', marginTop: 10 }]}
          onPress={() => {
            // A card to print for tables and entrances (website /qr-card/, same site as the link).
            const card = `${new URL(url).origin}/qr-card/?u=${encodeURIComponent(url)}&n=${encodeURIComponent(params.name ?? '')}`;
            void Linking.openURL(card);
          }}
        >
          <Text style={styles.buttonText}>Print a QR card</Text>
        </Pressable>
        <Pressable onPress={() => void turnOff()} disabled={busy} style={styles.off}>
          <Text style={styles.offText}>Turn the link off</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 64, justifyContent: 'center' },
  headerAction: { color: colors.link, fontSize: 17 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1, textAlign: 'center' },
  body: { alignItems: 'center', paddingTop: 24, paddingHorizontal: 24 },
  card: { padding: 16, backgroundColor: '#fff', borderRadius: 20 },
  lead: { color: '#fff', fontSize: 20, fontWeight: '700', marginTop: 20, textAlign: 'center' },
  hint: { color: '#86868B', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  link: { color: colors.link, fontSize: 14, marginTop: 14, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, marginTop: 18 },
  button: { minHeight: 44, paddingHorizontal: 22, borderRadius: 980, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.action },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  off: { marginTop: 28, minHeight: 44, justifyContent: 'center' },
  offText: { color: '#FF453A', fontSize: 15 },
});
