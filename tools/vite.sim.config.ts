import { defineConfig } from 'vite';

// Frozen dev server for long headless simulations: no HMR, no file watching,
// so editing code during a run cannot reload the page mid-simulation.
export default defineConfig({
  base: './',
  server: { port: 5174, hmr: false, watch: { ignored: ['**/*'] } },
});
