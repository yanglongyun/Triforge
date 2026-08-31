// 在 jsdom 里跑一遍真实组件树。「一挂载就抛错、整页白屏」必须在这里被拦住。
import { createRoot } from 'react-dom/client';
import { App } from '../../ui/src/App';

declare global {
  interface Window { __smoke: () => void; __errors: string[] }
}

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.error?.message ?? e.message)));

window.__smoke = () => {
  const note = (kind: string) => (error: unknown) =>
    window.__errors.push(`${kind}: ${error instanceof Error ? error.message : String(error)}`);
  createRoot(document.getElementById('root')!, {
    onUncaughtError: note('uncaught'),
    onCaughtError: note('caught'),
  }).render(<App />);
};
