import { build } from '../../infra/node_modules/esbuild/lib/main.js';
const shim = { name: 'shim', setup(b) {
  for (const m of ['expo-file-system', 'expo-crypto', 'react-native'])
    b.onResolve({ filter: new RegExp(`^${m}$`) }, () => ({ path: new URL(`./shims/${m}.ts`, import.meta.url).pathname }));
} };
await build({ entryPoints: ['test-live.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'test-live.mjs', plugins: [shim], logLevel: 'error', target: 'node22' });
