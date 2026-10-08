// Sign-ins for connected storages, kept only on this phone (Keychain /
// Android Keystore). The refresh token and settings are stored; access
// tokens stay in memory and are refreshed through the Lens OAuth relay,
// which adds the client secret and stores nothing.
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { api, ApiError } from '../api';
import type { ProviderId } from '../types';
import { Auth, SignedOut } from './types';

type Saved = {
  provider: ProviderId;
  /** OAuth refresh token, or a JSON secret for key/password storages (S3, WebDAV). */
  refreshToken?: string;
  config: Record<string, string>;
};

const isWeb = Platform.OS === 'web';
const key = (storageId: string) => `lens.storage.${storageId}`;
const access = new Map<string, { token: string; expiresAt: number }>();
const refreshing = new Map<string, Promise<string>>();

export async function loadSaved(storageId: string): Promise<Saved | null> {
  if (isWeb) return null;
  const raw = await SecureStore.getItemAsync(key(storageId));
  return raw ? (JSON.parse(raw) as Saved) : null;
}

export async function save(storageId: string, saved: Saved) {
  await SecureStore.setItemAsync(key(storageId), JSON.stringify(saved));
}

export async function forget(storageId: string) {
  access.delete(storageId);
  if (!isWeb) await SecureStore.deleteItemAsync(key(storageId));
}

export function rememberAccess(storageId: string, token: string, expiresAt: number) {
  access.set(storageId, { token, expiresAt });
}

/** True if this phone holds the sign-in for the storage. */
export async function hasSignIn(storageId: string): Promise<boolean> {
  return !!(await loadSaved(storageId));
}

async function refreshAccess(storageId: string): Promise<string> {
  let job = refreshing.get(storageId);
  if (!job) {
    job = (async () => {
      // Always the latest saved token: some providers (Box) issue single-use refresh tokens.
      const saved = await loadSaved(storageId);
      if (!saved?.refreshToken) throw new SignedOut();
      try {
        const t = await api.oauthRefresh(saved.provider, saved.refreshToken);
        rememberAccess(storageId, t.accessToken, t.expiresAt);
        if (t.refreshToken && t.refreshToken !== saved.refreshToken) {
          await save(storageId, { ...saved, refreshToken: t.refreshToken }); // providers may rotate it
        }
        return t.accessToken;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'signed-out') throw new SignedOut();
        throw error;
      }
    })().finally(() => refreshing.delete(storageId));
    refreshing.set(storageId, job);
  }
  return job;
}

/** Auth handle for a connector (OAuth providers). */
export async function authFor(storageId: string): Promise<Auth> {
  const saved = await loadSaved(storageId);
  if (!saved) throw new SignedOut('This phone isn’t signed in to that storage');
  const config = { ...saved.config };
  return {
    config,
    secret: saved.refreshToken,
    async token() {
      const cached = access.get(storageId);
      if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
      return refreshAccess(storageId);
    },
    async refresh() {
      access.delete(storageId);
      return refreshAccess(storageId);
    },
    async saveConfig(patch) {
      Object.assign(config, patch);
      const latest = await loadSaved(storageId);
      if (latest) await save(storageId, { ...latest, config: { ...latest.config, ...patch } });
    },
  };
}
