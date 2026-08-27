// 扩展面板装载器:一块 iframe 沙箱 + 一座 postMessage 桥。
//
// 双轨制(见 PANEL.md):内置面板(会话/文件)是原生 React;运行时装进来的面板
// (预置示例「网站」、可安装的「任务」、将来 AI 生成的)一律进 iframe ——
//   sandbox="allow-scripts"(不给 same-origin):面板代码摸不到宿主 DOM / localStorage / ws;
//   面板对外只有一种语言:workbench-sdk 包装的 RPC(tabs.open / storage / dialog…),
//   桥在宿主侧带着面板身份转发 —— 面板永远不直连本地 http/ws 端口。
import { useEffect, useRef } from "react";
import { api } from "../../api";
import { dialog } from "../ui";
import { THEME_EVENT } from "../../lib/theme";

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

export function PanelFrame({
  panelId,
  onOpenUrl,
}: {
  panelId: string;
  onOpenUrl: (url: string, title?: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onOpenUrlRef = useRef(onOpenUrl);
  onOpenUrlRef.current = onOpenUrl;

  useEffect(() => {
    const post = (msg: Record<string, unknown>) =>
      frameRef.current?.contentWindow?.postMessage({ wb: 1, ...msg }, "*");
    const sendTheme = () => post({ type: "theme", ...themePayload() });

    const onMessage = async (e: MessageEvent) => {
      if (e.source !== frameRef.current?.contentWindow) return; // 只认自己这块 iframe
      const d = e.data;
      if (!d || d.wb !== 1) return;
      if (d.type === "hello") { post({ type: "init", ctx: { panelId } }); sendTheme(); return; }
      if (d.type !== "rpc") return;
      const reply = (ok: boolean, value: unknown = null, error?: string) =>
        post({ type: "result", id: d.id, ok, value, error });
      const p = d.params || {};
      try {
        switch (d.method) {
          case "tabs.open": {
            if (p.kind === "web" && p.url) onOpenUrlRef.current(String(p.url), p.title ? String(p.title) : undefined);
            reply(true);
            break;
          }
          case "storage.get":
            reply(true, await api.panelStorageGet(panelId));
            break;
          case "storage.set":
            await api.panelStorageSet(panelId, p.value);
            reply(true);
            break;
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
          default:
            reply(false, null, `unknown method: ${String(d.method)}`);
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
    };
  }, [panelId]);

  return (
    <iframe
      ref={frameRef}
      src={`/panels/${panelId}/index.html`}
      sandbox="allow-scripts"
      title={`panel:${panelId}`}
      className="flex-1 w-full border-0 bg-transparent"
    />
  );
}
