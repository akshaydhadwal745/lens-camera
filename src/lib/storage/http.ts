// Small helpers shared by the connectors.
import { File, FileMode, Paths } from 'expo-file-system';

import { Auth, SignedOut } from './types';

/** fetch with the storage's access token; refreshes once on 401. */
export async function authedFetch(auth: Auth, url: string, init: RequestInit = {}): Promise<Response> {
  const send = async (token: string) =>
    fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  let res = await send(await auth.token());
  if (res.status === 401) {
    res = await send(await auth.refresh());
    if (res.status === 401) throw new SignedOut();
  }
  return res;
}

/** Case-insensitive response header lookup (upload results return a plain object). */
export function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === wanted) return v;
  return undefined;
}

/** Copies bytes [offset, offset+length) of a file into a temporary chunk file. */
export function writeChunkAt(source: File, tag: string, offset: number, length: number): File {
  const handle = source.open(FileMode.ReadOnly);
  let bytes: Uint8Array;
  try {
    handle.offset = offset;
    bytes = handle.readBytes(length);
  } finally {
    handle.close();
  }
  const chunk = new File(Paths.cache, `part-${tag}-${offset}.bin`);
  if (chunk.exists) chunk.delete();
  chunk.create();
  chunk.write(bytes);
  return chunk;
}

/** Raw bytes of a slice (for hashing). */
export function readBytesAt(source: File, offset: number, length: number): Uint8Array {
  const handle = source.open(FileMode.ReadOnly);
  try {
    handle.offset = offset;
    return handle.readBytes(length);
  } finally {
    handle.close();
  }
}

export async function errorText(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data?.error?.message ?? data?.error_summary ?? data?.message ?? JSON.stringify(data).slice(0, 200);
  } catch {
    return `status ${res.status}`;
  }
}
