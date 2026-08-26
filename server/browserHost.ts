// @ts-nocheck
// 浏览器宿主:browser 工具的服务端一半。
// 真正的浏览器是 UI 里的 <webview>(Electron 渲染进程)—— 它通过现有 ws 注册自己的
// 网页标签(wcId + 地址 + 标题),browser 指令从这里广播出去、拥有该标签的窗口执行后应答。
// server 始终不直接摸 webContents:主进程/渲染进程的事留在壳里,这里只做登记与转发。
import { randomUUID } from "crypto";
import { emit } from "./bus.js";

/** 已注册的网页标签:key = wcId(webContents id,模型用它指名标签)。 */
const tabs = new Map();
/** 声明过自己是宿主(Electron 壳里的 UI)的 ws client 集合。 */
const hosts = new Set();
/** 在途的 browser 请求:id → {resolve, timer}。应答走 resolveBrowserResult。 */
const pending = new Map();
/** 在途的「打开标签」:token → {resolve, timer}。新 webview 注册时若带 token 即兑现。 */
const pendingOpens = new Map();

const OPEN_TIMEOUT_MS = 20_000;

export const registerHost = (client) => { hosts.add(client); };

export const unregisterClient = (client) => {
  hosts.delete(client);
  // 该连接注册过的标签一并出册(窗口关了/刷新了,标签已经不在)
  for (const [wcId, tab] of tabs) {
    if (tab.client === client) tabs.delete(wcId);
  }
};

export const hasHost = () => hosts.size > 0;

export const registerTab = (client, payload) => {
  const wcId = Number(payload.wcId);
  if (!wcId) return;
  tabs.set(wcId, {
    wcId,
    tabId: String(payload.tabId || ""),
    url: String(payload.url || ""),
    title: String(payload.title || ""),
    client,
  });
  hosts.add(client); // 能注册标签的必然是宿主
  const token = String(payload.token || "");
  if (token && pendingOpens.has(token)) {
    const waiter = pendingOpens.get(token);
    pendingOpens.delete(token);
    clearTimeout(waiter.timer);
    const tab = tabs.get(wcId);
    waiter.resolve({ id: tab.wcId, url: tab.url, title: tab.title }); // 对外形状与 listTabs 一致
  }
};

export const updateTab = (payload) => {
  const tab = tabs.get(Number(payload.wcId));
  if (!tab) return;
  if (payload.url) tab.url = String(payload.url);
  if (payload.title) tab.title = String(payload.title);
};

export const unregisterTab = (payload) => { tabs.delete(Number(payload.wcId)); };

export const listTabs = () =>
  Array.from(tabs.values()).map(({ wcId, url, title }) => ({ id: wcId, url, title }));

/** UI 应答 browser_response → 兑现在途请求。 */
export const resolveBrowserResult = (payload) => {
  const waiter = pending.get(String(payload.id || ""));
  if (!waiter) return;
  pending.delete(String(payload.id));
  clearTimeout(waiter.timer);
  if (payload.ok) waiter.resolve(payload.result);
  else waiter.reject(new Error(String(payload.error || "浏览器执行失败")));
};

/** 向宿主发一条 browser 指令并等应答。tab 必须已注册;超时按操作类型给。 */
export const browserRequest = (wcId, op, params = {}, timeoutMs = 15_000) => {
  const tab = tabs.get(Number(wcId));
  if (!tab) throw new Error(`标签不存在:${wcId}(用 action=list 查看当前网页标签)`);
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`browser ${op} 超时(${Math.round(timeoutMs / 1000)}s)`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    // 广播:拥有该 wcId 的窗口执行并应答,其余窗口忽略
    emit({ type: "browser_request", id, wcId: Number(wcId), op, params });
  });
};

/** 让界面开一个新网页标签,等它的 webview 注册进来,返回标签信息。 */
export const openTab = (url) =>
  new Promise((resolve, reject) => {
    if (!hasHost()) { reject(new Error("没有可用的浏览器宿主(需要在 Workbench 桌面壳里运行)")); return; }
    const token = randomUUID();
    const timer = setTimeout(() => {
      pendingOpens.delete(token);
      reject(new Error("打开网页标签超时(20s)"));
    }, OPEN_TIMEOUT_MS);
    pendingOpens.set(token, { resolve, timer });
    emit({ type: "web_tab_open", url, token });
  });
