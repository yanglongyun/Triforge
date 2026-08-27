// Workbench 应用运行时监理(mini-overseer):跑在 workerd 里,只干三件事。
//
//   1. **应用即网站**:apps/<id>/server.js 是一个完整的 Worker(export default {fetch}),
//      静态资源与 API 都由它自己应答;overseer 只做路由与装载(按需、按代码哈希缓存版本);
//   2. **资源即 binding**(与 Cloudflare 平台同构 —— Worker 纯计算,资源外挂):
//        env.DB     —— D1 接口(本地落 apps/<id>/data.db;上云换真 D1,应用代码一行不改)
//        env.ASSETS —— 静态资源(本地读 apps/<id>/public/;上云换 Workers Assets)
//        env.HOST   —— Workbench 宿主能力(ai / agent / log),上云时降级
//   3. **隔离**:globalOutbound: null 物理断网 —— 应用只能经这三个 binding 碰外界。
//
// 生命周期与 CF OS 同哲学:全按需、不预热;isolate 内存只当缓存,真状态经 DB 落库。
import { WorkerEntrypoint } from "cloudflare:workers";

// ── 注入进每个应用 isolate 的运行时垫片 ──────────────────────────────
// 应用看到的是标准 Cloudflare 形态的 env;底下这些桩把调用回环到 Node。
const RUNTIME_MODULE = `
class D1Result {
  constructor(rows, meta) { this.results = rows; this.success = true; this.meta = meta; }
}

class D1PreparedStatement {
  constructor(host, sql, params) {
    this.host = host;
    this.sql = sql;
    this.params = params || [];
  }
  bind(...values) { return new D1PreparedStatement(this.host, this.sql, values); }
  async all() {
    const r = await this.host.dbExec(this.sql, this.params);
    return new D1Result(r.rows || [], { changes: r.changes || 0, last_row_id: r.lastInsertRowid || 0 });
  }
  async first(column) {
    const { results } = await this.all();
    const row = results[0];
    if (!row) return null;
    return column === undefined ? row : row[column];
  }
  async run() {
    const r = await this.host.dbExec(this.sql, this.params);
    return new D1Result(r.rows || [], { changes: r.changes || 0, last_row_id: r.lastInsertRowid || 0 });
  }
  async raw() {
    const { results } = await this.all();
    return results.map((row) => Object.values(row));
  }
}

class D1Database {
  constructor(host) { this.host = host; }
  prepare(sql) { return new D1PreparedStatement(this.host, String(sql), []); }
  /** 多语句脚本(建表等)。 */
  async exec(sql) {
    const r = await this.host.dbExec(String(sql), []);
    return { count: 1, duration: 0, ...r };
  }
  /** 批量:一次往返,一个事务里跑完。 */
  async batch(statements) {
    const list = (statements || []).map((s) => ({ sql: s.sql, params: s.params || [] }));
    const out = await this.host.dbBatch(list);
    return (out.results || []).map((r) => new D1Result(r.rows || [], { changes: r.changes || 0, last_row_id: r.lastInsertRowid || 0 }));
  }
}

const MIME = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8", json: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", ico: "image/x-icon", woff2: "font/woff2",
  txt: "text/plain; charset=utf-8", md: "text/plain; charset=utf-8",
};

const bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

class AssetsBinding {
  constructor(host) { this.host = host; }
  async fetch(input) {
    const url = new URL(typeof input === "string" ? input : input.url);
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    let got = await this.host.asset(p);
    let ext = (p.split(".").pop() || "").toLowerCase();
    if (!got && !/\\.[a-z0-9]+$/i.test(p)) {
      got = await this.host.asset("/index.html");  // SPA 兜底
      ext = "html";
    }
    if (!got) return new Response("not found", { status: 404 });
    return new Response(bytesOf(got.b64), {
      headers: { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache" },
    });
  }
}

export const makeEnv = (raw) => ({
  ...raw,
  DB: new D1Database(raw.__WB_HOST),
  ASSETS: new AssetsBinding(raw.__WB_HOST),
  HOST: raw.__WB_HOST,
});
`;

// 入口垫片:包装 env 后转交给应用自己的 default export。
const ENTRY_MODULE = `
import app from "app-server.js";
import { makeEnv } from "wb-runtime.js";

export default {
  async fetch(req, env, ctx) {
    if (typeof app?.fetch !== "function") {
      return new Response("应用的 server.js 必须 export default { async fetch(req, env, ctx) {…} }", {
        status: 500, headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return app.fetch(req, makeEnv(env), ctx);
  },
};
`;

/** 应用唯一的对外通道:能力在此把关,动作全部回 Node 执行。 */
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
  /** env.DB 的执行端(能力:db)。 */
  async dbExec(sql, params) {
    this.#need("db");
    return this.#node("/api/app/db", { sql: String(sql || ""), params: Array.isArray(params) ? params : [] });
  }
  async dbBatch(statements) {
    this.#need("db");
    return this.#node("/api/app/db-batch", { statements: statements || [] });
  }
  /** env.ASSETS 的执行端:读 apps/<id>/public/ 下的文件(base64 回传,二进制安全)。免声明。 */
  async asset(path) {
    const data = await this.#node("/api/app/asset", { path: String(path || "") }).catch(() => null);
    return data && data.b64 !== undefined ? { b64: data.b64 } : null;
  }
  /** 服务端日志:回流 Node 控制台(AI 调试应用后端要看得到)。免声明。 */
  async log(...message) {
    await this.#node("/api/app/server-log", {
      message: message.map((m) => { try { return typeof m === "string" ? m : JSON.stringify(m); } catch { return String(m); } }).join(" "),
    }).catch(() => {});
  }
  /** 调 AI(能力:ai):无状态补全,summary 必填,落活动流水。 */
  async ai(req) {
    this.#need("ai");
    return this.#node("/api/app/ai", {
      summary: String(req?.summary || ""),
      system: String(req?.system || ""),
      prompt: String(req?.prompt || ""),
    });
  }
  /** 派活给智能体(能力:agent):hidden 智能体执行,活动可见。 */
  async agent(req) {
    this.#need("agent");
    return this.#node("/api/app/agent", {
      summary: String(req?.summary || ""),
      message: String(req?.message || ""),
    });
  }
}

const loadApp = async (env, ctx, appId) => {
  const res = await env.NODE.fetch(`http://node/api/apps/server-code?id=${encodeURIComponent(appId)}`);
  if (!res.ok) throw new Error(`取应用代码失败:${appId}(${res.status})`);
  const { code, capabilities, version } = await res.json();
  return env.LOADER.get(`${appId}@${version}`, () => ({
    compatibilityDate: "2026-02-01",
    mainModule: "entry.js",
    modules: {
      "entry.js": ENTRY_MODULE,
      "wb-runtime.js": RUNTIME_MODULE,
      "app-server.js": String(code),
    },
    env: { __WB_HOST: ctx.exports.HostGate({ props: { appId, caps: capabilities || [] } }) },
    globalOutbound: null, // 物理断网:应用只能经 DB / ASSETS / HOST 三个 binding 碰外界
  }));
};

/** token → appId:Node 每次启动为每个应用生成,应用甲拿不到应用乙的 token。 */
const resolveApp = async (env, token) => {
  const res = await env.NODE.fetch(`http://node/api/apps/resolve-token?token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  const { appId } = await res.json();
  return appId || null;
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");

    // /app/<token>/<应用内路径> —— 应用自己的网站根
    const m = /^\/app\/([a-f0-9]{16,64})(\/.*)?$/.exec(url.pathname);
    if (!m) return new Response("not found", { status: 404 });

    const appId = await resolveApp(env, m[1]);
    if (!appId) return new Response("forbidden", { status: 403 });

    // 宿主 UI 能力的 SDK:应用 <script src="/_wb/sdk.js"> 引入
    if (m[2] === "/_wb/sdk.js") {
      const sdk = await env.NODE.fetch("http://node/api/apps/sdk.js");
      return new Response(await sdk.text(), {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
      });
    }

    try {
      const worker = await loadApp(env, ctx, appId);
      const inner = new URL(req.url);
      inner.pathname = m[2] || "/";
      return await worker.getEntrypoint().fetch(new Request(inner, req));
    } catch (e) {
      return new Response(`应用启动失败:${e?.message || e}`, {
        status: 500, headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  },
};
