// A share link opened in Lens (App Link /s/<token>, a scanned QR, or the link a
// fresh install came from: src/lib/share-link.ts). Opening it here is the
// accept: the items land in the Shared tab and the sender sees who opened it.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { who } from '@/lib/names';
import { refreshShared, useStore } from '@/lib/store';
import { colors, errorMessage, notify } from '@/lib/ui';

export default function OpenShareLink() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const insets = useSafeAreaInsets();
  const identity = useStore((s) => s.identity);
  const [title, setTitle] = useState('Opening what was shared with you…');
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!identity || !token || started.current) return;
    started.current = true;
    (async () => {
      const info = await api.linkInfo(token).catch(() => null);
      if (info) setTitle(`Opening what ${who(info.link.from)} shared with you…`);
      const opened = await api.openLink(token);
      if (opened.own) {
        notify('This is your own link', 'Send it to someone; you can turn it off in Settings → Sharing → Share links.');
        router.replace('/');
        return;
      }
      await refreshShared();
      const name = info ? who(info.link.from) : 'Your friend';
      if (opened.mediaIds.length === 1) {
        router.replace({ pathname: '/viewer/[id]', params: { id: opened.mediaIds[0], source: 'shared' } });
      } else {
        router.replace({ pathname: '/gallery', params: { tab: 'shared' } });
        notify(`${name} shared ${opened.mediaIds.length} items`, 'They’re in your Shared tab.');
      }
    })().catch((e) => setError(errorMessage(e)));
  }, [identity, token]);

  return (
    <View style={[styles.fill, { paddingTop: insets.top || 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} style={styles.headerButton} accessibilityLabel="Close">
          <Text style={styles.headerAction}>Close</Text>
        </Pressable>
      </View>
      <View style={styles.body}>
        {error ? (
          <>
            <Ionicons name="link-outline" size={48} color={colors.danger} />
            <Text style={styles.lead}>Can’t open this link</Text>
            <Text style={styles.hint}>{error}</Text>
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.link} />
            <Text style={[styles.hint, { marginTop: 16 }]}>{title}</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, height: 52 },
  headerButton: { minHeight: 44, minWidth: 64, justifyContent: 'center' },
  headerAction: { color: colors.link, fontSize: 17 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 60 },
  lead: { color: '#fff', fontSize: 22, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  hint: { color: '#86868B', fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 6 },
});
