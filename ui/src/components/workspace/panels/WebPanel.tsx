// 网页标签:Electron 壳里是真 <webview>(真会话、真登录态);
// 纯浏览器里没有这个标签,给一块诚实的兜底(日常站点普遍禁 iframe,不装能行)。
// 面板由 WorkspaceGroup 常驻挂载、CSS 控显隐 —— 卸载 = 断网重载,登录态全丢。
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, ExternalLink, Globe, KeyRound, MoreHorizontal, RotateCw, Star, X } from "lucide-react";
import type { WebTab } from "../types";
import { api } from "../../../api";
import { IN_ELECTRON, RE_REGISTER_EVENT, registerWebview, unregisterWebview } from "../../../lib/webviewHost";
import { displayUrl, hostKey, normalizeUrl } from "../../../lib/urls";
import {
  chromeImportAvailable,
  dismissImportPrompt,
  importChromeCookies,
  shouldPromptImport,
} from "../../../lib/chromeImport";

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

/** 网页标签的 session 分区。**必须与 desktop/main.js 的 WEB_PARTITION 一致** ——
 *  导入的登录态、「退出所有网站」都落在这个分区上,对不上就是各清各的。 */
const WEB_PARTITION = "persist:web";

export function WebPanel({ tab, socket, onUpdate }: {
  tab: WebTab;
  socket: Socket;
  /** 必须是恒定引用(useCallback):注册 effect 依赖它,抖了 webview 会掉册。 */
  onUpdate: (id: string, patch: Partial<Pick<WebTab, "title" | "url" | "favicon">>) => void;
}) {
  const viewRef = useRef<HTMLElement | null>(null);
  const wcIdRef = useRef<number | null>(null);
  // 平时展示人话形(藏 https:// 和尾斜杠),点进编辑时换完整 URL
  const [address, setAddress] = useState(displayUrl(tab.url));
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [starred, setStarred] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zoom, setZoomState] = useState(0);
  const [finding, setFinding] = useState(false);
  const [needle, setNeedle] = useState("");
  const findRef = useRef<HTMLInputElement | null>(null);
  // 登录态引导:只在「能导 + 没导过/没关过」时出现,导完或关掉就不再来
  const [promptImport, setPromptImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState("");

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
      setEditing((editing) => { if (!editing) setAddress(displayUrl(e.url)); return editing; });
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
    const url = address.trim() ? normalizeUrl(address) : "";
    if (!url) return;
    setEditing(false);
    (viewRef.current as any)?.loadURL?.(url);
  };

  // 星标状态跟着地址走,也跟着「网站」面板的增删走(在面板里删掉,这里要熄灭)
  useEffect(() => {
    const key = hostKey(tab.url);
    const sync = () => {
      void api.listSites()
        .then((sites) => setStarred(!!key && sites.some((site) => hostKey(site.url) === key)))
        .catch(() => {});
    };
    sync();
    return socket.on("sites_changed", sync);
  }, [socket, tab.url]);

  // 引导条要不要出现:问一次壳(macOS + 装了 Chrome),再看本地状态
  useEffect(() => {
    if (!shouldPromptImport()) return;
    void chromeImportAvailable().then((ok) => setPromptImport(ok));
  }, []);

  const runImport = useCallback(() => {
    setImporting(true);
    setImportNote("");
    void importChromeCookies()
      .then((r) => {
        setImportNote(`已从 ${r.profile} 导入 ${r.imported} 条登录信息${r.failed ? `,跳过 ${r.failed} 条` : ""}。刷新页面后生效。`);
        setPromptImport(false);
      })
      .catch((e) => setImportNote(e?.message || "导入失败"))
      .finally(() => setImporting(false));
  }, []);

  // ⌘F 打开页内查找。挂在面板上而不是全局:多个网页标签常驻挂载,
  // 全局监听会让每个标签都抢一次快捷键 —— 只有可见的那个才响应。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        const host = viewRef.current?.parentElement;
        if (!host || host.offsetParent === null) return; // 这个标签当前不可见
        e.preventDefault();
        setFinding(true);
        setTimeout(() => findRef.current?.select(), 0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setZoom = (level: number) => {
    const next = Math.max(-3, Math.min(5, level));
    setZoomState(next);
    (viewRef.current as any)?.setZoomLevel?.(next);
  };

  const runFind = (text: string, forward = true) => {
    const view = viewRef.current as any;
    if (!view) return;
    if (!text) { view.stopFindInPage?.("clearSelection"); return; }
    view.findInPage?.(text, { forward, findNext: true });
  };

  const closeFind = () => {
    setFinding(false);
    setNeedle("");
    (viewRef.current as any)?.stopFindInPage?.("clearSelection");
  };

  const openExternal = () => window.open(tab.url, "_blank");

  // 收藏进「网站」面板。服务端按站点键去重,所以重复点不会插重复行;
  // 已收藏时星标点亮 —— 否则点下去毫无反馈,用户不知道成没成。
  const addToSites = () => {
    void api.createSite({ url: tab.url, title: tab.title }).then(() => setStarred(true)).catch(() => {});
  };

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
  const menuItem = "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-text hover:bg-bg-hover transition-colors";
  const menuDiv = "my-1 border-t border-border";
  const kbd = "text-[11px] text-text-faint font-mono";
  const zoomBtn = "w-5 h-5 rounded flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover transition-colors";

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      {/* 工具栏:后退 / 前进 / 刷新 / 地址 / 收藏 / 系统浏览器 */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-bg-raised/60">
        <button className={navBtn} title="后退" onClick={() => (viewRef.current as any)?.goBack?.()}><ArrowLeft size={14} /></button>
        <button className={navBtn} title="前进" onClick={() => (viewRef.current as any)?.goForward?.()}><ArrowRight size={14} /></button>
        <button className={navBtn} title="刷新" onClick={() => (viewRef.current as any)?.reload?.()}>
          <RotateCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => {
            // 编辑态换完整 URL(要精确就给全文),值换完再全选
            setEditing(true);
            setAddress(tab.url);
            const el = e.target as HTMLInputElement;
            requestAnimationFrame(() => el.select());
          }}
          onBlur={() => { setEditing(false); setAddress(displayUrl(tab.url)); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { go(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setEditing(false); setAddress(displayUrl(tab.url)); (e.target as HTMLInputElement).blur(); }
          }}
          spellCheck={false}
          className="flex-1 min-w-0 h-7 px-2.5 rounded-md border border-border bg-surface text-[12.5px] font-mono text-text-dim focus:text-text focus:border-accent outline-none transition-colors"
        />
        <button
          className={starred ? `${navBtn} text-accent hover:text-accent` : navBtn}
          title={starred ? "已在「网站」面板" : "添加到「网站」面板"}
          onClick={addToSites}
        >
          <Star size={13} fill={starred ? "currentColor" : "none"} />
        </button>
        {/* 菜单挂在**触发它的这一行**里(relative 容器 + top-full):
            挂到外面就要拿行高硬算坐标,行高一改就错位 */}
        <div className="relative">
          <button
            className={menuOpen ? `${navBtn} text-text bg-bg-hover` : navBtn}
            title="更多"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((open) => !open); }}
          >
            <MoreHorizontal size={15} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute top-full right-0 mt-1 z-50 w-56 py-1 rounded-lg border border-border bg-bg-raised shadow-lg text-[13px]">
                {/* 登录态排第一 —— 它是这个浏览器能不能用起来的前提,不是杂项 */}
                <button className={menuItem} onClick={() => { setMenuOpen(false); runImport(); }}>
                  <span className="flex items-center gap-2"><KeyRound size={13} /> 导入 Chrome 登录状态</span>
                </button>
                <div className={menuDiv} />
                <button className={menuItem} onClick={() => { setMenuOpen(false); setFinding(true); setTimeout(() => findRef.current?.focus(), 0); }}>
                  页内查找<kbd className={kbd}>⌘F</kbd>
                </button>
                <div className="flex items-center justify-between px-3 py-1.5 text-text-dim">
                  <span>缩放</span>
                  <span className="flex items-center gap-1.5">
                    <button className={zoomBtn} onClick={() => setZoom(zoom - 0.5)}>−</button>
                    <b className="w-10 text-center text-[12px] tabular-nums text-text">{Math.round(1.2 ** zoom * 100)}%</b>
                    <button className={zoomBtn} onClick={() => setZoom(zoom + 0.5)}>+</button>
                  </span>
                </div>
                <div className={menuDiv} />
                <button className={menuItem} onClick={() => { setMenuOpen(false); void navigator.clipboard.writeText(tab.url).catch(() => {}); }}>
                  复制链接
                </button>
                <button className={menuItem} onClick={() => { setMenuOpen(false); openExternal(); }}>
                  在系统浏览器打开
                </button>
                <div className={menuDiv} />
                <button className={menuItem} onClick={() => { setMenuOpen(false); (viewRef.current as any)?.openDevTools?.(); }}>
                  开发者工具
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 登录态引导:痛点就在这块面板里 —— 打开的站没登录,提示就该长在这儿,
          而不是等用户自己翻到设置页去找 */}
      {promptImport && (
        <div className="shrink-0 flex items-start gap-2.5 px-3 py-2 border-b border-border bg-accent/[0.06]">
          <KeyRound size={14} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] text-text">导入 Chrome 登录状态</div>
            <div className="mt-0.5 text-[11.5px] text-text-faint leading-relaxed">
              导入范围为<b>全部站点</b>的登录信息,需通过系统钥匙串授权。
              导入后 AI 可在这些已登录的页面上执行操作。
            </div>
          </div>
          <button
            onClick={runImport}
            disabled={importing}
            className="shrink-0 px-2.5 py-1 rounded-md bg-accent text-white text-[12px] hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {importing ? "导入中…" : "导入"}
          </button>
          <button
            onClick={() => { dismissImportPrompt(); setPromptImport(false); }}
            className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
            title="不再提示"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {importNote && !promptImport && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-raised/60 text-[12px] text-text-dim">
          <span className="min-w-0 flex-1 truncate">{importNote}</span>
          <button className={navBtn} title="关闭" onClick={() => setImportNote("")}><X size={12} /></button>
        </div>
      )}

      {finding && (
        <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-bg-raised/60">
          <input
            ref={findRef}
            value={needle}
            onChange={(e) => { setNeedle(e.target.value); runFind(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") runFind(needle, !e.shiftKey);
              if (e.key === "Escape") closeFind();
            }}
            placeholder="页内查找"
            className="flex-1 min-w-0 h-7 px-2.5 rounded-md border border-border bg-surface text-[12.5px] text-text outline-none focus:border-accent transition-colors"
          />
          <button className={navBtn} title="上一个" onClick={() => runFind(needle, false)}><ChevronUp size={14} /></button>
          <button className={navBtn} title="下一个" onClick={() => runFind(needle, true)}><ChevronDown size={14} /></button>
          <button className={navBtn} title="关闭" onClick={closeFind}><X size={14} /></button>
        </div>
      )}

      <webview
        ref={(el) => { viewRef.current = el; }}
        src={tab.url}
        partition={WEB_PARTITION}
        className="flex-1 min-h-0"
        style={{ display: "flex" }}
      />
    </div>
  );
}
