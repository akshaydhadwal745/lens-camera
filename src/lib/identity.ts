// Session for this phone. It starts as a guest identity created silently on
// first launch; signing in (email code / Google) turns it into an account, or
// swaps in the account's session. Kept in the iOS Keychain / Android Keystore.
// Web: obtained by linking with a code from the phone, kept in localStorage.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { api, IdentityResponse } from './api';

/** `email` is set once the guest identity became a signed-in account. */
export type Identity = IdentityResponse;

const KEY = 'lens.identity';
const isWeb = Platform.OS === 'web';

async function read(): Promise<string | null> {
  if (isWeb) return globalThis.localStorage?.getItem(KEY) ?? null;
  return SecureStore.getItemAsync(KEY);
}

async function write(value: string | null) {
  if (isWeb) {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
    return;
  }
  if (value) await SecureStore.setItemAsync(KEY, value);
  else await SecureStore.deleteItemAsync(KEY);
}

export async function loadIdentity(): Promise<Identity | null> {
  const raw = await read();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Identity;
    return parsed.id && parsed.token ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveIdentity(identity: Identity | null) {
  await write(identity ? JSON.stringify(identity) : null);
}

/** Shown in the account's device list, e.g. "samsung SM-S921B" or "iPhone". */
export function deviceLabel(): string {
  const c = Platform.constants as Record<string, unknown>;
  if (Platform.OS === 'android') return [c.Brand, c.Model].filter(Boolean).join(' ') || 'Android phone';
  if (Platform.OS === 'ios') return (Platform as { isPad?: boolean }).isPad ? 'iPad' : 'iPhone';
  return 'Browser';
}

/** Native: returns the stored identity or registers a new (guest) one. */
export async function ensureIdentity(): Promise<Identity> {
  const existing = await loadIdentity();
  if (existing) return existing;
  const created = await api.register(deviceLabel());
  await saveIdentity(created);
  return created;
}
