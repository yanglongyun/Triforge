// 应用装载器:一块 iframe 沙箱 + 一座 postMessage 桥(应用契约的宿主端,见 APP.md)。
//
// - sandbox="allow-scripts"(不给 same-origin):应用代码摸不到宿主 DOM / localStorage / 本地端口
//   (Origin 门卫已拒绝字面 "null" 源的写请求,应用只有这座桥一条路);
// - 能力网关:manifest 未声明的能力,桥直接拒绝;
// - 同应用多实例(面板 + 标签页)经 bus 转发事件与 route,数据真身在宿主侧。
import { useEffect, useRef } from "react";
import { api } from "../../api";
import { dialog } from "../ui";
import { showToast } from "../ui/Toast";
import { THEME_EVENT } from "../../lib/theme";
import { appEntryUrl, type AppDef } from "../sidebar/registry";
import { broadcastAppEvent, pushAppRoute, subscribeApp, type AppBusMessage } from "./bus";

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

/** 方法 → 所需能力(null = 基础 SDK,人人可用)。 */
const CAP_OF: Record<string, string | null> = {
  "storage.get": "storage",
  "storage.set": "storage",
  "db.exec": "db",
  "tabs.open": "tabs",
  "tabs.openApp": "tabs",
  "ai.complete": "ai",
  "agent.run": "agent",
  "fs.read": "fs:workspace",
  "fs.write": "fs:workspace",
  "fs.list": "fs:workspace",
  "system.openExternal": "system",
  "clipboard.write": "system",
  "dialog.confirm": null,
  "ui.toast": null,
  "bus.emit": null,
};

const fsGranted = (appId: string) => localStorage.getItem(`workbench.apps.fsGrant.${appId}`) === "1";
const grantFs = (appId: string) => localStorage.setItem(`workbench.apps.fsGrant.${appId}`, "1");

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
    const post = (msg: Record<string, unknown>) =>
      frameRef.current?.contentWindow?.postMessage({ wb: 1, ...msg }, "*");
    const sendTheme = () => post({ type: "theme", ...themePayload() });

    // 总线:别的实例发来的事件 / route 推送 → 转进 iframe
    const busListener = (msg: AppBusMessage) => {
      if (msg.type === "event") post({ type: "appevent", event: msg.event, payload: msg.payload });
      else if (msg.type === "route") post({ type: "route", route: msg.route });
    };
    const unsubscribe = subscribeApp(app.id, busListener);

    const onMessage = async (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const d = e.data;
      if (!d || d.wb !== 1) return;
      if (d.type === "hello") {
        post({ type: "init", ctx: { appId: app.id, mount, route: routeRef.current || "" } });
        sendTheme();
        return;
      }
      if (d.type !== "rpc") return;
      const reply = (ok: boolean, value: unknown = null, error?: string) =>
        post({ type: "result", id: d.id, ok, value, error });
      const p = d.params || {};
      const method = String(d.method || "");

      // ── 能力网关 ──
      const cap = CAP_OF[method];
      if (cap === undefined) { reply(false, null, `unknown method: ${method}`); return; }
      if (cap && !app.capabilities.includes(cap)) {
        reply(false, null, `未声明能力:${cap}(在 app.json 的 capabilities 里加上它)`);
        return;
      }

      try {
        switch (method) {
          case "storage.get":
            reply(true, await api.panelStorageGet(app.id));
            break;
          case "storage.set":
            await api.panelStorageSet(app.id, p.value);
            reply(true);
            break;
          case "db.exec":
            reply(true, await api.appDb(app.id, String(p.sql || ""), Array.isArray(p.params) ? p.params : []));
            break;
          case "tabs.open":
            if (p.url) onOpenUrlRef.current(String(p.url), p.title ? String(p.title) : undefined);
            reply(true);
            break;
          case "tabs.openApp":
            onOpenAppRef.current?.(app, p.route ? String(p.route) : "");
            reply(true);
            break;
          case "ai.complete":
            reply(true, await api.appAi({
              appId: app.id,
              summary: String(p.summary || ""),
              system: p.system ? String(p.system) : undefined,
              prompt: String(p.prompt || ""),
            }));
            break;
          case "agent.run":
            reply(true, await api.appAgent({
              appId: app.id,
              summary: String(p.summary || ""),
              message: String(p.message || ""),
              workdir: p.workdir ? String(p.workdir) : undefined,
            }));
            break;
          case "fs.read":
          case "fs.write":
          case "fs.list": {
            if (!fsGranted(app.id)) {
              const ok = await dialog.confirm(
                `应用「${app.name}」请求读写工作区文件。\n允许后它可以读取和修改工作区内的内容。`,
                { confirmText: "允许" },
              );
              if (!ok) { reply(false, null, "用户拒绝了工作区文件访问"); return; }
              grantFs(app.id);
            }
            const op = method.slice(3) as "read" | "write" | "list";
            reply(true, await api.appFs({ appId: app.id, op, path: String(p.path || ""), content: p.content !== undefined ? String(p.content) : undefined }));
            break;
          }
          case "system.openExternal":
            if (/^https?:\/\//i.test(String(p.url || ""))) window.open(String(p.url), "_blank");
            reply(true);
            break;
          case "clipboard.write":
            await navigator.clipboard.writeText(String(p.text || "")).catch(() => {});
            reply(true);
            break;
          case "dialog.confirm":
            reply(true, await dialog.confirm(String(p.message || ""), {
              danger: !!p.danger,
              confirmText: p.confirmText ? String(p.confirmText) : undefined,
            }));
            break;
          case "ui.toast":
            showToast(String(p.message || ""));
            reply(true);
            break;
          case "bus.emit":
            broadcastAppEvent(app.id, String(p.event || ""), p.payload, busListener);
            reply(true);
            break;
        }
      } catch (err: any) {
        reply(false, null, String(err?.message || err));
      }
    };

    window.addEventListener("message", onMessage);
    window.addEventListener(THEME_EVENT, sendTheme);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener(THEME_EVENT, sendTheme);
      unsubscribe();
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

export { pushAppRoute };
