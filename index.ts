import { startServer } from "./server/index.js";
import { stopAllApps } from "./server/apps/supervisor.js";

const port = Number(process.env.WORKTOP_PORT) || 9506;
await startServer(port);

// 壳退出时 SIGTERM 打到这里:app 子进程是我们 spawn 的,得由我们收尾,
// 不然关掉 Worktop 会在系统里留下一地孤儿进程还占着端口。
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await stopAllApps().catch(() => { /* 尽力而为,别拖着不退 */ });
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
