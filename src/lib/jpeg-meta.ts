// Previews and thumbnails carry no metadata. They are what other people see of a
// photo (share requests, the Shared tab, share links, event albums), so above all
// they must never carry the GPS position: the original's location is only shared
// when the owner turns "Include where they were taken" on, and then the server
// sends the original itself. Galaxy S8, 2026-10-19: edited photos' previews kept
// the exact position (the imaging engine copies capture EXIF into every render,
// which is right for exports to the owner's own gallery, not for previews).
import { File, FileMode } from 'expo-file-system';

/** The JPEG without its APP1 segments (EXIF and XMP); the same array when there are none or it isn't a JPEG. */
export function withoutApp1(b: Uint8Array): Uint8Array {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return b;
  const keep: [number, number][] = [[0, 2]];
  let pos = 2;
  let removed = false;
  while (pos + 4 <= b.length && b[pos] === 0xff) {
    const marker = b[pos + 1];
    if (marker === 0xda || marker === 0xd9) break; // image data: the rest is copied as it is
    const end = pos + 2 + ((b[pos + 2] << 8) | b[pos + 3]);
    if (end > b.length) return b; // malformed: leave it alone
    if (marker === 0xe1) removed = true;
    else keep.push([pos, end]);
    pos = end;
  }
  if (!removed) return b;
  keep.push([pos, b.length]);
  const out = new Uint8Array(keep.reduce((n, [s, e]) => n + e - s, 0));
  let o = 0;
  for (const [s, e] of keep) {
    out.set(b.subarray(s, e), o);
    o += e - s;
  }
  return out;
}

/** Removes EXIF/XMP from a local JPEG in place (pixels and colour profile untouched). */
export function stripJpegMetadata(uri: string): void {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  let bytes: Uint8Array;
  try {
    bytes = handle.readBytes(file.size ?? 0);
  } finally {
    handle.close();
  }
  const out = withoutApp1(bytes);
  if (out === bytes) return;
  file.delete();
  file.create();
  file.write(out);
}
