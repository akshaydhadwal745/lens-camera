#!/usr/bin/env node
// Publishes the current JS as an over-the-air update (self-hosted Expo Updates).
//
//   OTA_PRIVATE_KEY=<pem> WEB_BUCKET=<bucket> WEB_ORIGIN=https://lens.instagrowapp.com \
//     node scripts/ota-publish.mjs android [--dry-run]
//
// 1. Runtime version = hash of the committed native inputs (app.config.js),
//    the same value the APK was built with.
// 2. `expo export` → bundle + assets, uploaded content-addressed (sha256) to
//    s3://<bucket>/ota/a/<hash>.<ext> (immutable; served by CloudFront).
// 3. Manifest (Expo Updates protocol v1) signed with our private key, stored at
//    s3://<bucket>/ota/m/<platform>/<runtime>.json for the API's /v1/updates.
// The update id is derived from the content, so publishing unchanged JS is a no-op.
import { execFileSync } from 'node:child_process';
import { createHash, sign } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const platform = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (platform !== 'android' && platform !== 'ios') throw new Error('usage: ota-publish.mjs <android|ios> [--dry-run]');
const { OTA_PRIVATE_KEY, WEB_BUCKET, WEB_ORIGIN } = process.env;
if (!OTA_PRIVATE_KEY || !WEB_ORIGIN || (!WEB_BUCKET && !dryRun)) throw new Error('OTA_PRIVATE_KEY, WEB_ORIGIN and WEB_BUCKET are required');

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
const npx = (...args) => run('npx', args);

const expoClient = JSON.parse(npx('expo', 'config', '--json', '--type', 'public'));
const runtime = expoClient.runtimeVersion;
if (typeof runtime !== 'string' || !runtime) throw new Error('No runtimeVersion string in the Expo config');
console.log(`runtime ${runtime}`);

const out = 'dist-ota';
rmSync(out, { recursive: true, force: true });
npx('expo', 'export', '--platform', platform, '--output-dir', out);
const meta = JSON.parse(readFileSync(join(out, 'metadata.json'), 'utf8')).fileMetadata[platform];

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', json: 'application/json' };
const staging = join(out, 'upload');
mkdirSync(staging, { recursive: true });

/** Copies a file to its content address and returns the manifest's Asset entry. */
function asset(path, ext, contentType, key) {
  const bytes = readFileSync(join(out, path));
  const sha = createHash('sha256').update(bytes);
  const hex = sha.copy().digest('hex');
  const name = `${hex}.${ext}`;
  cpSync(join(out, path), join(staging, name));
  return {
    hash: sha.digest('base64url'),
    key: key ?? createHash('md5').update(bytes).digest('hex'),
    contentType,
    fileExtension: `.${ext}`,
    url: `${WEB_ORIGIN}/ota/a/${name}`,
  };
}

const launchAsset = asset(meta.bundle, 'bundle', 'application/javascript', 'bundle');
delete launchAsset.fileExtension; // ignored for the launch asset
const assets = meta.assets.map((a) => asset(a.path, a.ext, TYPES[a.ext] ?? 'application/octet-stream'));

// Same JS + assets + runtime = same id (re-running CI doesn't announce an update).
const digest = createHash('sha256')
  .update([runtime, launchAsset.hash, ...assets.map((a) => a.hash)].join('\n'))
  .digest('hex');
const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;

const manifestUrl = `${WEB_ORIGIN}/ota/m/${platform}/${runtime}.json`;
const current = await fetch(manifestUrl, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (current && JSON.parse(current.manifest).id === id) {
  console.log(`unchanged (update ${id} already published)`);
  process.exit(0);
}

const manifest = JSON.stringify({
  id,
  createdAt: new Date().toISOString(),
  runtimeVersion: runtime,
  launchAsset,
  assets,
  metadata: {},
  extra: { expoClient },
});
// Expo SFV dictionary; the app checks it against certs/certificate.pem.
const signature = `sig="${sign('RSA-SHA256', Buffer.from(manifest), OTA_PRIVATE_KEY).toString('base64')}", keyid="main"`;
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ manifest, signature }));
console.log(`update ${id}: bundle + ${assets.length} assets`);

if (dryRun) {
  console.log(`dry run: files in ${staging}, manifest in ${join(out, 'manifest.json')}`);
  process.exit(0);
}
// Files first (immutable, never deleted), then the manifest that points at them.
run('aws', ['s3', 'sync', staging, `s3://${WEB_BUCKET}/ota/a/`, '--size-only', '--only-show-errors', '--cache-control', 'public, max-age=31536000, immutable']);
run('aws', ['s3', 'cp', join(staging, launchAsset.url.split('/').pop()), `s3://${WEB_BUCKET}/ota/a/${launchAsset.url.split('/').pop()}`, '--only-show-errors', '--content-type', 'application/javascript', '--cache-control', 'public, max-age=31536000, immutable']);
run('aws', ['s3', 'cp', join(out, 'manifest.json'), `s3://${WEB_BUCKET}/ota/m/${platform}/${runtime}.json`, '--only-show-errors', '--content-type', 'application/json', '--cache-control', 'no-cache']);
console.log(`published ${id} for ${platform} runtime ${runtime}`);
