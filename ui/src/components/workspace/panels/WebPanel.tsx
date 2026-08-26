// 网页标签:Electron 壳里是真 <webview>(真会话、真登录态);
// 纯浏览器里没有这个标签,给一块诚实的兜底(日常站点普遍禁 iframe,不装能行)。
// 面板由 WorkspaceGroup 常驻挂载、CSS 控显隐 —— 卸载 = 断网重载,登录态全丢。
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Copy, ExternalLink, Globe, RotateCw } from "lucide-react";
import type { WebTab } from "../types";
import { IN_ELECTRON, RE_REGISTER_EVENT, registerWebview, unregisterWebview } from "../../../lib/webviewHost";

const normalizeInput = (raw: string) => {
  const value = raw.trim();
  if (!value) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
};

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

export function WebPanel({ tab, socket, onUpdate }: {
  tab: WebTab;
  socket: Socket;
  /** 必须是恒定引用(useCallback):注册 effect 依赖它,抖了 webview 会掉册。 */
  onUpdate: (id: string, patch: Partial<Pick<WebTab, "title" | "url" | "favicon">>) => void;
}) {
  const viewRef = useRef<HTMLElement | null>(null);
  const wcIdRef = useRef<number | null>(null);
  const [address, setAddress] = useState(tab.url);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);

  // webview 事件:标题/地址跟着页面走,标签栏与地址栏同步;
  // 同时把自己登记为 browser 可操作的标签(本地注册表 + server 注册表)
  useEffect(() => {
    const view = viewRef.current as any;
    if (!view) return;
    const registerToServer = () => {
      if (wcIdRef.current == null) return;
      socket.send({
        type: "web_tab_register",
        wcId: wcIdRef.current,
        tabId: tab.id,
        url: view.getURL?.() || tab.url,
        title: tab.title,
        token: tab.token,
      });
    };
    const onDomReady = () => {
      try {
        const wcId = view.getWebContentsId?.();
        if (typeof wcId === "number") {
          wcIdRef.current = wcId;
          registerWebview(wcId, view, tab.id);
          registerToServer();
        }
      } catch { /* webview 还没 attach 好,下一次 dom-ready 再来 */ }
    };
    const onTitle = (e: any) => {
      if (!e.title) return;
      onUpdate(tab.id, { title: e.title });
      if (wcIdRef.current != null) socket.send({ type: "web_tab_update", wcId: wcIdRef.current, title: e.title });
    };
    const onNavigate = (e: any) => {
      if (!e.url) return;
      setEditing((editing) => { if (!editing) setAddress(e.url); return editing; });
      onUpdate(tab.id, { url: e.url });
      if (wcIdRef.current != null) socket.send({ type: "web_tab_update", wcId: wcIdRef.current, url: e.url });
    };
    const onStart = () => setLoading(true);
    const onStop = () => setLoading(false);
    const onFavicon = (e: any) => {
      const icon = Array.isArray(e.favicons) ? String(e.favicons[0] || "") : "";
      if (icon) onUpdate(tab.id, { favicon: icon }); // 页面自己上报的真实图标,标签栏优先用
    };
    view.addEventListener("dom-ready", onDomReady);
    view.addEventListener("page-favicon-updated", onFavicon);
    view.addEventListener("page-title-updated", onTitle);
    view.addEventListener("did-navigate", onNavigate);
    view.addEventListener("did-navigate-in-page", onNavigate);
    view.addEventListener("did-start-loading", onStart);
    view.addEventListener("did-stop-loading", onStop);
    window.addEventListener(RE_REGISTER_EVENT, registerToServer); // server 重启后重新注册
    return () => {
      view.removeEventListener("dom-ready", onDomReady);
      view.removeEventListener("page-favicon-updated", onFavicon);
      view.removeEventListener("page-title-updated", onTitle);
      view.removeEventListener("did-navigate", onNavigate);
      view.removeEventListener("did-navigate-in-page", onNavigate);
      view.removeEventListener("did-start-loading", onStart);
      view.removeEventListener("did-stop-loading", onStop);
      window.removeEventListener(RE_REGISTER_EVENT, registerToServer);
      if (wcIdRef.current != null) {
        unregisterWebview(wcIdRef.current);
        socket.send({ type: "web_tab_unregister", wcId: wcIdRef.current });
        wcIdRef.current = null;
      }
    };
  }, [onUpdate, socket, tab.id]);

  const go = () => {
    const url = normalizeInput(address);
    if (!url) return;
    setEditing(false);
    (viewRef.current as any)?.loadURL?.(url);
  };

  const openExternal = () => window.open(tab.url, "_blank");

  if (!IN_ELECTRON) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 bg-bg px-6 text-center">
        <Globe size={28} className="text-text-faint" />
        <div className="text-[14px] text-text">网页标签需要在桌面壳(Electron)里打开</div>
        <div className="text-[12px] text-text-faint max-w-md truncate font-mono">{tab.url}</div>
        <button
          onClick={openExternal}
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
        >
          <ExternalLink size={13} /> 在浏览器打开
        </button>
      </div>
    );
  }

  const navBtn = "w-7 h-7 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover transition-colors disabled:opacity-30";

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      {/* 工具栏:后退 / 前进 / 刷新 / 地址 / 复制 / 系统浏览器 */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-bg-raised/60">
        <button className={navBtn} title="后退" onClick={() => (viewRef.current as any)?.goBack?.()}><ArrowLeft size={14} /></button>
        <button className={navBtn} title="前进" onClick={() => (viewRef.current as any)?.goForward?.()}><ArrowRight size={14} /></button>
        <button className={navBtn} title="刷新" onClick={() => (viewRef.current as any)?.reload?.()}>
          <RotateCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => { setEditing(true); e.target.select(); }}
          onBlur={() => { setEditing(false); setAddress(tab.url); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { go(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setEditing(false); setAddress(tab.url); (e.target as HTMLInputElement).blur(); }
          }}
          spellCheck={false}
          className="flex-1 min-w-0 h-7 px-2.5 rounded-md border border-border bg-white text-[12.5px] font-mono text-text-dim focus:text-text focus:border-accent outline-none transition-colors"
        />
        <button className={navBtn} title="复制链接" onClick={() => navigator.clipboard.writeText(tab.url).catch(() => {})}><Copy size={13} /></button>
        <button className={navBtn} title="在系统浏览器打开" onClick={openExternal}><ExternalLink size={13} /></button>
      </div>
      <webview
        ref={(el) => { viewRef.current = el; }}
        src={tab.url}
        className="flex-1 min-h-0"
        style={{ display: "flex" }}
      />
    </div>
  );
}
