import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvailableUpdate, checkForNewApk } from '@/lib/app-update';
import { formatBytes } from '@/lib/format';
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
 *
 * Builds with native changes can't come over the air: for apps installed from
 * our website, a "New Lens version" pill opens the new APK's download
 * (src/lib/app-update.ts).
 */
export function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const { isUpdatePending } = Updates.useUpdates();
  const [apk, setApk] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    lastCheck = Date.now(); // the launch check is already running
    void checkForNewApk(true).then((u) => u && setApk(u));
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void checkAndFetch();
      void checkForNewApk().then((u) => u && setApk(u));
    });
    return () => sub.remove();
  }, []);

  if (!isUpdatePending && apk) {
    return (
      <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 90 }]}>
        <Pressable style={styles.banner} onPress={() => void Linking.openURL(apk.url)} accessibilityRole="button">
          <Ionicons name="download-outline" size={16} color="#fff" />
          <Text style={styles.text}>New Lens version · Download ({formatBytes(apk.size)})</Text>
        </Pressable>
      </View>
    );
  }
  if (!isUpdatePending) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 90 }]}>
      <Pressable style={styles.banner} onPress={() => void Updates.reloadAsync()} accessibilityRole="button">
        <Ionicons name="sparkles" size={16} color="#fff" />
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
    backgroundColor: colors.action,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  text: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
