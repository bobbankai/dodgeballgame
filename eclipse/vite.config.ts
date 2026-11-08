import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Eclipse: Fallen Gods lives beside Inkbound and Emberfall and shares only node_modules.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  publicDir: 'public',
  server: { port: 5180, host: true },
  optimizeDeps: {
    // Havok and Recast ship their own WASM; pre-bundling breaks their relative wasm URLs.
    exclude: ['@babylonjs/havok', '@recast-navigation/core', '@recast-navigation/wasm'],
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    outDir: fileURLToPath(new URL('../dist-eclipse', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
    sourcemap: false,
  },
});
