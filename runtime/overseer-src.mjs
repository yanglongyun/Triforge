// Workbench 应用运行时监理(mini-overseer):跑在 workerd 里,几百行,只干三件事。
//
//   1. 按需装载应用后端:apps/<id>/server.js(经 Node 取码)→ 动态 Worker,
//      globalOutbound: null 物理断网 —— 应用后端摸不到网络,也摸不到磁盘;
//   2. 能力网关:动态 worker 的 env.HOST 是 HostGate 回环桩(带 appId+caps props),
//      manifest 没声明的能力,调了就抛;数据操作全部转发回 Node(appdb 等);
//   3. 桥:/g/<secret>/<appId> 的 WS 升级 → Cap'n Web 会话,把 Gadget entrypoint
//      的门面桩交给宿主(secret 由 Node 生成,防本机其他页面乱连)。
//
// 生命周期与 CF OS 同哲学:全按需,不预热;isolate 内存只当缓存,真状态经 HOST 落库。
import { WorkerEntrypoint } from "cloudflare:workers";
import { newWorkersWebSocketRpcResponse, RpcTarget } from "capnweb";

// 原生 workers-RPC 桩 → capnweb 门面(CF OS overseer 同款 Proxy 手法)
const facade = (stub) => new Proxy(stub, {
  get(target, prop) {
    const m = Reflect.get(target, prop, target);
    if (typeof m !== "function" || typeof prop === "symbol") return m;
    return (...args) => Reflect.apply(m, target, args);
  },
  getPrototypeOf() { return RpcTarget.prototype; },
});

/** 应用后端唯一的对外通道:能力在此把关,动作全部回 Node 执行。 */
export class HostGate extends WorkerEntrypoint {
  #need(cap) {
    const caps = this.ctx.props?.caps || [];
    if (!caps.includes(cap)) throw new Error(`未声明能力:${cap}(在 app.json 的 capabilities 里加上它)`);
  }
  async #node(path, body) {
    const res = await this.env.NODE.fetch(`http://node${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: this.ctx.props?.appId, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(String(data?.error || `host error ${res.status}`));
    return data;
  }
  /** 应用私有 SQLite(能力:db):与前端 workbench.db.exec 同一张库。 */
  async dbExec(sql, params) {
    this.#need("db");
    return this.#node("/api/app/db", { sql: String(sql || ""), params: Array.isArray(params) ? params : [] });
  }
  /** 服务端日志:回流 Node(AI 调试应用后端要看得到)。免声明。 */
  async log(...message) {
    await this.#node("/api/app/server-log", {
      message: message.map((m) => { try { return typeof m === "string" ? m : JSON.stringify(m); } catch { return String(m); } }).join(" "),
    }).catch(() => {});
  }
}

const loadApp = async (env, ctx, appId) => {
  // 取码(带版本):Node 是应用代码与 manifest 的唯一事实来源
  const res = await env.NODE.fetch(`http://node/api/apps/server-code?id=${encodeURIComponent(appId)}`);
  if (!res.ok) throw new Error(`应用后端不可用:${appId}(${res.status})`);
  const { code, capabilities, version } = await res.json();
  return env.LOADER.get(`${appId}@${version}`, () => ({
    compatibilityDate: "2026-02-01",
    mainModule: "server.js",
    modules: { "server.js": String(code) },
    env: { HOST: ctx.exports.HostGate({ props: { appId, caps: capabilities || [] } }) },
    globalOutbound: null, // 物理断网:应用后端只有 HOST 这一条路
  }));
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    const m = /^\/g\/([^/]+)\/([a-z0-9][a-z0-9-]{0,63})$/.exec(url.pathname);
    if (m) {
      if (m[1] !== env.SECRET) return new Response("forbidden", { status: 403 });
      try {
        const worker = await loadApp(env, ctx, m[2]);
        return newWorkersWebSocketRpcResponse(req, facade(worker.getEntrypoint("Gadget")));
      } catch (e) {
        return new Response(String(e?.message || e), { status: 500 });
      }
    }
    return new Response("not found", { status: 404 });
  },
};
