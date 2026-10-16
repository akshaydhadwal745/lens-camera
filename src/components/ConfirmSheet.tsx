// Lens's own confirm sheet (replaces the system alert box for confirmDestructive()
// and chooseAction()): a solid card from the bottom with full-width buttons,
// red for destructive, Cancel last. Back button / tap outside = cancel.
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/Text';
import { palette, radius } from '@/lib/theme';
import { ConfirmRequest, onConfirm } from '@/lib/ui';

export function ConfirmHost() {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<ConfirmRequest | null>(null);

  useEffect(
    () =>
      onConfirm((request) =>
        setCurrent((previous) => {
          // A new question replaces an open one; the old one counts as cancelled.
          previous?.resolve(null);
          return request;
        }),
      ),
    [],
  );

  const answer = (value: string | null) => {
    current?.resolve(value);
    setCurrent(null);
  };

  return (
    <Modal visible={!!current} transparent animationType="fade" statusBarTranslucent onRequestClose={() => answer(null)}>
      <Pressable style={styles.backdrop} onPress={() => answer(null)} accessibilityLabel="Cancel">
        {current && (
          <Pressable style={[styles.card, { marginBottom: insets.bottom + 12 }]} onPress={() => {}} accessibilityViewIsModal>
            <Text style={styles.title} accessibilityRole="header">
              {current.title}
            </Text>
            {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
            <View style={styles.buttons}>
              {current.options.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => answer(o.value)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.button, o.destructive ? styles.destructive : styles.primary, pressed && styles.pressed]}
                >
                  <Text style={[styles.buttonText, o.destructive && { color: palette.danger }]}>{o.label}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => answer(null)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}
              >
                <Text style={[styles.buttonText, { color: palette.text }]}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12 },
  card: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: palette.surface,
    borderRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 14,
  },
  title: { color: palette.text, fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  message: { color: palette.muted, fontSize: 15, lineHeight: 21, marginTop: 8 },
  buttons: { marginTop: 20, gap: 8 },
  button: { minHeight: 50, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primary: { backgroundColor: palette.action },
  destructive: { backgroundColor: 'rgba(255,69,58,0.16)' },
  cancel: { backgroundColor: palette.surface2 },
  pressed: { opacity: 0.7 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
