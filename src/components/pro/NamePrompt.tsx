import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

/** Asks for a short name. Works on Android too (Alert.prompt is iOS-only). */
export function NamePrompt({
  title,
  message,
  onSubmit,
  onCancel,
}: {
  title: string;
  message?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            maxLength={40}
            placeholder="Name"
            placeholderTextColor="#777"
            returnKeyType="done"
            onSubmitEditing={submit}
            style={styles.input}
          />
          <View style={styles.buttons}>
            <Pressable onPress={onCancel} hitSlop={8} style={styles.button}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={!name.trim()} hitSlop={8} style={styles.button}>
              <Text style={[styles.save, !name.trim() && { opacity: 0.4 }]}>Save</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: '#1C1C1E', borderRadius: 16, padding: 20 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  message: { color: '#aaa', fontSize: 13, marginTop: 6 },
  input: {
    marginTop: 14,
    backgroundColor: '#2C2C2E',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 16 },
  button: { minHeight: 36, justifyContent: 'center' },
  cancel: { color: '#aaa', fontSize: 16 },
  save: { color: '#FACC15', fontSize: 16, fontWeight: '700' },
});
