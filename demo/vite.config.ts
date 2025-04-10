import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '', // use relative paths
  plugins: [react()],
  esbuild: {
    target: 'es2022',
  },
  server: {
    fs: { allow: ['..'] },
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  build: {
    assetsDir: '',
    assetsInlineLimit: (file) => !file.includes('sw.worker'),
  },
});
