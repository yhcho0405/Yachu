import { defineConfig } from 'vite';
export default defineConfig({
  build: { sourcemap: false, chunkSizeWarningLimit: 750 },
  server: { host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
});
