// Runs the app's LiveUpload against the deployed API while a fake recording
// grows, then rewrites its header (as Android's MP4 writer does) and checks
// the cloud copy is byte-identical. Usage: API=https://…/ node test-live.mjs
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, openSync, readFileSync, rmSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';

import { File } from 'expo-file-system';
import { setAuth } from '../../src/lib/api';
import { LiveUpload } from '../../src/lib/live-upload';
import { newId } from '../../src/lib/types';

const ok = (c: boolean, m: string) => { console.log(c ? '✔' : '✘', m); if (!c) process.exitCode = 1; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

const reg = await (await fetch(`${process.env.EXPO_PUBLIC_API_URL}/v1/devices`, { method: 'POST' })).json();
setAuth(reg.token);

const camDir = join(process.env.SHIM_ROOT ?? '/tmp/lens-shim', 'cache', 'Camera');
rmSync(camDir, { recursive: true, force: true });
mkdirSync(camDir, { recursive: true });
const id = newId();
const reports: { sent: number; total: number; recording: boolean }[] = [];
const live = new LiveUpload(id, { canSend: () => true, onProgress: (sent, total, recording) => reports.push({ sent, total, recording }) });

// "Recording": header placeholder, then 2 MB of samples every 300 ms up to 42 MB.
const path = join(camDir, 'b7f3c1d2-rec.mp4');
appendFileSync(path, Buffer.alloc(64 * 1024));
for (let size = 64 * 1024; size < 42 * MB; size += 2 * MB) {
  appendFileSync(path, randomBytes(2 * MB));
  await sleep(300);
}
await sleep(6000); // a few ticks while "still recording"
const sentDuring = (live as any).sent as Map<number, string>;
ok(sentDuring.size >= 2 && !sentDuring.has(1) && !sentDuring.has(2), `sent ${[...sentDuring.keys()].join(',')} during recording; header blocks held back`);
const lastDuring = reports[reports.length - 1];
ok(
  !!lastDuring && lastDuring.recording && lastDuring.sent >= sentDuring.size * 8 * MB && lastDuring.total >= 42 * MB,
  `progress while recording: ${((lastDuring?.sent ?? 0) / MB).toFixed(0)} of ${((lastDuring?.total ?? 0) / MB).toFixed(0)} MB in cloud`,
);

// "Stop": the writer patches the header and appends its index (moov).
const fd = openSync(path, 'r+');
writeSync(fd, Buffer.from('MDAT-SIZE+MOOV-REWRITTEN'), 0, 24, 40);
closeSync(fd);
appendFileSync(path, randomBytes(700 * 1024));

const fractions: number[] = [];
const media = await live.finish(new File(path), (f) => fractions.push(f));
ok(!!media?.originalReady, 'finished: upload completed with the final size');
const final = reports[reports.length - 1];
const finalSize = readFileSync(path).length;
ok(!final.recording && final.sent === finalSize && final.total === finalSize && fractions[fractions.length - 1] === 1, 'progress after stop ends at 100% of the final size');
const cloud = Buffer.from(await (await fetch(media!.url!)).arrayBuffer());
ok(cloud.equals(readFileSync(path)), `cloud copy byte-identical (${(cloud.length / MB).toFixed(1)} MB)`);
await fetch(`${process.env.EXPO_PUBLIC_API_URL}/v1/media/${id}/forever`, { method: 'DELETE', headers: { authorization: `Bearer ${reg.token}` } });

// --- Fallback: live upload interrupted after sending blocks; the regular
// uploader finishes, and must re-send blocks whose bytes changed since. ---
{
  const { uploadEntry } = await import('../../src/lib/uploader');
  const { copyFileSync } = await import('node:fs');
  const id2 = newId();
  rmSync(camDir, { recursive: true, force: true });
  mkdirSync(camDir, { recursive: true });
  const live2 = new LiveUpload(id2, { canSend: () => true });
  const path2 = join(camDir, 'c8e4d2a1-rec.mp4');
  appendFileSync(path2, randomBytes(34 * MB));
  await sleep(7000);
  const sent2 = [...((live2 as any).sent as Map<number, string>).keys()];
  (live2 as any).stopped = true; clearInterval((live2 as any).timer); // "app killed"
  // After stop: header patched AND (worst case) a byte inside already-sent block 3 changed.
  const fd2 = openSync(path2, 'r+');
  writeSync(fd2, Buffer.from('HDR'), 0, 3, 40);
  writeSync(fd2, Buffer.from('X'), 0, 1, 2 * 8 * MB + 1234);
  closeSync(fd2);
  const capDir = join(process.env.SHIM_ROOT ?? '/tmp/lens-shim', 'doc', 'captures');
  mkdirSync(capDir, { recursive: true });
  copyFileSync(path2, join(capDir, `${id2}.mp4`));
  const size2 = readFileSync(path2).length;
  const result = await uploadEntry(
    { id: id2, kind: 'video', fileName: `${id2}.mp4`, contentType: 'video/mp4', size: size2, createdAt: Date.now(), streamed: true },
    { onProgress: () => {}, isCancelled: () => false, concurrency: 2 },
  );
  ok(sent2.includes(3), `interrupted after sending ${sent2.join(',')}`);
  const cloud2 = Buffer.from(await (await fetch(result.media.url!)).arrayBuffer());
  ok(result.originalDone && cloud2.equals(readFileSync(path2)), 'regular uploader finished it; changed block re-sent; byte-identical');
  await fetch(`${process.env.EXPO_PUBLIC_API_URL}/v1/media/${id2}/forever`, { method: 'DELETE', headers: { authorization: `Bearer ${reg.token}` } });
}
