import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  base: './',
  plugins: [react()],
  build: { outDir: here('dist'), emptyOutDir: true, target: 'es2022' },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:7430',
      '/page-': { target: 'ws://127.0.0.1:7430', ws: true },
    },
  },
});
