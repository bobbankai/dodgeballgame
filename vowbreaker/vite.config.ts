import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Vowbreaker is a separate game; it lives beside Inkbound and Emberfall and shares only node_modules.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: 'public',
  assetsInclude: ['**/*.glb'],
  server: { port: 5175, host: true },
  build: {
    outDir: fileURLToPath(new URL('../dist-vowbreaker', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
});
