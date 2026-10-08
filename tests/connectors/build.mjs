import { build } from '../../infra/node_modules/esbuild/lib/main.js';
const shim = { name: 'shim', setup(b) {
  b.onResolve({ filter: /^expo-file-system$/ }, () => ({ path: new URL('./shims/expo-file-system.ts', import.meta.url).pathname }));
  b.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: new URL('./shims/expo-crypto.ts', import.meta.url).pathname }));
} };
for (const name of process.argv.slice(2)) {
  await build({ entryPoints: [`${name}.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `${name}.mjs`, plugins: [shim], logLevel: 'error', target: 'node22' });
}
