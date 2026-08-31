import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { uiDir } from '../config.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const MISSING_BUILD = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notes — 还没构建</title>
<style>body{font:16px/1.7 ui-sans-serif,system-ui,sans-serif;margin:0;display:grid;place-items:center;
min-height:100vh;background:#0f1115;color:#e7e9ee}main{max-width:34rem;padding:2rem}
code{background:#1b1f27;padding:.2em .5em;border-radius:.4em;font-size:.9em}h1{font-size:1.4rem}</style>
</head><body><main><h1>界面还没构建</h1>
<p>先跑一次：</p><p><code>npm run setup</code></p>
<p>然后重启：<code>node bin/notes.mjs start</code></p></main></body></html>`;

/** 静态资源。带 hash 的文件长缓存,index.html 永不缓存(否则改了界面刷不出来)。 */
export function serveStatic(req, res, url) {
  const root = uiDir();
  if (!existsSync(join(root, 'index.html'))) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(MISSING_BUILD);
    return;
  }

  const requested = decodeURIComponent(url.pathname);
  const candidate = resolve(root, '.' + normalize(requested));
  // 目录穿越:任何解析后跑出 root 的路径一律当没有,回落到 index.html
  const inRoot = candidate === root || candidate.startsWith(root + '/');
  const file = inRoot && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(root, 'index.html');

  const isEntry = file.endsWith('index.html');
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': isEntry ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
