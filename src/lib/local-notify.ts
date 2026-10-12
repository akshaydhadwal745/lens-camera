// On-phone notifications (no server): "backup done". Also the notification
// channels every Lens notification uses, and the local on/off switch.
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { loadDoc, saveDoc } from './local-store';

export const CHANNELS = [
  { id: 'shares', name: 'Shares', description: 'Someone wants to share photos with you, or accepted yours' },
  { id: 'invites', name: 'Invites and rewards', description: 'Friends who joined with your invite (+10 GB)' },
  { id: 'storage', name: 'Storage', description: 'Your Lens storage is nearly full' },
  { id: 'backup', name: 'Backup finished', description: 'All your photos and videos are safe in the cloud' },
] as const;

let channelsReady: Promise<void> | null = null;

/** Android needs the channels before a token is requested or a notification is shown. */
export function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelsReady ??= Promise.all(
    CHANNELS.map((c) =>
      Notifications.setNotificationChannelAsync(c.id, { name: c.name, description: c.description, importance: Notifications.AndroidImportance.DEFAULT }),
    ),
  ).then(() => undefined);
  return channelsReady;
}

export function backupNotificationsEnabled(): boolean {
  return loadDoc<{ backup?: boolean }>('notify-local', {}).backup !== false;
}

export function setBackupNotifications(on: boolean) {
  saveDoc('notify-local', { backup: on });
}

/**
 * A finished background backup of several items, while Lens isn't on screen:
 * "All 340 photos are safe in the cloud". Quiet when the app is open (you can see it).
 */
export async function notifyBackupDone(count: number) {
  if (Platform.OS !== 'android' || count < 10 || AppState.currentState === 'active' || !backupNotificationsEnabled()) return;
  try {
    const { granted } = await Notifications.getPermissionsAsync();
    if (!granted) return;
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `All ${count} items are safe in the cloud`,
        body: 'Lens finished backing up. Your phone can free up space any time.',
        data: { route: '/gallery', category: 'backup' },
      },
      trigger: { channelId: 'backup' } as Notifications.NotificationTriggerInput,
    });
  } catch {
    // Never let a notification break the backup.
  }
}
