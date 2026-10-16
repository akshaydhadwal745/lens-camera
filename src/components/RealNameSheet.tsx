// "Your name": the name friends know you by, shown next to your Lens name
// (src/lib/names.ts, infra/lambda/api/real-names.ts). Optional and not unique;
// your Lens name stays your identity. Settings → Your name, and once before the
// first share (src/app/share.tsx).
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text, TextInput } from '@/components/ui/Text';
import { api } from '@/lib/api';
import { palette, radius } from '@/lib/theme';
import { colors, errorMessage, notify } from '@/lib/ui';

type Props = {
  /** Your Lens name (quiet-tiger-8703), shown so it's clear it stays. */
  lensName: string;
  /** Current real name, or a suggestion (Google sign-in name) to pre-fill. */
  initial: string;
  title?: string;
  /** Called with the saved name (null = cleared or skipped). */
  onDone: (realName: string | null, saved: boolean) => void;
  skipLabel?: string;
};

export function RealNameSheet({ lensName, initial, title = 'Your name', onDone, skipLabel = 'Cancel' }: Props) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await api.setRealName(name.trim() || null);
      onDone(r.realName, true);
    } catch (error) {
      notify('Could not save your name', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent animationType="fade" statusBarTranslucent onRequestClose={() => onDone(null, false)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>
            The name friends know you by. People you share with see it next to your Lens name, {lensName}, which stays the same. Optional.
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={40}
            placeholder="e.g. Riya Sharma"
            placeholderTextColor={palette.dim}
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            style={styles.input}
            accessibilityLabel="Your name"
          />
          <View style={styles.buttons}>
            <Pressable onPress={() => onDone(null, false)} disabled={busy} style={[styles.button, styles.secondary]} accessibilityRole="button">
              <Text style={styles.buttonText}>{skipLabel}</Text>
            </Pressable>
            <Pressable onPress={() => void save()} disabled={busy} style={[styles.button, styles.primary]} accessibilityRole="button">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 420, backgroundColor: palette.surface, borderRadius: radius.sheet, padding: 22 },
  title: { color: palette.text, fontSize: 19, fontWeight: '700' },
  message: { color: palette.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  input: { marginTop: 16, backgroundColor: palette.surface2, color: palette.text, fontSize: 17, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  buttons: { flexDirection: 'row', gap: 10, marginTop: 18 },
  button: { flex: 1, minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.action },
  secondary: { backgroundColor: palette.surface2 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
