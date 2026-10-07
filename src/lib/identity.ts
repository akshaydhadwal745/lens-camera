// Device identity. Native: created silently on first launch and kept in the
// iOS Keychain (survives reinstalls). Web: obtained by linking with a code
// from the phone, kept in localStorage.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { api, IdentityResponse } from './api';

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

/** Native: returns the stored identity or registers a new one. */
export async function ensureIdentity(): Promise<Identity> {
  const existing = await loadIdentity();
  if (existing) return existing;
  const created = await api.register();
  await saveIdentity(created);
  return created;
}
