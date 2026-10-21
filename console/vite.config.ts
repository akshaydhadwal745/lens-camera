import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Strict CSP (infra/lib/console-stack.ts): no inline scripts or styles in the build.
export default defineConfig({
  plugins: [react()],
  build: { modulePreload: { polyfill: false }, assetsInlineLimit: 0, sourcemap: false },
});
