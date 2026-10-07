import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig(({ mode }) => ({
  root: resolve('apps/web'),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8080', '/healthz': 'http://127.0.0.1:8080' },
  },
  build: { outDir: resolve(mode === 'static' ? 'out' : 'dist/web'), emptyOutDir: true, chunkSizeWarningLimit: 1800 },
}));
