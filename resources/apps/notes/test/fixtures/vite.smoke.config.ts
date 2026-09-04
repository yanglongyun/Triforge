// 冒烟测试专用:把真实的 App 打成一份 IIFE。
// jsdom 不支持 ES module 的 <script>,而正式产物是 ESM(emoji 数据还是动态 chunk),
// 直接塞进去会抛 "Cannot use 'import.meta' outside a module"。
// 这里只改打包格式,组件和入口都是真的那份。
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('../../ui'),
  plugins: [vue(), tailwind()],
  resolve: { alias: { '@': here('../../ui/src') } },
  // lib 模式默认不注入 NODE_ENV,Vue 的开发分支会去读 process.env
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: here('../../ui/.smoke'),
    emptyOutDir: true,
    target: 'es2022',
    lib: { entry: here('../../ui/src/main.js'), formats: ['iife'], name: 'NotesSmoke', fileName: () => 'smoke.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
