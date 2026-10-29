import { Sentry, startCrashReporting } from '@/lib/sentry';
import { recordAppOpen } from '@/lib/review-prompt';
import { useFonts } from 'expo-font';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LensImaging } from '../../modules/lens-camera';
import { BrandIntro } from '@/components/BrandIntro';
import { ConfirmHost } from '@/components/ConfirmSheet';
import { ToastHost } from '@/components/Toast';
import { UpdateBanner } from '@/components/UpdateBanner';
import { identityChanged, startPush } from '@/lib/push';
import { peopleAppStart } from '@/lib/people';
import { restorePlayPurchases } from '@/lib/play-billing';
import { boot, useStore } from '@/lib/store';
import { fontFiles } from '@/lib/theme';
import { takePendingShareLink } from '@/lib/share-link';
import { startUsage, track } from '@/lib/usage';

// First thing, so crashes during start-up are caught too.
startCrashReporting();
SplashScreen.preventAutoHideAsync().catch(() => {});

/** First path segment → counted feature (src/lib/usage.ts; labels in console/src/pages/analytics.tsx). */
const SCREENS: Record<string, string> = {
  gallery: 'gallery_open',
  viewer: 'viewer_open',
  player: 'stream_video',
  edit: 'edit_open',
  people: 'people_open',
  person: 'people_open',
  places: 'places_open',
  place: 'places_open',
  albums: 'albums_open',
  album: 'albums_open',
  recaps: 'recap_open',
  recap: 'recap_open',
  e: 'event_open',
  'event-code': 'event_open',
  invite: 'invite_open',
  storage: 'storage_open',
  trash: 'trash_open',
  feedback: 'feedback_open',
  links: 'links_open',
  shares: 'shares_open',
  share: 'share_open',
  settings: 'settings_open',
  scan: 'scan_open',
  'my-code': 'my_code_open',
  signin: 'signin_open',
};

function RootLayout() {
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
    // People on: keep its charging-only grouping job scheduled.
    peopleAppStart();
    // Feedback loop: counts app opens (src/lib/review-prompt.ts).
    recordAppOpen();
    void startPush();
    // Our own analytics: anonymous feature counts (src/lib/usage.ts).
    startUsage();
  }, []);

  // Which screens get used (counted per day, names only).
  const pathname = usePathname();
  useEffect(() => {
    const screen = SCREENS[pathname.split('/')[1] ?? ''];
    if (screen) track(screen);
  }, [pathname]);

  // Push tokens belong to the identity: re-register after signing in on this phone.
  const identityId = useStore((s) => s.identity?.id);
  useEffect(() => {
    if (identityId) identityChanged();
    // Play Store app: purchases Google finished but our server never confirmed (crash, no network).
    if (identityId) void restorePlayPurchases();
  }, [identityId]);

  // A fresh install that came from a share link: open what was shared, once (src/lib/share-link.ts).
  const ready = status === 'ready' && !introVisible;
  useEffect(() => {
    if (!ready) return;
    void takePendingShareLink().then((token) => token && router.push({ pathname: '/s/[token]', params: { token } }));
  }, [ready]);

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
        <Stack.Screen name="albums" />
        <Stack.Screen name="album/[id]" />
        <Stack.Screen name="places" />
        <Stack.Screen name="place/[key]" />
        <Stack.Screen name="settings" options={{ presentation: 'modal' }} />
        <Stack.Screen name="trash" options={{ presentation: 'modal' }} />
        <Stack.Screen name="blocked" />
        <Stack.Screen name="links" />
        <Stack.Screen name="storage" options={{ presentation: 'modal' }} />
        <Stack.Screen name="plus" options={{ presentation: 'modal' }} />
        <Stack.Screen name="camera-info" options={{ presentation: 'modal' }} />
        <Stack.Screen name="lab" />
        <Stack.Screen name="selftest" />
        <Stack.Screen name="invite" options={{ presentation: 'modal' }} />
        <Stack.Screen name="partners" options={{ presentation: 'modal' }} />
        <Stack.Screen name="feedback" options={{ presentation: 'modal' }} />
        <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
        <Stack.Screen name="l/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="u/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="s/[token]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="signin" options={{ presentation: 'modal' }} />
        <Stack.Screen name="oauth" options={{ animation: 'none' }} />
        <Stack.Screen name="link" />
        <Stack.Screen name="edit/[id]" options={{ animation: 'fade', gestureEnabled: false }} />
      </Stack>
      <UpdateBanner />
      <ToastHost />
      <ConfirmHost />
      {introVisible && <BrandIntro done={status !== 'booting'} onFinished={() => setIntroVisible(false)} />}
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
