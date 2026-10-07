import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { linkWithCode, useStore } from '@/lib/store';
import { colors, errorMessage } from '@/lib/ui';

const mark = require('../../assets/splash-icon.png');

/** Web sign-in: enter the code shown in the phone app's Settings. */
export default function LinkScreen() {
  const status = useStore((s) => s.status);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (Platform.OS !== 'web' || status === 'ready') return <Redirect href="/gallery" />;

  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  const submit = async () => {
    if (clean.length !== 8 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await linkWithCode(clean);
      router.replace('/gallery');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.fill}>
      <View style={styles.card}>
        <Image source={mark} style={{ width: 96, height: 96 }} contentFit="contain" />
        <Text style={styles.title}>Lens on the web</Text>
        <Text style={styles.body}>
          On your iPhone or iPad, open Lens, go to Gallery, tap your profile, then tap{' '}
          <Text style={styles.bold}>Link a browser</Text>. Enter the code shown there.
        </Text>
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          onSubmitEditing={submit}
          placeholder="ABCD-EFGH"
          placeholderTextColor="#555"
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={9}
          style={styles.input}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={[styles.button, (clean.length !== 8 || busy) && { opacity: 0.5 }]} onPress={submit} disabled={clean.length !== 8 || busy}>
          {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>Link this browser</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#0B1020', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 420, alignItems: 'center', gap: 12 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  body: { color: colors.muted, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  bold: { color: '#fff', fontWeight: '700' },
  input: {
    width: '100%',
    height: 60,
    borderRadius: 14,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 6,
    textAlign: 'center',
    marginTop: 8,
  },
  error: { color: colors.danger, fontSize: 14 },
  button: { width: '100%', height: 50, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#000', fontWeight: '700', fontSize: 16 },
});
