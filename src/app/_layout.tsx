import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { BrandIntro } from '@/components/BrandIntro';
import { UpdateBanner } from '@/components/UpdateBanner';
import { boot, useStore } from '@/lib/store';
import { fontFiles } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const status = useStore((s) => s.status);
  const [introVisible, setIntroVisible] = useState(true);
  // Geist + IBM Plex Mono (bundled). Until they load (a moment on first launch)
  // the intro is showing anyway; text falls back to the system font if a file fails.
  useFonts(fontFiles);

  useEffect(() => {
    // The animated intro takes over from the static native splash.
    SplashScreen.hideAsync().catch(() => {});
    boot();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="gallery" />
        <Stack.Screen name="viewer/[id]" options={{ animation: 'fade' }} />
        <Stack.Screen name="player/[id]" options={{ animation: 'fade' }} />
        <Stack.Screen name="share" options={{ presentation: 'modal' }} />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="trash" options={{ presentation: 'modal' }} />
        <Stack.Screen name="storage" options={{ presentation: 'modal' }} />
        <Stack.Screen name="camera-info" options={{ presentation: 'modal' }} />
        <Stack.Screen name="lab" />
        <Stack.Screen name="selftest" />
        <Stack.Screen name="invite" options={{ presentation: 'modal' }} />
        <Stack.Screen name="partners" options={{ presentation: 'modal' }} />
        <Stack.Screen name="admin" options={{ presentation: 'modal' }} />
        <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
        <Stack.Screen name="l/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="signin" options={{ presentation: 'modal' }} />
        <Stack.Screen name="oauth" options={{ animation: 'none' }} />
        <Stack.Screen name="link" />
        <Stack.Screen name="edit/[id]" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
      <UpdateBanner />
      {introVisible && <BrandIntro done={status !== 'booting'} onFinished={() => setIntroVisible(false)} />}
    </GestureHandlerRootView>
  );
}
