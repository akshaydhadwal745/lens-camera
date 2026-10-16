import { Alert, Platform } from 'react-native';

import { palette } from './theme';

const isWeb = Platform.OS === 'web';

export type ToastMessage = { title: string; message?: string; tone: 'ok' | 'problem' };
let toastListener: ((m: ToastMessage) => void) | null = null;

/** The banner host (src/components/Toast.tsx, mounted once in the root layout). */
export function onToast(listener: (m: ToastMessage) => void): () => void {
  toastListener = listener;
  return () => {
    if (toastListener === listener) toastListener = null;
  };
}

const PROBLEM = /could not|couldn't|can't|error|fail|wrong|is off|too many|not found/i;

/**
 * A short message to the user, as Lens's own banner (not the system alert box).
 * Problems get the red style: from the title's wording, or pass the tone.
 */
export function notify(title: string, message?: string, tone?: ToastMessage['tone']) {
  const m: ToastMessage = { title, message, tone: tone ?? (PROBLEM.test(title) ? 'problem' : 'ok') };
  if (toastListener) toastListener(m);
  else if (isWeb) window.alert(message ? `${title}\n${message}` : title);
  else Alert.alert(title, message);
}

export type ConfirmRequest = {
  title: string;
  message?: string;
  options: { value: string; label: string; destructive?: boolean }[];
  resolve: (value: string | null) => void;
};
let confirmListener: ((r: ConfirmRequest) => void) | null = null;

/** The sheet host (src/components/ConfirmSheet.tsx, mounted once in the root layout). */
export function onConfirm(listener: (r: ConfirmRequest) => void): () => void {
  confirmListener = listener;
  return () => {
    if (confirmListener === listener) confirmListener = null;
  };
}

/**
 * Asks the user to pick one of several actions, on Lens's own sheet; resolves to
 * the chosen value, or null if cancelled. Without the host (very early in boot)
 * it falls back to the system alert box (web: a series of confirm() prompts).
 */
export function chooseAction<T extends string>(
  title: string,
  message: string,
  options: { value: T; label: string; destructive?: boolean }[],
): Promise<T | null> {
  const listener = confirmListener;
  if (listener) {
    return new Promise((resolve) => listener({ title, message, options, resolve: (v) => resolve(v as T | null) }));
  }
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

export async function confirmDestructive(title: string, message: string, action = 'Delete'): Promise<boolean> {
  return (await chooseAction(title, message, [{ value: 'yes', label: action, destructive: true }])) === 'yes';
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Native module errors arrive as "Call to function 'X.y' has been rejected.
  // → Caused by: java.lang.IllegalStateException: <reason>": show only the reason.
  const cause = message.split('Caused by:').pop();
  if (cause !== undefined && cause !== message) {
    const reason = cause.replace(/^\s*[\w.$]+(Exception|Error):\s*/, '').trim();
    if (reason) return reason;
  }
  return message;
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
