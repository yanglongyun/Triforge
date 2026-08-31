import { createServer } from 'node:http';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { HOST, PORT, dataDir, runtimeFile } from '../config.mjs';
import { handleApi } from './api.mjs';
import { serveStatic } from './static.mjs';
import { closeAll } from './events.mjs';
import { db } from '../store/db.mjs';

export function readRuntime() {
  try { return JSON.parse(readFileSync(runtimeFile(), 'utf8')); } catch { return null; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** 已经在跑的实例。留下的陈旧 runtime.json 顺手清掉。 */
export function runningInstance() {
  const info = readRuntime();
  if (info?.pid && alive(info.pid)) return info;
  if (info) rmSync(runtimeFile(), { force: true });
  return null;
}

export function startServer({ port = PORT } = {}) {
  db(); // 建表要早于第一个请求,起不来就当场报错,别等用户点了才炸
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      // 健康检查:宿主拿它判活,不走 /api 前缀。
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (await handleApi(req, res, url)) return;
      serveStatic(req, res, url);
    } catch (error) {
      console.error('[board] 请求处理失败', error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('server error');
    }
  });
  server.keepAliveTimeout = 0; // SSE 自己管连接寿命

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      const url = `http://${HOST}:${port}`;
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(runtimeFile(), JSON.stringify({ pid: process.pid, port, url }, null, 2));
      const shutdown = () => {
        closeAll();
        server.close();
        if (existsSync(runtimeFile()) && readRuntime()?.pid === process.pid) rmSync(runtimeFile(), { force: true });
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      resolve({ server, url, port });
    });
  });
}
