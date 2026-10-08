// Node stand-in for expo-file-system (only what the connectors use).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = process.env.SHIM_ROOT ?? '/tmp/lens-shim';
mkdirSync(join(ROOT, 'cache'), { recursive: true });
mkdirSync(join(ROOT, 'doc'), { recursive: true });
export const Paths = { cache: { path: join(ROOT, 'cache') }, document: { path: join(ROOT, 'doc') }, availableDiskSpace: 1e12 };
export enum UploadType { BINARY_CONTENT = 0, MULTIPART = 1 }
export enum FileMode { ReadOnly = 'r' }
export class Directory { path: string; constructor(base: any, name?: string) { this.path = name ? join(base.path ?? base, name) : (base.path ?? base); } create() { mkdirSync(this.path, { recursive: true }); } list() { return []; } }
export class File {
  path: string;
  constructor(base: any, name?: string) { this.path = name ? join(base.path ?? base, name) : String(base.path ?? base).replace(/^file:\/\//, ''); }
  get uri() { return `file://${this.path}`; }
  get exists() { return existsSync(this.path); }
  get size() { return statSync(this.path).size; }
  get md5() { return createHash('md5').update(readFileSync(this.path)).digest('hex'); }
  create() { writeFileSync(this.path, ''); }
  write(b: Uint8Array) { writeFileSync(this.path, b); }
  delete() { rmSync(this.path, { force: true }); }
  open() { const fd = openSync(this.path, 'r'); return { offset: 0, readBytes(n: number) { const buf = Buffer.alloc(n); const got = readSync(fd, buf, 0, n, this.offset); this.offset += got; return new Uint8Array(buf.subarray(0, got)); }, close() { closeSync(fd); }, size: statSync(this.path).size }; }
  async upload(url: string, o: any) {
    const data = readFileSync(this.path);
    let body: any = data;
    const headers = { ...(o.headers ?? {}) };
    if (o.uploadType === UploadType.MULTIPART) {
      const form = new FormData();
      for (const [k, v] of Object.entries(o.parameters ?? {})) form.append(k, String(v));
      form.append(o.fieldName ?? 'file', new Blob([data]), 'file');
      body = form;
    }
    const res = await fetch(url, { method: o.httpMethod ?? 'POST', headers, body });
    o.onProgress?.({ bytesSent: data.length, totalBytes: data.length });
    const out: Record<string, string> = {}; res.headers.forEach((v, k) => (out[k] = v));
    return { status: res.status, body: await res.text(), headers: out };
  }
  static async downloadFileAsync(url: string, dest: File, o: any = {}) { const r = await fetch(url, { headers: o.headers }); writeFileSync(dest.path, Buffer.from(await r.arrayBuffer())); return dest; }
}
