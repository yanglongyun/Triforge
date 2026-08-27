// runtime/overseer-src.mjs
import { WorkerEntrypoint } from "cloudflare:workers";
var RUNTIME_MODULE = `
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
  /** \u591A\u8BED\u53E5\u811A\u672C(\u5EFA\u8868\u7B49)\u3002 */
  async exec(sql) {
    const r = await this.host.dbExec(String(sql), []);
    return { count: 1, duration: 0, ...r };
  }
  /** \u6279\u91CF:\u4E00\u6B21\u5F80\u8FD4,\u4E00\u4E2A\u4E8B\u52A1\u91CC\u8DD1\u5B8C\u3002 */
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
      got = await this.host.asset("/index.html");  // SPA \u515C\u5E95
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
var ENTRY_MODULE = `
import app from "app-server.js";
import { makeEnv } from "wb-runtime.js";

export default {
  async fetch(req, env, ctx) {
    if (typeof app?.fetch !== "function") {
      return new Response("\u5E94\u7528\u7684 server.js \u5FC5\u987B export default { async fetch(req, env, ctx) {\u2026} }", {
        status: 500, headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return app.fetch(req, makeEnv(env), ctx);
  },
};
`;
var HostGate = class extends WorkerEntrypoint {
  #need(cap) {
    const caps = this.ctx.props?.caps || [];
    if (!caps.includes(cap)) throw new Error(`\u672A\u58F0\u660E\u80FD\u529B:${cap}(\u5728 app.json \u7684 capabilities \u91CC\u52A0\u4E0A\u5B83)`);
  }
  async #node(path, body) {
    const res = await this.env.NODE.fetch(`http://node${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: this.ctx.props?.appId, ...body })
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
    return data && data.b64 !== void 0 ? { b64: data.b64 } : null;
  }
  /** 服务端日志:回流 Node 控制台(AI 调试应用后端要看得到)。免声明。 */
  async log(...message) {
    await this.#node("/api/app/server-log", {
      message: message.map((m) => {
        try {
          return typeof m === "string" ? m : JSON.stringify(m);
        } catch {
          return String(m);
        }
      }).join(" ")
    }).catch(() => {
    });
  }
  /** 调 AI(能力:ai):无状态补全,summary 必填,落活动流水。 */
  async ai(req) {
    this.#need("ai");
    return this.#node("/api/app/ai", {
      summary: String(req?.summary || ""),
      system: String(req?.system || ""),
      prompt: String(req?.prompt || "")
    });
  }
  /** 派活给智能体(能力:agent):hidden 智能体执行,活动可见。 */
  async agent(req) {
    this.#need("agent");
    return this.#node("/api/app/agent", {
      summary: String(req?.summary || ""),
      message: String(req?.message || "")
    });
  }
};
var loadApp = async (env, ctx, appId) => {
  const res = await env.NODE.fetch(`http://node/api/apps/server-code?id=${encodeURIComponent(appId)}`);
  if (!res.ok) throw new Error(`\u53D6\u5E94\u7528\u4EE3\u7801\u5931\u8D25:${appId}(${res.status})`);
  const { code, capabilities, version } = await res.json();
  return env.LOADER.get(`${appId}@${version}`, () => ({
    compatibilityDate: "2026-02-01",
    mainModule: "entry.js",
    modules: {
      "entry.js": ENTRY_MODULE,
      "wb-runtime.js": RUNTIME_MODULE,
      "app-server.js": String(code)
    },
    env: { __WB_HOST: ctx.exports.HostGate({ props: { appId, caps: capabilities || [] } }) },
    globalOutbound: null
    // 物理断网:应用只能经 DB / ASSETS / HOST 三个 binding 碰外界
  }));
};
var resolveApp = async (env, token) => {
  const res = await env.NODE.fetch(`http://node/api/apps/resolve-token?token=${encodeURIComponent(token)}`);
  if (!res.ok) return null;
  const { appId } = await res.json();
  return appId || null;
};
var overseer_src_default = {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    const m = /^\/app\/([a-f0-9]{16,64})(\/.*)?$/.exec(url.pathname);
    if (!m) return new Response("not found", { status: 404 });
    const appId = await resolveApp(env, m[1]);
    if (!appId) return new Response("forbidden", { status: 403 });
    if (m[2] === "/_wb/sdk.js") {
      const sdk = await env.NODE.fetch("http://node/api/apps/sdk.js");
      return new Response(await sdk.text(), {
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" }
      });
    }
    try {
      const worker = await loadApp(env, ctx, appId);
      const inner = new URL(req.url);
      inner.pathname = m[2] || "/";
      return await worker.getEntrypoint().fetch(new Request(inner, req));
    } catch (e) {
      return new Response(`\u5E94\u7528\u542F\u52A8\u5931\u8D25:${e?.message || e}`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
  }
};
export {
  HostGate,
  overseer_src_default as default
};
