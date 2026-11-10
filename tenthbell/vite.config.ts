import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// The Tenth Bell is a separate game; it lives beside the others and shares only node_modules.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: 'public',
  server: { port: 5175, host: true },
  build: {
    outDir: fileURLToPath(new URL('../dist-tenthbell', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 12000,
  },
});
