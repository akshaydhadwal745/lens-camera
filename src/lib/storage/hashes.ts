// Provider checksums computed on the phone, to verify that what a storage
// saved is byte-for-byte what we sent.
import * as Crypto from 'expo-crypto';
import type { File } from 'expo-file-system';

import { readBytesAt } from './http';

const MB4 = 4 * 1024 * 1024;

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Dropbox `content_hash`: SHA-256 of each 4 MiB block, concatenated, then
 * SHA-256 of that (hex). Block hashing is native.
 */
export async function dropboxContentHash(file: File, size: number): Promise<string> {
  const digests: Uint8Array[] = [];
  for (let offset = 0; offset < size; offset += MB4) {
    const block = readBytesAt(file, offset, Math.min(MB4, size - offset));
    digests.push(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, block as Uint8Array<ArrayBuffer>)));
  }
  const joined = new Uint8Array(new ArrayBuffer(digests.length * 32));
  digests.forEach((d, i) => joined.set(d, i * 32));
  return hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, joined));
}

// ---------- OneDrive QuickXorHash ----------
// 160-bit value; each byte is XORed in at a bit position that advances by 11
// (mod 160); finally the 64-bit little-endian length is XORed into the last
// 8 bytes. Result is base64. Spec: learn.microsoft.com, "QuickXorHash".

const WIDTH_BYTES = 20;
const SHIFT = 11;
const WIDTH_BITS = 160;
// Bit position cycles with period 160 (gcd(11, 160) = 1): precompute it.
const POS_BYTE = new Uint8Array(WIDTH_BITS);
const POS_BIT = new Uint8Array(WIDTH_BITS);
for (let i = 0; i < WIDTH_BITS; i++) {
  const bit = (i * SHIFT) % WIDTH_BITS;
  POS_BYTE[i] = bit >> 3;
  POS_BIT[i] = bit & 7;
}

export class QuickXorHash {
  private cells = new Uint8Array(WIDTH_BYTES);
  private length = 0;

  update(bytes: Uint8Array) {
    const cells = this.cells;
    let step = this.length % WIDTH_BITS;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      const at = POS_BYTE[step];
      const shift = POS_BIT[step];
      cells[at] ^= (b << shift) & 0xff;
      if (shift) cells[at === WIDTH_BYTES - 1 ? 0 : at + 1] ^= b >> (8 - shift);
      step = step === WIDTH_BITS - 1 ? 0 : step + 1;
    }
    this.length += bytes.length;
  }

  digestBase64(): string {
    const out = this.cells.slice();
    let len = this.length;
    for (let i = 0; i < 8; i++) {
      out[WIDTH_BYTES - 8 + i] ^= len & 0xff;
      len = Math.floor(len / 256);
    }
    return base64(out);
  }
}

export function quickXorHash(file: File, size: number): string {
  const hash = new QuickXorHash();
  for (let offset = 0; offset < size; offset += MB4) hash.update(readBytesAt(file, offset, Math.min(MB4, size - offset)));
  return hash.digestBase64();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

// ---------- Incremental SHA-1 (Box) ----------
// expo-crypto only hashes whole buffers; Box needs the SHA-1 of the whole
// file at the end of a chunked upload, so we keep a running state.

export class Sha1 {
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  private block = new Uint8Array(64);
  private used = 0;
  private length = 0;
  private w = new Uint32Array(80);

  update(bytes: Uint8Array) {
    this.length += bytes.length;
    let i = 0;
    if (this.used) {
      const take = Math.min(64 - this.used, bytes.length);
      this.block.set(bytes.subarray(0, take), this.used);
      this.used += take;
      i = take;
      if (this.used < 64) return;
      this.compress(this.block, 0);
      this.used = 0;
    }
    for (; i + 64 <= bytes.length; i += 64) this.compress(bytes, i);
    if (i < bytes.length) {
      this.block.set(bytes.subarray(i), 0);
      this.used = bytes.length - i;
    }
  }

  private compress(data: Uint8Array, at: number) {
    const w = this.w;
    for (let t = 0; t < 16; t++) {
      const p = at + t * 4;
      w[t] = (data[p] << 24) | (data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3];
    }
    for (let t = 16; t < 80; t++) {
      const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16];
      w[t] = (x << 1) | (x >>> 31);
    }
    let [a, b, c, d, e] = this.h;
    for (let t = 0; t < 80; t++) {
      const f = t < 20 ? (b & c) | (~b & d) : t < 40 ? b ^ c ^ d : t < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
      const k = t < 20 ? 0x5a827999 : t < 40 ? 0x6ed9eba1 : t < 60 ? 0x8f1bbcdc : 0xca62c1d6;
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = temp;
    }
    const h = this.h;
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
  }

  /** Raw 20-byte digest (the hash can't be updated afterwards). */
  digest(): Uint8Array {
    const bitsHigh = Math.floor((this.length * 8) / 2 ** 32);
    const bitsLow = (this.length * 8) >>> 0;
    const pad = new Uint8Array(((this.used < 56 ? 56 : 120) - this.used) + 8);
    pad[0] = 0x80;
    const n = pad.length;
    pad[n - 8] = bitsHigh >>> 24;
    pad[n - 7] = bitsHigh >>> 16;
    pad[n - 6] = bitsHigh >>> 8;
    pad[n - 5] = bitsHigh;
    pad[n - 4] = bitsLow >>> 24;
    pad[n - 3] = bitsLow >>> 16;
    pad[n - 2] = bitsLow >>> 8;
    pad[n - 1] = bitsLow;
    const length = this.length;
    this.update(pad);
    this.length = length;
    const out = new Uint8Array(20);
    this.h.forEach((v, i) => {
      out[i * 4] = v >>> 24;
      out[i * 4 + 1] = v >>> 16;
      out[i * 4 + 2] = v >>> 8;
      out[i * 4 + 3] = v;
    });
    return out;
  }
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
