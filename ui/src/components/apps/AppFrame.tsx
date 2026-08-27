// 应用装载器:一块 iframe 沙箱 + 一条 Cap'n Web RPC 会话(应用契约的宿主端,见 APP.md)。
//
// - sandbox="allow-scripts"(不给 same-origin):应用是不透明源,摸不到宿主 DOM / localStorage,
//   Origin 门卫又拒绝字面 "null" 源的写请求 —— 这条会话是应用与世界的唯一通道;
// - 握手:应用(SDK)建 MessageChannel,把 port 递上来;宿主校验 source + origin === "null" 后
//   在 port 上起 Cap'n Web 会话 —— 宿主暴露 HostApi(能力网关),应用暴露 ClientMain(回调面);
// - 主题/路由/实例事件都是对 ClientMain 桩的真调用,不再手刻报文;
//   函数可按引用传递 —— 这也是将来 workerd 后端应用(gadget 桩)的同一条铁轨。
import { useEffect, useRef } from "react";
import { RpcTarget, newMessagePortRpcSession } from "capnweb";
import { api } from "../../api";
import { dialog } from "../ui";
import { showToast } from "../ui/Toast";
import { THEME_EVENT } from "../../lib/theme";
import { appEntryUrl, type AppDef } from "../sidebar/registry";
import { broadcastAppEvent, subscribeApp, type AppBusMessage } from "./bus";
import { getGadgetStub } from "./gadget";

const THEME_TOKENS = [
  "bg", "bg-raised", "bg-panel", "bg-inset", "bg-hover",
  "border", "border-strong",
  "text", "text-dim", "text-faint",
  "accent", "accent-soft",
  "success", "warning", "danger", "surface",
];

const themePayload = () => {
  const cs = getComputedStyle(document.documentElement);
  const vars: Record<string, string> = {};
  for (const name of THEME_TOKENS) {
    vars[`--color-${name}`] = cs.getPropertyValue(`--color-${name}`).trim();
  }
  return { vars, dark: document.documentElement.dataset.theme === "dark" };
};

const fsGranted = (appId: string) => localStorage.getItem(`workbench.apps.fsGrant.${appId}`) === "1";
const grantFs = (appId: string) => localStorage.setItem(`workbench.apps.fsGrant.${appId}`, "1");

type HostDeps = {
  app: AppDef;
  onOpenUrl: (url: string, title?: string) => void;
  onOpenApp?: (app: AppDef, route?: string) => void;
  /** 本实例的总线身份:busEmit 广播时把自己排除(不回声)。 */
  except: (msg: AppBusMessage) => void;
};

/** 宿主 API:应用拿到它的桩。每个方法自带能力网关 —— manifest 没声明的能力,调了就抛。 */
class HostApi extends RpcTarget {
  #deps: HostDeps;

  constructor(deps: HostDeps) {
    super();
    this.#deps = deps;
  }

  #need(cap: string) {
    if (!this.#deps.app.capabilities.includes(cap)) {
      throw new Error(`未声明能力:${cap}(在 app.json 的 capabilities 里加上它)`);
    }
  }

  async storageGet() {
    this.#need("storage");
    return api.panelStorageGet(this.#deps.app.id);
  }

  async storageSet(value: unknown) {
    this.#need("storage");
    await api.panelStorageSet(this.#deps.app.id, value);
  }

  async dbExec(sql: unknown, params: unknown) {
    this.#need("db");
    return api.appDb(this.#deps.app.id, String(sql || ""), Array.isArray(params) ? params : []);
  }

  async tabsOpen(req: { url?: unknown; title?: unknown }) {
    this.#need("tabs");
    if (req?.url) this.#deps.onOpenUrl(String(req.url), req.title ? String(req.title) : undefined);
  }

  async tabsOpenApp(req: { route?: unknown }) {
    this.#need("tabs");
    this.#deps.onOpenApp?.(this.#deps.app, req?.route ? String(req.route) : "");
  }

  async aiComplete(req: { summary?: unknown; system?: unknown; prompt?: unknown }) {
    this.#need("ai");
    return api.appAi({
      appId: this.#deps.app.id,
      summary: String(req?.summary || ""),
      system: req?.system ? String(req.system) : undefined,
      prompt: String(req?.prompt || ""),
    });
  }

  async agentRun(req: { summary?: unknown; message?: unknown; workdir?: unknown }) {
    this.#need("agent");
    return api.appAgent({
      appId: this.#deps.app.id,
      summary: String(req?.summary || ""),
      message: String(req?.message || ""),
      workdir: req?.workdir ? String(req.workdir) : undefined,
    });
  }

  async #ensureFsGrant() {
    const { app } = this.#deps;
    if (fsGranted(app.id)) return;
    const ok = await dialog.confirm(
      `应用「${app.name}」请求读写工作区文件。\n允许后它可以读取和修改工作区内的内容。`,
      { confirmText: "允许" },
    );
    if (!ok) throw new Error("用户拒绝了工作区文件访问");
    grantFs(app.id);
  }

  async fsRead(req: { path?: unknown }) {
    this.#need("fs:workspace");
    await this.#ensureFsGrant();
    return api.appFs({ appId: this.#deps.app.id, op: "read", path: String(req?.path || "") });
  }

  async fsWrite(req: { path?: unknown; content?: unknown }) {
    this.#need("fs:workspace");
    await this.#ensureFsGrant();
    return api.appFs({
      appId: this.#deps.app.id,
      op: "write",
      path: String(req?.path || ""),
      content: req?.content !== undefined ? String(req.content) : "",
    });
  }

  async fsList(req: { path?: unknown }) {
    this.#need("fs:workspace");
    await this.#ensureFsGrant();
    return api.appFs({ appId: this.#deps.app.id, op: "list", path: String(req?.path || "") });
  }

  async systemOpenExternal(url: unknown) {
    this.#need("system");
    if (/^https?:\/\//i.test(String(url || ""))) window.open(String(url), "_blank");
  }

  async clipboardWrite(text: unknown) {
    this.#need("system");
    await navigator.clipboard.writeText(String(text || "")).catch(() => {});
  }

  async dialogConfirm(message: unknown, opts: { danger?: unknown; confirmText?: unknown }) {
    return dialog.confirm(String(message || ""), {
      danger: !!opts?.danger,
      confirmText: opts?.confirmText ? String(opts.confirmText) : undefined,
    });
  }

  async uiToast(message: unknown) {
    showToast(String(message || ""));
  }

  async busEmit(event: unknown, payload: unknown) {
    broadcastAppEvent(this.#deps.app.id, String(event || ""), payload, this.#deps.except);
  }

  /** 应用后端桩(manifest 声明了 server 才有):Cap'n Web 跨会话代理,应用拿到即直连自己的 Gadget。 */
  async gadget() {
    if (!this.#deps.app.server) throw new Error("该应用没有声明后端(app.json 的 server 字段)");
    return getGadgetStub(this.#deps.app.id);
  }
}

export function AppFrame({
  app,
  mount,
  route,
  onOpenUrl,
  onOpenApp,
}: {
  app: AppDef;
  mount: "panel" | "tab";
  /** 标签页实例的初始 route(tabs.openApp 带来)。 */
  route?: string;
  onOpenUrl: (url: string, title?: string) => void;
  onOpenApp?: (app: AppDef, route?: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onOpenUrlRef = useRef(onOpenUrl);
  const onOpenAppRef = useRef(onOpenApp);
  onOpenUrlRef.current = onOpenUrl;
  onOpenAppRef.current = onOpenApp;
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    // client = 应用侧 ClientMain 的桩(init/theme/route/appEvent 都是对它的真调用)
    let client: any = null;
    const dropSession = () => {
      try { client?.[Symbol.dispose]?.(); } catch { /* 已断开 */ }
      client = null;
    };

    // 总线:别的实例发来的事件 / route 推送 → 调进应用
    const busListener = (msg: AppBusMessage) => {
      if (!client) return;
      if (msg.type === "event") void Promise.resolve(client.appEvent(msg.event, msg.payload)).catch(() => {});
      else if (msg.type === "route") {
        routeRef.current = msg.route;
        void Promise.resolve(client.route(msg.route)).catch(() => {});
      }
    };
    const unsubscribe = subscribeApp(app.id, busListener);

    const sendTheme = () => { if (client) void Promise.resolve(client.theme(themePayload())).catch(() => {}); };
    window.addEventListener(THEME_EVENT, sendTheme);

    const onMessage = (e: MessageEvent) => {
      // 只认自己这块沙箱 iframe 的握手(不透明源的 origin 是字面 "null")
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || e.source !== frameWindow || e.origin !== "null") return;
      if (e.data !== "wb-handshake" || !e.ports || !e.ports[0]) return;
      dropSession(); // iframe 重载会再次握手:旧会话作废
      const hostApi = new HostApi({
        app,
        onOpenUrl: (url, title) => onOpenUrlRef.current(url, title),
        onOpenApp: (a, r) => onOpenAppRef.current?.(a, r),
        except: busListener,
      });
      client = newMessagePortRpcSession(e.ports[0], hostApi);
      void Promise.resolve(
        client.init({ appId: app.id, mount, route: routeRef.current || "" }, themePayload()),
      ).catch(() => {});
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener(THEME_EVENT, sendTheme);
      unsubscribe();
      dropSession();
    };
  }, [app, mount]);

  const src = appEntryUrl(app, mount);
  if (!src) return null;
  return (
    <iframe
      ref={frameRef}
      src={src}
      sandbox="allow-scripts"
      title={`app:${app.id}:${mount}`}
      className="flex-1 w-full border-0 bg-transparent"
    />
  );
}
