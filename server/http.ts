import http from "http";
import { handleApi } from "./api/index.js";
import { attachWs } from "./realtime.js";
import { serve } from "./static.js";
import { startWatcher } from "./watcher.js";
import { isTrustedOrigin } from "./origin.js";
import { track } from "./telemetry.js";
import { seedPresetWidgets, sweepTrash } from "./service/widgets.js";
import { startWidgetSiteSweeper } from "./service/widgetsite.js";

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
      startWatcher(); // 工作区文件监听:磁盘上的任何变化 → 树自动刷新
      track("app_open"); // 匿名遥测(仅打包应用;设置可关,见 telemetry.ts)
      seedPresetWidgets(); // 预装组件落地到组件的家 —— 之后就是用户自己的组件(可改可删)
      sweepTrash();        // 回收站里躺满 30 天的真删
      startWidgetSiteSweeper(); // 组件站点闲置回收
      console.log(`Workbench running on http://127.0.0.1:${port}`);
      resolve(server);
    });
    server.on("error", reject);
  });

export { startServer };
