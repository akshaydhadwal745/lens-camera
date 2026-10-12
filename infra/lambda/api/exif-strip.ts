// Removes the GPS position from a JPEG without re-encoding (byte edits only):
// the GPS IFD's entries and the values they point to are zeroed and its entry
// count set to 0, so no reader finds a position and the bytes aren't left
// behind either. Everything else (orientation, date, camera, image data,
// Ultra HDR gain map) is untouched. Used for photos shared without location
// (docs/design/organise-and-share.md, decision 2).

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

/** A copy of `jpeg` with the GPS block wiped; `changed` = there was one. */
export function stripGps(jpeg: Uint8Array): { bytes: Uint8Array; changed: boolean } {
  const out = Uint8Array.from(jpeg);
  if (out.length < 4 || out[0] !== 0xff || out[1] !== 0xd8) return { bytes: out, changed: false };
  let pos = 2;
  while (pos + 4 <= out.length && out[pos] === 0xff) {
    const marker = out[pos + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (out[pos + 2] << 8) | out[pos + 3];
    const start = pos + 4;
    const end = pos + 2 + length;
    if (end > out.length) break;
    const isExif = marker === 0xe1 && length > 14 && String.fromCharCode(...out.subarray(start, start + 6)) === 'Exif\0\0';
    if (isExif && wipeGps(out, start + 6, end)) return { bytes: out, changed: true };
    pos = end;
  }
  return { bytes: out, changed: false };
}

/** The TIFF structure starts at `tiff` (inside the APP1 segment, which ends at `limit`). */
function wipeGps(b: Uint8Array, tiff: number, limit: number): boolean {
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  if (!little && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return false;
  const u16 = (o: number) => (little ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o: number) => (little ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  const inside = (o: number, n: number) => o >= tiff && o + n <= limit;
  const ifd0 = tiff + u32(tiff + 4);
  if (!inside(ifd0, 2)) return false;
  const entries = u16(ifd0);
  for (let i = 0; i < entries; i++) {
    const e = ifd0 + 2 + i * 12;
    if (!inside(e, 12)) return false;
    if (u16(e) !== 0x8825) continue; // GPSInfo pointer
    const gps = tiff + u32(e + 8);
    if (!inside(gps, 2)) return false;
    const n = u16(gps);
    for (let k = 0; k < n; k++) {
      const g = gps + 2 + k * 12;
      if (!inside(g, 12)) break;
      const bytes = (TYPE_SIZE[u16(g + 2)] ?? 1) * u32(g + 4);
      if (bytes > 4) {
        const at = tiff + u32(g + 8);
        if (inside(at, bytes)) b.fill(0, at, at + bytes); // the value itself (e.g. latitude rationals)
      }
      b.fill(0, g, g + 12);
    }
    b[gps] = 0;
    b[gps + 1] = 0; // no GPS entries left
    return true;
  }
  return false;
}
