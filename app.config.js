// Expo config = app.json + a deterministic runtime version.
//
// The runtime version decides which over-the-air updates an installed app may
// load: only JS built for exactly the same native code. Expo's "fingerprint"
// policy gave a different value on every machine (CI APK job, CI update job,
// laptop), so APKs never matched their updates. This hash covers only files
// committed to git that can change the native app, so the same commit gives
// the same value everywhere. Changing any of them means a new APK.
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const NATIVE_INPUTS = ['package-lock.json', 'app.json', 'modules', 'plugins', 'patches', 'certs'];
const SKIP = new Set(['node_modules', 'build', '.gradle', '.cxx', 'Pods', '.DS_Store']);

function listFiles(rel) {
  const abs = path.join(__dirname, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs
    .readdirSync(abs)
    .filter((name) => !SKIP.has(name))
    .sort()
    .flatMap((name) => listFiles(path.posix.join(rel, name)));
}

function nativeRuntimeVersion() {
  const hash = createHash('sha256');
  for (const file of NATIVE_INPUTS.flatMap(listFiles)) {
    hash.update(file).update('\0').update(fs.readFileSync(path.join(__dirname, file))).update('\0');
  }
  return `n-${hash.digest('hex').slice(0, 20)}`;
}

module.exports = ({ config }) => ({ ...config, runtimeVersion: nativeRuntimeVersion() });
