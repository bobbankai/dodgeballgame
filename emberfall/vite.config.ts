import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Emberfall is a separate game; it lives beside Inkbound and shares only node_modules.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: 'public',
  server: { port: 5174, host: true },
  build: {
    outDir: fileURLToPath(new URL('../dist-emberfall', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
});
