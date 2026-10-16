// The GPS position a photo carries in its EXIF (written by the camera when
// "Save location" is on), read from the first 128 KB of the JPEG; videos: the
// moov box's location (src/lib/mp4-location.ts). For Places
// (docs/design/organise-and-share.md, step 2). Null when there is none.
import { File, FileMode } from 'expo-file-system';

import { readMp4Location } from './mp4-location';

const HEAD = 128 * 1024;

export function gpsFromJpegBytes(b: Uint8Array): { lat: number; lng: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 4 <= b.length && b[pos] === 0xff) {
    const marker = b[pos + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (b[pos + 2] << 8) | b[pos + 3];
    const start = pos + 4;
    const end = Math.min(pos + 2 + length, b.length);
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(start, start + 6)) === 'Exif\0\0') return fromTiff(b, start + 6, end);
    pos = pos + 2 + length;
  }
  return null;
}

function fromTiff(b: Uint8Array, tiff: number, limit: number): { lat: number; lng: number } | null {
  const little = b[tiff] === 0x49;
  const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const ok = (o: number, n: number) => o >= tiff && o + n <= limit;
  const ifd0 = tiff + u32(tiff + 4);
  if (!ok(ifd0, 2)) return null;
  let gps = -1;
  for (let i = 0, n = u16(ifd0); i < n; i++) {
    const e = ifd0 + 2 + i * 12;
    if (!ok(e, 12)) return null;
    if (u16(e) === 0x8825) gps = tiff + u32(e + 8);
  }
  if (gps < 0 || !ok(gps, 2)) return null;
  const tags: Record<number, number> = {};
  for (let i = 0, n = u16(gps); i < n; i++) {
    const e = gps + 2 + i * 12;
    if (!ok(e, 12)) break;
    tags[u16(e)] = e;
  }
  const ref = (tag: number) => (tags[tag] ? String.fromCharCode(b[tags[tag] + 8]) : '');
  const dms = (tag: number): number | null => {
    const e = tags[tag];
    if (!e || u16(e + 2) !== 5 || u32(e + 4) !== 3) return null;
    const at = tiff + u32(e + 8);
    if (!ok(at, 24)) return null;
    const r = (k: number) => {
      const den = u32(at + k * 8 + 4);
      return den ? u32(at + k * 8) / den : 0;
    };
    return r(0) + r(1) / 60 + r(2) / 3600;
  };
  const lat = dms(2);
  const lng = dms(4);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return null;
  return { lat: ref(1) === 'S' ? -lat : lat, lng: ref(3) === 'W' ? -lng : lng };
}

/** GPS of a local JPEG file, or null (no tag, not a JPEG, unreadable). */
export function gpsOfFile(file: File): { lat: number; lng: number } | null {
  try {
    const handle = file.open(FileMode.ReadOnly);
    try {
      return gpsFromJpegBytes(handle.readBytes(Math.min(HEAD, file.size ?? HEAD)));
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}

/** GPS of a local MP4/MOV (the position "Save location" writes into a video), or null. */
export async function gpsOfVideoFile(file: File): Promise<{ lat: number; lng: number } | null> {
  try {
    const handle = file.open(FileMode.ReadOnly);
    try {
      const size = handle.size ?? file.size ?? 0;
      const read = (offset: number, length: number) => {
        handle.offset = offset;
        return handle.readBytes(Math.max(0, Math.min(length, size - offset)));
      };
      return (await readMp4Location(read, size))?.gps ?? null;
    } finally {
      handle.close();
    }
  } catch {
    return null;
  }
}

/** The position a capture carries (photo EXIF or video metadata), or null. */
export async function gpsOfCapture(file: File, kind: string, contentType: string): Promise<{ lat: number; lng: number } | null> {
  if (kind === 'photo') return contentType === 'image/jpeg' ? gpsOfFile(file) : null;
  if (kind === 'video') return /^video\/(mp4|quicktime)$/.test(contentType) ? gpsOfVideoFile(file) : null;
  return null;
}
