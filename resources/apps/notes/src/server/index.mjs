import { createServer } from 'node:http';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { HOST, PORT, dataDir, runtimeFile } from '../config.mjs';
import { makeApi } from './api.mjs';
import { serveStatic } from './static.mjs';
import { closeAll } from './events.mjs';
import { db } from '../store/db.mjs';

export function readRuntime() {
  try { return JSON.parse(readFileSync(runtimeFile(), 'utf8')); } catch { return null; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export function runningInstance() {
  const info = readRuntime();
  if (info?.pid && alive(info.pid)) return info;
  if (info) rmSync(runtimeFile(), { force: true });
  return null;
}

export function startServer({ port = PORT } = {}) {
  db();
  let handleApi = null;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      // 宿主(见 /apps 契约)拿它探活;跟 /api/* 分开放,静态资源回落不会挡住它。
      if (url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end('{"ok":true}');
        return;
      }
      if (await handleApi(req, res, url)) return;
      serveStatic(req, res, url);
    } catch (error) {
      console.error('[notes] 请求处理失败', error);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('server error');
    }
  });
  handleApi = makeApi();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      const actual = server.address().port;
      const url = `http://${HOST}:${actual}`;
      mkdirSync(dataDir(), { recursive: true });
      writeFileSync(runtimeFile(), JSON.stringify({ pid: process.pid, port: actual, url }, null, 2));
      /** 干净关闭:断开一切长连接(SSE 挂着的话进程不会退)。 */
      const close = () => {
        closeAll();
        server.closeAllConnections?.();
        server.close();
        if (existsSync(runtimeFile()) && readRuntime()?.pid === process.pid) rmSync(runtimeFile(), { force: true });
      };
      const shutdown = () => { close(); process.exit(0); };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      resolve({ server, url, port: actual, close });
    });
  });
}
