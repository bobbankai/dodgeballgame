import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5180, host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
