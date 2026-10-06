import { defineConfig } from 'vite';

// base must match the GitHub Pages project path: https://techsnazzy.github.io/headband-hero-game/
export default defineConfig({
  base: '/headband-hero-game/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
  },
});
