// Where a video (MP4/MOV) was recorded, and where that is written in the file.
// Shared by the phone (Places: send `gps` with the upload) and the API (shares
// without location get a copy whose location boxes become zero-filled `free`
// boxes: same size, same audio/video, players skip them, no position left in the
// bytes). Pure: the caller passes a reader.
//
// Positions live in the `moov` box:
// - moov/udta/©xyz: "+30.7333+076.7794/" (Android MediaMuxer / CameraX setLocation)
// - moov/meta keys+ilst "com.apple.quicktime.location.ISO6709" (iPhone)
// - moov/udta/loci (3GPP, what ffmpeg writes): 16.16 fixed-point longitude, latitude

export type Mp4Location = {
  gps: { lat: number; lng: number } | null;
  /** Every box that holds a position: file offset of its start, and its size. */
  boxes: { start: number; size: number }[];
};

type Read = (offset: number, length: number) => Uint8Array | Promise<Uint8Array>;

const MAX_MOOV = 64 * 1024 * 1024;
const APPLE_KEY = 'com.apple.quicktime.location.ISO6709';

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

const signed = (n: number) => (n < 0 ? `${n.toFixed(5)}` : `+${n.toFixed(5)}`);

export function parseIso6709(text: string): { lat: number; lng: number } | null {
  const m = /^\s*([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

/** Finds the top-level moov box: { start, size } or null. Reads only box headers. */
async function findMoov(read: Read, fileSize: number): Promise<{ start: number; size: number } | null> {
  let pos = 0;
  for (let guard = 0; pos + 8 <= fileSize && guard < 1000; guard++) {
    const h = await read(pos, 16);
    if (h.length < 8) return null;
    let size = u32(h, 0);
    const type = ascii(h, 4, 4);
    let header = 8;
    if (size === 1) {
      if (h.length < 16) return null;
      size = u32(h, 8) * 2 ** 32 + u32(h, 12);
      header = 16;
    } else if (size === 0) size = fileSize - pos;
    if (size < header) return null;
    if (type === 'moov') return { start: pos, size };
    pos += size;
  }
  return null;
}

/** Child boxes of [from, to) in b: { type, start, size, body }. */
function children(b: Uint8Array, from: number, to: number) {
  const out: { type: string; start: number; size: number; body: number }[] = [];
  let pos = from;
  while (pos + 8 <= to) {
    let size = u32(b, pos);
    let body = pos + 8;
    if (size === 1) {
      size = u32(b, pos + 8) * 2 ** 32 + u32(b, pos + 12);
      body = pos + 16;
    } else if (size === 0) size = to - pos;
    if (size < 8 || pos + size > to) break;
    out.push({ type: ascii(b, pos + 4, 4), start: pos, size, body });
    pos += size;
  }
  return out;
}

/** moov bytes → position and location boxes (offsets relative to moov). */
export function locationInMoov(moov: Uint8Array): Mp4Location {
  const result: Mp4Location = { gps: null, boxes: [] };
  const top = children(moov, 8, moov.length);
  const metas = [...top.filter((c) => c.type === 'meta')];
  for (const udta of top.filter((c) => c.type === 'udta')) {
    for (const c of children(moov, udta.body, udta.start + udta.size)) {
      if (c.type === '©xyz') {
        // 2-byte length, 2-byte language, then the ISO 6709 text.
        const length = (moov[c.body] << 8) | moov[c.body + 1];
        result.gps ??= parseIso6709(ascii(moov, c.body + 4, Math.min(length, c.start + c.size - c.body - 4)));
        result.boxes.push({ start: c.start, size: c.size });
      } else if (c.type === 'loci') {
        // version/flags (4), language (2), name (NUL-terminated), role (1), longitude, latitude (signed 16.16).
        let at = c.body + 6;
        while (at < c.start + c.size && moov[at] !== 0) at++;
        at += 2;
        if (at + 8 <= c.start + c.size) {
          const fixed = (o: number) => (u32(moov, o) | 0) / 65536;
          result.gps ??= parseIso6709(`${signed(fixed(at + 4))}${signed(fixed(at))}`);
        }
        result.boxes.push({ start: c.start, size: c.size });
      }
      else if (c.type === 'meta') metas.push(c);
    }
  }
  for (const meta of metas) {
    // ISO meta is a full box (4 bytes version/flags); QuickTime's isn't: its first child (hdlr) starts right away.
    const body = ascii(moov, meta.body + 4, 4) === 'hdlr' ? meta.body : meta.body + 4;
    const parts = children(moov, body, meta.start + meta.size);
    const keys = parts.find((p) => p.type === 'keys');
    const ilst = parts.find((p) => p.type === 'ilst');
    if (!keys || !ilst) continue;
    // keys: version/flags, count, then { size, namespace, name } per key (1-based index).
    let index = 0;
    let pos = keys.body + 8;
    const end = keys.start + keys.size;
    while (pos + 8 <= end) {
      const size = u32(moov, pos);
      if (size < 8 || pos + size > end) break;
      index++;
      if (ascii(moov, pos + 8, size - 8) === APPLE_KEY) {
        for (const item of children(moov, ilst.body, ilst.start + ilst.size)) {
          if (u32(moov, item.start + 4) !== index) continue;
          const data = children(moov, item.body, item.start + item.size).find((d) => d.type === 'data');
          // data: type (4) + locale (4), then the text.
          if (data) result.gps ??= parseIso6709(ascii(moov, data.body + 8, data.start + data.size - data.body - 8));
          result.boxes.push({ start: item.start, size: item.size });
        }
      }
      pos += size;
    }
  }
  return result;
}

/** Position + location boxes (absolute offsets) of an MP4/MOV, or null when it has no readable moov. */
export async function readMp4Location(read: Read, fileSize: number): Promise<Mp4Location | null> {
  const moov = await findMoov(read, fileSize);
  if (!moov || moov.size > MAX_MOOV) return null;
  const bytes = await read(moov.start, moov.size);
  if (bytes.length < moov.size) return null;
  const found = locationInMoov(bytes);
  return { gps: found.gps, boxes: found.boxes.map((b) => ({ start: moov.start + b.start, size: b.size })) };
}

/** Turns location boxes inside `bytes` (which starts at file offset `base`) into zero-filled `free` boxes. */
export function wipeBoxes(bytes: Uint8Array, base: number, boxes: { start: number; size: number }[]) {
  for (const box of boxes) {
    const at = box.start - base;
    // Always a plain 32-bit size header (even if the box had a 64-bit one): size, "free", zeros.
    bytes.set([box.size >>> 24, (box.size >>> 16) & 0xff, (box.size >>> 8) & 0xff, box.size & 0xff, 0x66, 0x72, 0x65, 0x65], at);
    bytes.fill(0, at + 8, at + box.size);
  }
}
