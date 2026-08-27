import { defineConfig } from 'vite';

// base './' => build relocabile (GitHub Pages, arcade kiosk, sottocartelle cliente)
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 6000,
  },
  server: {
    host: true,
  },
});
