import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useEffect } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/lib/ui';

/** Ask for new code at most this often when the app comes back to the screen. */
const FOREGROUND_CHECK_MS = 5 * 60 * 1000;
let lastCheck = 0;

async function checkAndFetch() {
  if (!Updates.isEnabled || Date.now() - lastCheck < FOREGROUND_CHECK_MS) return;
  lastCheck = Date.now();
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) await Updates.fetchUpdateAsync();
  } catch {
    // Offline or server busy: the next launch/foreground tries again.
  }
}

/**
 * Over-the-air updates (self-hosted, signed): Lens checks on launch (built in)
 * and when it returns to the foreground, downloads new code in the background
 * and offers a one-tap restart. Photos, sign-in and settings are untouched.
 */
export function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const { isUpdatePending } = Updates.useUpdates();

  useEffect(() => {
    lastCheck = Date.now(); // the launch check is already running
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void checkAndFetch();
    });
    return () => sub.remove();
  }, []);

  if (!isUpdatePending) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 90 }]}>
      <Pressable style={styles.banner} onPress={() => void Updates.reloadAsync()} accessibilityRole="button">
        <Ionicons name="sparkles" size={16} color="#000" />
        <Text style={styles.text}>New version ready · Tap to restart</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  text: { color: '#000', fontSize: 14, fontWeight: '700' },
});
