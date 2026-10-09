import { createHash, randomBytes } from 'node:crypto';
export enum CryptoDigestAlgorithm { SHA1 = 'SHA-1', SHA256 = 'SHA-256' }
export async function digest(alg: CryptoDigestAlgorithm, data: Uint8Array) {
  const b = createHash(alg === CryptoDigestAlgorithm.SHA1 ? 'sha1' : 'sha256').update(data).digest();
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
export const getRandomBytes = (n: number) => new Uint8Array(randomBytes(n));
