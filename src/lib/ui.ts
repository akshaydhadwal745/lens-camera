import { Alert, Platform } from 'react-native';

import { palette } from './theme';

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

/**
 * Asks the user to pick one of several actions; resolves to the chosen value,
 * or null if cancelled. Web falls back to a series of confirm() prompts.
 */
export function chooseAction<T extends string>(
  title: string,
  message: string,
  options: { value: T; label: string; destructive?: boolean }[],
): Promise<T | null> {
  if (isWeb) {
    for (const o of options) if (window.confirm(`${title}\n${message}\n\n${o.label}?`)) return Promise.resolve(o.value);
    return Promise.resolve(null);
  }
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      ...options.map((o) => ({
        text: o.label,
        style: o.destructive ? ('destructive' as const) : ('default' as const),
        onPress: () => resolve(o.value),
      })),
      { text: 'Cancel', style: 'cancel' as const, onPress: () => resolve(null) },
    ]),
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Older screens use these names; values follow the design language in theme.ts. */
export const colors = {
  bg: palette.bg,
  surface: palette.surface,
  border: palette.surface2,
  text: palette.text,
  muted: palette.muted,
  accent: palette.accent,
  brand: palette.action,
  /** Links, text buttons, icons that do something. */
  link: palette.link,
  /** Primary buttons (blue pill, white text). */
  action: palette.action,
  danger: palette.danger,
};
