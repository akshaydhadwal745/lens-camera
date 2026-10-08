import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { File, Paths } from 'expo-file-system';
import { s3 } from '../../src/lib/storage/s3';
import { webdav } from '../../src/lib/storage/webdav';
import { UploadCancelled } from '../../src/lib/storage/types';

const ok = (c: boolean, m: string) => { console.log(c ? '✔' : '✘', m); if (!c) process.exitCode = 1; };
const mkAuth = (config: Record<string, string>, secret: string) => ({ config, secret, token: async () => '', refresh: async () => '', saveConfig: async (p: any) => Object.assign(config, p) });

function mkFile(name: string, size: number) {
  const f = new File(Paths.cache, name); writeFileSync(f.path, randomBytes(size)); return f;
}
function job(file: any, name: string, extra: any = {}) {
  const size = file.size; let resume: string | undefined;
  return { file, name, contentType: 'image/heic', size, md5Hex: () => file.md5, onProgress: () => {}, isCancelled: () => false,
    get resume() { return resume; }, saveResume: (r?: string) => { resume = r; }, ...extra };
}
async function fetchBytes(src: { uri: string; headers?: any }) { const r = await fetch(src.uri, { headers: src.headers }); return Buffer.from(await r.arrayBuffer()); }

const which = process.argv[2];
if (which === 's3') {
  const env = Object.fromEntries(readFileSync(process.env.CREDS!, 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
  const auth = mkAuth(
    { endpoint: 'https://s3.ap-south-1.amazonaws.com', region: 'ap-south-1', bucket: 'lens-media-495026846839', prefix: 'e2e-s3conn/Lens/', pathStyle: 'true' },
    JSON.stringify({ accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN }),
  );
  const acct = await s3.account(auth as any); ok(acct.account.includes('lens-media'), `S3 connection test: ${acct.account}`);
  const small = mkFile('small.heic', 300_000);
  const r1 = await s3.upload(auth as any, job(small, 'Lens 2026-10-08 14.30.05 small1.heic') as any);
  ok(r1.checksum === `md5:${small.md5}`, 'S3 small upload verified');
  ok((await fetchBytes(await s3.source(auth as any, r1.ref))).equals(readFileSync(small.path)), 'S3 original opens via presigned link, identical bytes');

  const big = mkFile('big.mov', 20 * 1024 * 1024 + 777);
  let parts = 0; const j = job(big, 'Lens 2026-10-08 14.31.00 big1.mov', { isCancelled: () => parts++ >= 1 });
  try { await s3.upload(auth as any, j as any); ok(false, 'should be interrupted'); } catch (e) { ok(e instanceof UploadCancelled, 'S3 multipart interrupted after 1 part (app killed)'); }
  ok(JSON.parse(j.resume!).parts['1'] !== undefined, 'resume state saved part 1');
  const r2 = await s3.upload(auth as any, { ...job(big, j.name), resume: j.resume, saveResume: () => {} } as any);
  ok((await fetchBytes(await s3.source(auth as any, r2.ref))).equals(readFileSync(big.path)), 'S3 multipart resumed and completed, identical bytes');
  await s3.remove(auth as any, r1.ref); await s3.remove(auth as any, r2.ref);
  const gone = await fetch((await s3.source(auth as any, r1.ref)).uri); ok(gone.status === 404 || gone.status === 403, `S3 delete forever (${gone.status})`);
}
if (which === 'webdav') {
  const auth = mkAuth({ url: 'http://127.0.0.1:8899/Lens/', username: 'lens' }, JSON.stringify({ password: 'pa ss:word!' }));
  const acct = await webdav.account(auth as any); ok(acct.account.startsWith('lens'), `WebDAV connection test (folder created): ${acct.account}`);
  const bad = mkAuth({ url: 'http://127.0.0.1:8899/Lens/', username: 'lens' }, JSON.stringify({ password: 'wrong' }));
  try { await webdav.account(bad as any); ok(false, 'bad password accepted'); } catch (e: any) { ok(/password/.test(e.message), 'WebDAV wrong password rejected'); }
  const f = mkFile('dav.heic', 2_000_000);
  const r = await webdav.upload(auth as any, job(f, 'Lens 2026-10-08 14.32.00 dav1.heic') as any);
  ok(r.ref.includes('dav1'), `WebDAV upload verified (${r.checksum.split(':')[0]})`);
  ok((await fetchBytes(await webdav.source(auth as any, r.ref))).equals(readFileSync(f.path)), 'WebDAV original opens, identical bytes');
  await webdav.remove(auth as any, r.ref);
  const s = await webdav.source(auth as any, r.ref); ok((await fetch(s.uri, { headers: s.headers })).status === 404, 'WebDAV delete forever');
}
