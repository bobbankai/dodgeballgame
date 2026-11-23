import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Tidebreakers is its own game (Babylon.js + WebGPU); it shares only node_modules with the rest of the repo.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: 'public',
  server: { port: 5175, host: true },
  assetsInclude: ['**/*.wgsl'],
  build: {
    outDir: fileURLToPath(new URL('../dist-tidebreakers', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
  },
});
