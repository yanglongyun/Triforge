// POC v2:+ Cap'n Web —— WS 升级请求直接把动态 worker 的 Gadget 桩作为会话主对象暴露
import { WorkerEntrypoint } from "cloudflare:workers";
import { newWorkersWebSocketRpcResponse, RpcTarget } from "capnweb";

// 原生 workers-RPC 桩 → capnweb 可暴露的门面(CF OS overseer 同款 Proxy 手法)
const facade = (stub) => new Proxy(stub, {
  get(target, prop) {
    const m = Reflect.get(target, prop, target);
    if (typeof m !== "function" || typeof prop === "symbol") return m;
    return (...args) => Reflect.apply(m, target, args);
  },
  getPrototypeOf() { return RpcTarget.prototype; },
});

export class HostGate extends WorkerEntrypoint {
  async dbEcho(sql) { return `gate(app=${this.ctx.props?.appId}) got: ${sql}`; }
}

const APP_CODE = `
import { WorkerEntrypoint } from "cloudflare:workers";
let counter = 0;
export class Gadget extends WorkerEntrypoint {
  async increment() { counter += 1; return counter; }
  async hello(name) { return "hi " + name + " via capnweb, host=" + await this.env.HOST.dbEcho("X"); }
  async subscribeTick(cb) {
    const dup = cb.dup ? cb.dup() : cb;
    let n = 0;
    const t = setInterval(() => { n++; try { dup.tick(n); } catch {} if (n >= 3) clearInterval(t); }, 100);
    return "subscribed";
  }
}`;

const loadGadget = (env, ctx) =>
  env.LOADER.get("app-counter2", () => ({
    compatibilityDate: "2026-02-01",
    mainModule: "server.js",
    modules: { "server.js": APP_CODE },
    env: { HOST: ctx.exports.HostGate({ props: { appId: "counter2" } }) },
    globalOutbound: null,
  }));

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/ping") return new Response("pong");
    if (url.pathname === "/gadget") {
      const g = loadGadget(env, ctx).getEntrypoint("Gadget");
      return newWorkersWebSocketRpcResponse(req, facade(g));
    }
    return new Response("nf", { status: 404 });
  },
};
