import { createServer } from 'node:http';
import { createRequestHandler } from './app.js';
import { initializeSchema } from './db/schema.js';
import { database } from './db/connection.js';

const PORT = Number(process.env.PORT) || 9519;
// 默认回落到 127.0.0.1（仅在没有任何宿主/调用方传入 HOST 时生效）：
// 通过 scripts/ramify.mjs 启动的独立 Skill 用法始终显式传入 HOST，默认行为不受影响。
const HOST = process.env.HOST || '127.0.0.1';

initializeSchema();

const server = createServer(createRequestHandler());
server.listen(PORT, HOST, () => {
  console.log(`[ramify-skill] canvas on http://${HOST}:${PORT}`);
});

// 应用契约要求 SIGTERM 后限时干净退出：先停止接受新连接，再关闭数据库连接。
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => process.exit(0), 3000);
  forceExit.unref();
  server.close(() => {
    try { database.close(); } catch { /* 已关闭或不支持，忽略 */ }
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
