// Periodic background backup (Android WorkManager / iOS BGTaskScheduler via
// expo-background-task): every ~15 minutes or more, the OS wakes Lens briefly
// to continue uploads, e.g. after a reboot or after the system closed the app.
// Defined at module load (from the entry file), so it also works headless.
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

export const BACKUP_TASK = 'lens-backup';

/** The OS gives background tasks a few minutes; stop well before. */
const RUN_FOR_MS = 8 * 60 * 1000;

if (Platform.OS !== 'web') {
  TaskManager.defineTask(BACKUP_TASK, async () => {
    try {
      // Loaded lazily so defining the task doesn't pull in the whole app.
      const { runBackgroundSync } = await import('./store');
      await runBackgroundSync(RUN_FOR_MS);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerBackgroundBackup() {
  if (Platform.OS === 'web') return;
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(BACKUP_TASK))) {
      await BackgroundTask.registerTaskAsync(BACKUP_TASK, { minimumInterval: 15 });
    }
  } catch {
    // Not available (Expo Go) or restricted by the OS: foreground uploads still work.
  }
}
