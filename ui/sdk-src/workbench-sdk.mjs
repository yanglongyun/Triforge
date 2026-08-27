// workbench-sdk 源码:esbuild 打包(npm run build:sdk)→ ui/public/apps/workbench-sdk.js。
//
// 0.6.1 起,应用与宿主之间跑 Cap'n Web RPC(MessageChannel 上的双向对象能力协议):
//   - 应用侧拿到宿主 HostApi 的桩(能力网关在宿主方法里);
//   - 宿主侧拿到应用 ClientMain 的桩,主题/路由/实例事件都是真调用,不再手刻报文;
//   - 函数可按引用传递 —— 订阅/回调从此是语言级能力(workerd 后端应用的同一条铁轨)。
// 应用面向的 workbench.* 表面保持 0.6.0 完全一致,存量应用零改动。
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

  storage: {
    get: () => call("storageGet"),
    set: (value) => call("storageSet", value),
  },
  /** 应用私有 SQLite(能力:db)。SELECT 返回 {rows},写返回 {changes, lastInsertRowid}。 */
  db: {
    exec: (sql, params) => call("dbExec", sql, params || []),
  },
  tabs: {
    open: (req) => call("tabsOpen", req || {}),
    openApp: (req) => call("tabsOpenApp", req || {}),
  },
  /** 调 AI(能力:ai):无状态单次补全,summary 必填,活动可见。返回 {text, tokens}。 */
  ai: {
    complete: (req) => call("aiComplete", req || {}),
  },
  /** 派活给智能体(能力:agent):活动可见,不进会话面板。返回 {agentId, text}。 */
  agent: {
    run: (req) => call("agentRun", req || {}),
  },
  /** 工作区文件(能力:fs:workspace,首次使用需用户授权)。 */
  fs: {
    read: (req) => call("fsRead", req || {}),
    write: (req) => call("fsWrite", req || {}),
    list: (req) => call("fsList", req || {}),
  },
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
};
