import { WorkerEntrypoint } from "cloudflare:workers";

export class HostGate extends WorkerEntrypoint {
  async data() { return { from: "host" }; }
}

// 应用 = 一个完整的网站:自带 fetch handler,静态资源 + API 一体
const APP_CODE = `
const ASSETS = {
  "/index.html": "<h1>我是应用自己托管的前端</h1><script>fetch('/api/notes').then(r=>r.json()).then(d=>document.body.append(JSON.stringify(d)))</script>",
  "/style.css": "body{font:14px system-ui}",
};
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/notes") {
      const h = await env.HOST.data();
      return Response.json({ notes: ["a","b"], host: h });
    }
    const body = ASSETS[url.pathname] || ASSETS["/index.html"];
    return new Response(body, { headers: { "content-type": url.pathname.endsWith(".css") ? "text/css" : "text/html" } });
  },
};`;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/ping") return new Response("pong");
    const m = /^\/app\/([a-z0-9-]+)(\/.*)?$/.exec(url.pathname);
    if (m) {
      const worker = env.LOADER.get("site-app", () => ({
        compatibilityDate: "2026-02-01",
        mainModule: "server.js",
        modules: { "server.js": APP_CODE },
        env: { HOST: ctx.exports.HostGate({ props: { appId: m[1] } }) },
        globalOutbound: null,
      }));
      // 把子路径重写后转发给应用自己的 fetch handler
      const inner = new URL(req.url);
      inner.pathname = m[2] || "/index.html";
      try {
        const ep = worker.getEntrypoint();            // default export
        return await ep.fetch(new Request(inner, req));
      } catch (e) {
        return new Response("FETCH-ERR: " + (e?.message || e), { status: 500 });
      }
    }
    return new Response("nf", { status: 404 });
  },
};
