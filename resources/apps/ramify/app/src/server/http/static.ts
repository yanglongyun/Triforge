import { existsSync, readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendText } from './response.js';

// 优先级：RAMIFY_APP_DIR（scripts/ramify.mjs 显式传入）> process.cwd()/dist/public（保留
// 现状：`npm run dev`/`npm start` 均从 app/ 目录执行）> 从当前模块位置推导。最后一项是为
// 应用契约新增的兜底 —— 契约下宿主 spawn 进程的工作目录是仓库根而非 app/，用 cwd 拼路径
// 会找不到 dist/public，需要一个不依赖 cwd 的定位方式。
const cwdDist = join(process.cwd(), 'dist', 'public');
const DIST = process.env.RAMIFY_APP_DIR
  ? join(process.env.RAMIFY_APP_DIR, 'dist', 'public')
  : existsSync(cwdDist)
    ? cwdDist
    : join(dirname(fileURLToPath(import.meta.url)), 'public');
const MIME: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export function serveStatic(res: ServerResponse, requestPath: string) {
  const requested = normalize(requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, ''));
  let file = join(DIST, requested);
  if (relative(DIST, file).startsWith('..')) {
    sendText(res, 403, 'forbidden');
    return;
  }
  if (!existsSync(file)) {
    // SPA fallback 只用于无扩展名的路由路径；缺失的静态资源必须如实 404，
    // 否则旧缓存页面加载已被替换的 hash 资源时会拿到 HTML，应用静默挂死。
    if (extname(requested) !== '') {
      sendText(res, 404, 'not found');
      return;
    }
    file = join(DIST, 'index.html');
  }
  if (!existsSync(file)) {
    sendText(res, 404, 'Ramify runtime is incomplete');
    return;
  }
  const contentType = MIME[extname(file)] || 'application/octet-stream';
  // 带内容 hash 的 assets 永不变化，可长缓存；HTML 壳必须每次回源验证。
  const cacheControl = relative(DIST, file).startsWith('assets')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, {
    'Cache-Control': cacheControl,
    'Content-Type': contentType.startsWith('text/') ? `${contentType}; charset=utf-8` : contentType,
  });
  res.end(readFileSync(file));
}
