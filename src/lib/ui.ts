import { Alert, Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

export function notify(title: string, message?: string) {
  if (isWeb) window.alert(message ? `${title}\n${message}` : title);
  else Alert.alert(title, message);
}

export function confirmDestructive(title: string, message: string, action = 'Delete'): Promise<boolean> {
  if (isWeb) return Promise.resolve(window.confirm(`${title}\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const colors = {
  bg: '#000',
  surface: '#111827',
  border: '#1F2937',
  text: '#fff',
  muted: '#94A3B8',
  accent: '#FACC15',
  brand: '#2563EB',
  danger: '#EF4444',
};
