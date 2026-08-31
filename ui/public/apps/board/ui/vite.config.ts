import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  base: './',
  plugins: [react()],
  // 状态词表只有一份，前后端共用；别名让 UI 直接吃服务端那个文件
  resolve: { alias: { '@shared': here('../src/shared') } },
  build: { outDir: here('dist'), emptyOutDir: true, target: 'es2022' },
  server: { proxy: { '/api': 'http://127.0.0.1:7420' } },
});
