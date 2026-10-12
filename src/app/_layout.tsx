import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LensImaging } from '../../modules/lens-camera';
import { BrandIntro } from '@/components/BrandIntro';
import { ToastHost } from '@/components/Toast';
import { UpdateBanner } from '@/components/UpdateBanner';
import { identityChanged, startPush } from '@/lib/push';
import { boot, useStore } from '@/lib/store';
import { fontFiles } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const status = useStore((s) => s.status);
  const [introVisible, setIntroVisible] = useState(true);
  // Geist + IBM Plex Mono. Android has them built into the APK (expo-font plugin
  // in app.json): text measured before a runtime load finished kept the narrower
  // system font's width, so Geist labels lost their last letter ("PHOT", Test Lab
  // dev-67). This runtime load is for iOS and web (and harmless on Android).
  useFonts(fontFiles);

  useEffect(() => {
    // The animated intro takes over from the static native splash.
    SplashScreen.hideAsync().catch(() => {});
    boot();
    // Android: website installs don't get Play's install-time model download, so ask for the
    // scanner / scene / subject / face models now; they're ready before first use.
    LensImaging?.requestMlModules?.().catch(() => {});
    void startPush();
  }, []);

  // Push tokens belong to the identity: re-register after signing in on this phone.
  const identityId = useStore((s) => s.identity?.id);
  useEffect(() => {
    if (identityId) identityChanged();
  }, [identityId]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000' }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000' } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="gallery" />
        <Stack.Screen name="viewer/[id]" options={{ animation: 'fade' }} />
        <Stack.Screen name="player/[id]" options={{ animation: 'fade' }} />
        <Stack.Screen name="share" options={{ presentation: 'modal' }} />
        <Stack.Screen name="shares/index" />
        <Stack.Screen name="shares/sent" />
        <Stack.Screen name="shares/[id]" />
        <Stack.Screen name="my-code" options={{ presentation: 'modal' }} />
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
      <ToastHost />
      {introVisible && <BrandIntro done={status !== 'booting'} onFinished={() => setIntroVisible(false)} />}
    </GestureHandlerRootView>
  );
}
