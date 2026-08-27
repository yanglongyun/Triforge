// 应用装载器:一块 iframe 沙箱 + 一条 Cap'n Web 会话(应用契约的宿主端,见 APP.md)。
//
// 0.8 起 iframe 指向 **应用自己的网站**(workerd 上的 http://127.0.0.1:<port>/app/<token>/…),
// 前端与它自己的后端同源,直接 fetch("/api/…") —— 宿主不再插手应用的数据往来。
// 这条 postMessage 会话只剩「宿主 UI 能力」:提示、确认、开标签、剪贴板、工作区文件。
//
// 隔离照旧:sandbox="allow-scripts"(无 same-origin)→ 应用是不透明源,
// 摸不到宿主 DOM,也没有 cookie/localStorage(所有应用同端口,给了真 origin 就会互相串门)。
import { useEffect, useRef, useState } from "react";
import { RpcTarget, newMessagePortRpcSession } from "capnweb";
import { api } from "../../api";
import { dialog } from "../ui";
import { showToast } from "../ui/Toast";
import { THEME_EVENT } from "../../lib/theme";
import type { AppDef } from "../sidebar/registry";
import { broadcastAppEvent, subscribeApp, type AppBusMessage } from "./bus";

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
  except: (msg: AppBusMessage) => void;
};

/** 宿主 UI 能力:应用拿到它的桩。数据/AI 能力不在这 —— 那些是后端 env 的事。 */
class HostApi extends RpcTarget {
  #deps: HostDeps;
  constructor(deps: HostDeps) { super(); this.#deps = deps; }

  #need(cap: string) {
    if (!this.#deps.app.capabilities.includes(cap)) {
      throw new Error(`未声明能力:${cap}(在 app.json 的 capabilities 里加上它)`);
    }
  }

  async tabsOpen(req: { url?: unknown; title?: unknown }) {
    this.#need("tabs");
    if (req?.url) this.#deps.onOpenUrl(String(req.url), req.title ? String(req.title) : undefined);
  }

  async tabsOpenApp(req: { route?: unknown }) {
    this.#need("tabs");
    this.#deps.onOpenApp?.(this.#deps.app, req?.route ? String(req.route) : "");
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
      appId: this.#deps.app.id, op: "write", path: String(req?.path || ""),
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
  async uiToast(message: unknown) { showToast(String(message || "")); }
  async busEmit(event: unknown, payload: unknown) {
    broadcastAppEvent(this.#deps.app.id, String(event || ""), payload, this.#deps.except);
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
  route?: string;
  onOpenUrl: (url: string, title?: string) => void;
  onOpenApp?: (app: AppDef, route?: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onOpenUrlRef = useRef(onOpenUrl);
  const onOpenAppRef = useRef(onOpenApp);
  onOpenUrlRef.current = onOpenUrl;
  onOpenAppRef.current = onOpenApp;
  const routeRef = useRef(route);
  routeRef.current = route;

  // 应用网址由 server 给(带每应用一个的 token);route 变化时不重取 —— 路由推送走会话
  useEffect(() => {
    let cancelled = false;
    const entry = route || app.mounts[mount] || app.mounts.tab || app.mounts.panel || "/";
    api.appUrl(app.id, entry)
      .then((u) => { if (!cancelled) { setSrc(u); setError(null); } })
      .catch((e) => { if (!cancelled) setError(String(e?.message || e)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id, mount]);

  useEffect(() => {
    let client: any = null;
    const dropSession = () => {
      try { client?.[Symbol.dispose]?.(); } catch { /* 已断开 */ }
      client = null;
    };

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
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || e.source !== frameWindow || e.origin !== "null") return;
      if (e.data !== "wb-handshake" || !e.ports || !e.ports[0]) return;
      dropSession();
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

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center text-[13px] text-text-faint">
        {error}
      </div>
    );
  }
  if (!src) return <div className="flex-1" />;
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
