// Approve a website sign-in. Reached by scanning the QR in Settings → Link a
// computer, or by scanning it with the phone's own camera (App Link /l/<id>).
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { colors, errorMessage } from '@/lib/ui';

type Info = { browser: string; city?: string; status: string };

export default function ApproveSignIn() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const identity = useStore((s) => s.identity);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'approved' | 'denied' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!identity || !id) return;
    api.loginSessionInfo(id).then(setInfo, (e) => setError(errorMessage(e)));
  }, [identity, id]);

  const answer = async (approve: boolean) => {
    setBusy(true);
    try {
      if (approve) await api.approveLoginSession(id!);
      else await api.denyLoginSession(id!);
      setResult(approve ? 'approved' : 'denied');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={[styles.fill, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <Ionicons name="desktop-outline" size={56} color={colors.accent} style={{ alignSelf: 'center' }} />
      <Text style={styles.title}>Sign in on a computer?</Text>
      {!identity ? (
        <Text style={styles.body}>Open Lens and sign in first, then scan the code again.</Text>
      ) : error ? (
        <Text style={[styles.body, styles.error]}>{error}</Text>
      ) : result ? (
        <Text style={styles.body}>
          {result === 'approved' ? 'Done. Your computer is signing in now.' : 'Denied. That browser was not signed in.'}
        </Text>
      ) : !info ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 24 }} />
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.browser}>{info.browser}</Text>
            {info.city ? <Text style={styles.muted}>near {info.city}</Text> : null}
            <Text style={styles.muted}>wants to sign in as {identity.email ?? identity.name}</Text>
          </View>
          <Text style={styles.warn}>
            Only approve a code shown on a screen in front of you. Never approve a code someone sent you.
          </Text>
          <Pressable style={[styles.button, styles.approve]} onPress={() => answer(true)} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.approveText}>Approve</Text>}
          </Pressable>
          <Pressable style={[styles.button, styles.deny]} onPress={() => answer(false)} disabled={busy} accessibilityRole="button">
            <Text style={styles.denyText}>Deny</Text>
          </Pressable>
        </>
      )}
      {(result || error || !identity) && (
        <Pressable style={[styles.button, styles.deny]} onPress={close}>
          <Text style={styles.denyText}>Close</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000', paddingHorizontal: 24 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', textAlign: 'center', marginTop: 16 },
  body: { color: '#ccc', fontSize: 16, textAlign: 'center', marginTop: 16, lineHeight: 23 },
  error: { color: '#FCA5A5' },
  card: { backgroundColor: '#111827', borderRadius: 16, padding: 20, marginTop: 24, alignItems: 'center' },
  browser: { color: '#fff', fontSize: 20, fontWeight: '700' },
  muted: { color: '#94A3B8', fontSize: 15, marginTop: 4 },
  warn: { color: '#FCD34D', fontSize: 14, textAlign: 'center', marginTop: 16, lineHeight: 20 },
  button: { minHeight: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  approve: { backgroundColor: colors.accent, marginTop: 'auto' },
  approveText: { color: '#000', fontWeight: '800', fontSize: 17 },
  deny: { borderWidth: 1, borderColor: '#333' },
  denyText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
