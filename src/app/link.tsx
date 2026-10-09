import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { useStore } from '@/lib/store';

/**
 * Web: signing in happens on the website's sign-in page (QR from the phone,
 * email code or Google), which sets the session cookie and comes back here.
 */
export default function LinkScreen() {
  const status = useStore((s) => s.status);
  const leave = Platform.OS === 'web' && status !== 'ready';

  useEffect(() => {
    if (leave) window.location.replace(`/signin/?next=${encodeURIComponent('/app/')}`);
  }, [leave]);

  if (!leave) return <Redirect href="/gallery" />;
  return (
    <View style={styles.fill}>
      <ActivityIndicator color="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
});
