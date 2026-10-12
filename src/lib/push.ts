// Push notifications (Android, Firebase Cloud Messaging straight from our API —
// no third-party push service). This phone's FCM token is registered with the
// server for the signed-in identity; tapping a notification opens its screen.
// The permission prompt isn't shown at launch: askForNotifications() is called
// where it makes sense (sharing, the Sharing screens, Settings → Notifications).
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { api } from './api';
import { ensureChannels } from './local-notify';
import { loadDoc, saveDoc } from './local-store';
import { getState } from './store';

const supported = Platform.OS === 'android';
let started = false;
let lastKey: string | null = loadDoc<string | null>('push-registered', null);

if (supported) {
  Notifications.setNotificationHandler({
    // In the foreground show it too (a share request is worth seeing right away).
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

function open(response: Notifications.NotificationResponse | null) {
  const route = response?.notification.request.content.data?.route;
  if (typeof route === 'string' && route.startsWith('/')) router.push(route as never);
}

async function register(token?: string) {
  const id = getState().identity?.id;
  if (!id) return;
  const value = token ?? (await Notifications.getDevicePushTokenAsync()).data;
  if (typeof value !== 'string') return;
  const key = `${id}|${value}`;
  if (key === lastKey) return; // already registered for this identity
  await api.registerPush(value, 'android');
  lastKey = key;
  saveDoc('push-registered', key);
}

/** App start: channels, tap handling, and (if already allowed) token registration. */
export async function startPush() {
  if (!supported || started) return;
  started = true;
  try {
    await ensureChannels();
    Notifications.addNotificationResponseReceivedListener(open);
    open(await Notifications.getLastNotificationResponseAsync());
    Notifications.addPushTokenListener((t) => void register(t.data as string).catch(() => {}));
    if ((await Notifications.getPermissionsAsync()).granted) await register();
  } catch {
    // No Play services / offline: try again next start.
  }
}

/** Re-register after sign-in moves this phone to another identity. */
export function identityChanged() {
  if (!supported || !started) return;
  void Notifications.getPermissionsAsync().then((p) => {
    if (p.granted) register().catch(() => {});
  });
}

/** Ask once at a meaningful moment; registers the token when allowed. */
export async function askForNotifications(): Promise<boolean> {
  if (!supported) return false;
  try {
    await ensureChannels();
    let { granted, canAskAgain } = await Notifications.getPermissionsAsync();
    if (!granted && canAskAgain) ({ granted } = await Notifications.requestPermissionsAsync());
    if (granted) await register();
    return granted;
  } catch {
    return false;
  }
}

/** Sign-out on this phone: stop pushes for the old identity. */
export async function unregisterPush() {
  if (!supported || !lastKey) return;
  const token = lastKey.split('|')[1];
  await api.unregisterPush(token).catch(() => {});
  lastKey = null;
  saveDoc('push-registered', null);
}
