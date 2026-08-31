import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  base: './',
  plugins: [react()],
  // Excalidraw 内部读这个变量；不定义它构建期会报 process is not defined
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  build: {
    outDir: here('dist'),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2500, // Excalidraw 本来就大，警告没有信息量
  },
  server: { proxy: { '/api': 'http://127.0.0.1:7440' } },
});
