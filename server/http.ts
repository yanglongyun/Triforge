import http from "http";
import { handleApi } from "./api/index.js";
import { attachWs } from "./realtime.js";
import { serve } from "./static.js";
import { startWatcher } from "./watcher.js";
import { migrateOnBoot } from "./service/agents.js";
import { isTrustedOrigin } from "./origin.js";
import { track } from "./telemetry.js";
import { startGadgetRuntime } from "./gadgets.js";
import { seedPresetApps } from "./service/apps.js";

const startServer = async (port = 9506) =>
  new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      // 同源门卫:带副作用的方法(非 GET/HEAD)必须来自应用自身,挡住恶意网页的跨源写。
      // GET/HEAD 放行(<img>/webview 拉资源不带同源保证,且它们没有副作用)。
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD" && !isTrustedOrigin(req.headers.origin, port)) {
        res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "forbidden origin" }));
        return;
      }
      const result = await handleApi(req, res);
      if (result === null) {
        const url = new URL(req.url || "/", "http://127.0.0.1");
        serve(res, url.pathname);
      }
    });
    attachWs(server, port);
    server.listen(port, "127.0.0.1", () => {
      migrateOnBoot(); // 历史 .agent.json → SQLite,用户目录从此干净
      startWatcher(); // 工作区文件监听:磁盘上的任何变化 → 树自动刷新
      track("app_open"); // 匿名遥测(仅打包应用;设置可关,见 telemetry.ts)
      seedPresetApps(); // 预装应用落地到工作区 —— 之后它们就是用户自己的应用
      void startGadgetRuntime(port); // 应用后端运行时(workerd):失败只停用 gadget 能力,不拖垮主服务
      console.log(`Workbench running on http://127.0.0.1:${port}`);
      resolve(server);
    });
    server.on("error", reject);
  });

export { startServer };
