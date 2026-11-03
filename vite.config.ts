import { defineConfig } from 'vite';

export default defineConfig({
  // relative paths, so the built game works from any address (GitHub Pages, a folder, a zip)
  base: './',
  assetsInclude: ['**/*.glb'],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
