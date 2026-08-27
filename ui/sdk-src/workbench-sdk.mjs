// workbench-sdk 源码:esbuild 打包(npm run build:sdk)→ ui/public/apps/workbench-sdk.js。
//
// 0.8 起分工:**数据与计算在后端**(server.js 的 env.DB / env.ASSETS / env.HOST),
// 前端与自己的后端同源,直接 fetch("/api/…");这个 SDK 只剩「宿主 UI 能力」——
// 提示、确认、开标签页、剪贴板、工作区文件,以及同应用多实例间的事件与路由。
import { RpcTarget, newMessagePortRpcSession } from "capnweb";

const ctx = { appId: "", mount: "", route: "" };
const handlers = new Map(); // event -> Set<fn>;内置事件 "route"

const dispatch = (event, payload) => {
  const set = handlers.get(event);
  if (set) set.forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } });
};

const applyTheme = (msg) => {
  const vars = (msg && msg.vars) || {};
  for (const k in vars) document.documentElement.style.setProperty(k, vars[k]);
  if (msg && msg.dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
};

let resolveInit;
const initPromise = new Promise((r) => { resolveInit = r; });

// 宿主回调进来的门面:宿主持有它的桩,主题/路由/事件都从这里进
class ClientMain extends RpcTarget {
  init(context, theme) {
    Object.assign(ctx, context || {});
    applyTheme(theme);
    resolveInit({ ...ctx });
  }
  theme(payload) { applyTheme(payload); }
  route(route) { ctx.route = String(route || ""); dispatch("route", ctx.route); }
  appEvent(event, payload) { dispatch(String(event || ""), payload); }
}

// 握手:SDK 加载即建通道,port2 交给宿主(AppFrame),port1 上起会话
const { port1, port2 } = new MessageChannel();
window.parent.postMessage("wb-handshake", "*", [port2]);
const host = newMessagePortRpcSession(port1, new ClientMain());

const call = (method, ...args) => initPromise.then(() => host[method](...args));

window.workbench = {
  /** 等宿主握手,返回 { appId, mount, route }。 */
  ready: () => initPromise,
  context: () => ({ ...ctx }),
  /** 订阅:"route"(标签页收到新路由)或同应用其他实例 emit 的自定义事件。 */
  on: (event, fn) => {
    let set = handlers.get(event);
    if (!set) { set = new Set(); handlers.set(event, set); }
    set.add(fn);
    return () => set.delete(fn);
  },
  /** 广播给同应用的其他实例(自己不回声)。 */
  emit: (event, payload) => call("busEmit", event, payload),

  ui: {
    toast: (message) => call("uiToast", message),
  },
  dialog: {
    confirm: (message, opts) => call("dialogConfirm", message, opts || {}),
  },
  system: {
    openExternal: (url) => call("systemOpenExternal", url),
    copyText: (text) => call("clipboardWrite", text),
  },
  /** 工作区文件(能力:fs:workspace,首次使用弹用户授权)。 */
  fs: {
    read: (req) => call("fsRead", req || {}),
    write: (req) => call("fsWrite", req || {}),
    list: (req) => call("fsList", req || {}),
  },
  tabs: {
    open: (req) => call("tabsOpen", req || {}),
    openApp: (req) => call("tabsOpenApp", req || {}),
  },
};
