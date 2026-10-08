// Connected storages: sign-in, where new originals go, and actions on files
// that live in the user's own storage. Web has no sign-ins (free plan keeps
// them on the phone), so everything here is a no-op there.
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { api, ApiError } from '../api';
import type { ConnectedStorage, ProviderId, StorageLocation } from '../types';
import { box } from './box';
import { dropbox } from './dropbox';
import { gdrive } from './gdrive';
import { onedrive } from './onedrive';
import { s3, S3Config } from './s3';
import { webdav, WebDavConfig } from './webdav';
import { providerInfo } from './providers';
import { Connector, MediaSource, SignedOut, statusForQuota } from './types';
import { authFor, forget, hasSignIn, rememberAccess, save } from './vault';

const isWeb = Platform.OS === 'web';

const CONNECTORS: Partial<Record<ProviderId, Connector>> = { gdrive, dropbox, onedrive, box, s3, webdav };

/** Providers that sign in through the provider's page (the rest use keys / a password). */
export const OAUTH_PROVIDERS: ProviderId[] = ['gdrive', 'dropbox', 'onedrive', 'box'];
export const isOAuth = (p: ProviderId) => OAUTH_PROVIDERS.includes(p);

export function connectorFor(provider: ProviderId): Connector | undefined {
  return CONNECTORS[provider];
}

// ---------- Connecting ----------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

function ascii(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/** Sign-in was closed by the user. */
export class ConnectCancelled extends Error {}

/**
 * Opens the provider's sign-in page in an in-app browser and connects the
 * storage. `reconnectId` re-signs-in an existing storage (after "signed out").
 */
export async function connectStorage(provider: ProviderId, reconnectId?: string): Promise<ConnectedStorage> {
  const connector = connectorFor(provider);
  if (isWeb || !connector) throw new Error('Connect storage from the Lens app on your phone.');

  const verifier = base64url(Crypto.getRandomBytes(32));
  const challenge = base64url(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, ascii(verifier))));
  const start = await api.oauthStart(provider, challenge);

  const result = await WebBrowser.openAuthSessionAsync(start.url, start.redirect);
  if (result.type !== 'success') throw new ConnectCancelled();
  const params = new URL(result.url).searchParams;
  if (params.get('error')) throw new Error(params.get('error')!);
  const tokens = await api.oauthToken(provider, {
    code: params.get('code') ?? '',
    state: params.get('state') ?? '',
    codeVerifier: verifier,
  });
  if (!tokens.refreshToken) throw new Error('The storage didn’t allow offline access. Please try again.');

  const storageId = reconnectId ?? `${provider}-${base64url(Crypto.getRandomBytes(6)).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  await save(storageId, { provider, refreshToken: tokens.refreshToken, config: {} });
  rememberAccess(storageId, tokens.accessToken, tokens.expiresAt);
  try {
    const auth = await authFor(storageId);
    const info = await connector.account(auth);
    const { storage } = await api.putStorage(storageId, {
      provider,
      label: providerInfo(provider).name,
      account: info.account,
      status: statusForQuota(info.quota),
      usedBytes: info.quota.usedBytes,
      totalBytes: info.quota.totalBytes,
    });
    return storage;
  } catch (error) {
    if (!reconnectId) await forget(storageId);
    throw error;
  }
}

export type CredentialsForm =
  | { provider: 's3'; config: S3Config; accessKeyId: string; secretAccessKey: string }
  | { provider: 'webdav'; config: WebDavConfig; password: string };

/**
 * Connects a storage that uses keys or a password (S3-compatible, WebDAV):
 * tests access first, then saves the credentials on this phone only.
 */
export async function connectWithCredentials(form: CredentialsForm, reconnectId?: string): Promise<ConnectedStorage> {
  if (isWeb) throw new Error('Connect storage from the Lens app on your phone.');
  const connector = connectorFor(form.provider)!;
  const storageId = reconnectId ?? `${form.provider}-${base64url(Crypto.getRandomBytes(6)).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`;
  const secret =
    form.provider === 's3'
      ? JSON.stringify({ accessKeyId: form.accessKeyId.trim(), secretAccessKey: form.secretAccessKey.trim() })
      : JSON.stringify({ password: form.password });
  await save(storageId, { provider: form.provider, refreshToken: secret, config: { ...form.config } });
  try {
    const auth = await authFor(storageId);
    const info = await connector.account(auth);
    const { storage } = await api.putStorage(storageId, {
      provider: form.provider,
      label: form.provider === 's3' ? 'S3 storage' : 'My NAS / WebDAV',
      account: info.account,
      status: statusForQuota(info.quota),
      usedBytes: info.quota.usedBytes,
      totalBytes: info.quota.totalBytes,
    });
    return storage;
  } catch (error) {
    if (!reconnectId) await forget(storageId);
    throw error;
  }
}

/** Disconnects (files already in their storage stay there). */
export async function disconnectStorage(storageId: string) {
  await api.deleteStorage(storageId);
  await forget(storageId);
}

// ---------- Uploading ----------

/**
 * Where a new original should go: the connected storage if this phone is
 * signed in and it's healthy; otherwise Lens storage (undefined).
 */
export async function chooseDestination(
  storages: ConnectedStorage[] | undefined,
  entry?: { forceLens?: boolean },
): Promise<StorageLocation | undefined> {
  if (isWeb || entry?.forceLens) return undefined;
  const own = storages?.find((s) => connectorFor(s.provider));
  if (!own || own.status === 'full' || own.status === 'signed-out') return undefined;
  if (!(await hasSignIn(own.id))) return undefined;
  return { storageId: own.id, provider: own.provider };
}

export async function authForLocation(location: Pick<StorageLocation, 'storageId' | 'provider'>) {
  const connector = connectorFor(location.provider);
  if (!connector) throw new Error('This app version can’t open that storage');
  return { connector, auth: await authFor(location.storageId) };
}

// ---------- Opening originals stored in their storage ----------

/** URL + headers to show/play the original, or null if this device can't reach it. */
export async function originalSource(location: StorageLocation | undefined): Promise<MediaSource | null> {
  if (isWeb || !location?.ref) return null;
  try {
    const { connector, auth } = await authForLocation(location);
    return await connector.source(auth, location.ref);
  } catch {
    return null;
  }
}

/** Downloads an original from their storage into the cache (for share / save / edit). */
export async function downloadFromStorage(id: string, location: StorageLocation, ext: string): Promise<string> {
  const dest = new File(Paths.cache, `dl-${id}.${ext}`);
  if (dest.exists) return dest.uri;
  const source = await originalSource(location);
  if (!source) throw new Error('Sign in to your storage on this phone to open the original.');
  return (await File.downloadFileAsync(source.uri, dest, { headers: source.headers })).uri;
}

/** Best-effort actions on their file (their storage's own trash keeps ~30 days). */
export async function storageAction(location: StorageLocation | undefined, action: 'trash' | 'untrash' | 'remove') {
  if (isWeb || !location?.ref) return;
  const { connector, auth } = await authForLocation(location);
  await connector[action](auth, location.ref);
}

// ---------- Health ----------

/** Checks space + sign-in and reports changes to Lens. Returns the new status. */
export async function checkStorage(storage: ConnectedStorage): Promise<ConnectedStorage | null> {
  const connector = connectorFor(storage.provider);
  if (isWeb || !connector || !(await hasSignIn(storage.id))) return null;
  let patch: Pick<ConnectedStorage, 'status' | 'usedBytes' | 'totalBytes'>;
  try {
    const auth = await authFor(storage.id);
    const quota = await connector.quota(auth);
    patch = { status: statusForQuota(quota), usedBytes: quota.usedBytes, totalBytes: quota.totalBytes };
  } catch (error) {
    if (error instanceof SignedOut) patch = { status: 'signed-out' };
    else if (error instanceof ApiError && error.status === 0) return null; // offline: try later
    else patch = { status: 'error' };
  }
  const { storage: updated } = await api.putStorage(storage.id, {
    provider: storage.provider,
    label: storage.label,
    account: storage.account,
    ...patch,
  });
  return updated;
}
