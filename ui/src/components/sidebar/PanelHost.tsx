// 面板宿主:侧边栏的「壳」。
//
// 职责边界(见 PANEL.md):宿主只管 —— 品牌行与汉堡、面板 tab 行(含空间不足退化为纯图标)、
// 面板的装卸与切换(+ = 添加面板)、宽度拖拽、移动端抽屉、底部 活动/设置。
// 每个面板的「身体」自治:会话/文件是原生组件,其余(预置示例「网站」与安装的扩展)进 iframe 沙箱。
import { useEffect, useRef, useState } from "react";
import type { GitRepositoryStatus, Node } from "../../api";
import { ContextMenu, type MenuItem } from "../ui";
import { Menu, Plus, Radio, Settings, Sparkles, X } from "lucide-react";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import { BUILTIN_PANELS, EXT_PANELS, type PanelDef } from "./registry";
import { AgentRail } from "./panels/AgentRail";
import { FilesPanel } from "./panels/FilesPanel";
import { PanelFrame } from "./panels/PanelFrame";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

export function PanelHost({
  selectedId,
  onSelect,
  socket,
  onOpenUrl,
  onToggleNav,
  onOpenSide,
  onOpenTerminal,
  onOpenGit,
  createParentId,
  refreshKey,
  settingsActive,
  onOpenSettings,
  activityActive,
  onOpenActivity,
  mobileOpen = false,
  desktopOpen = true,
  onCloseMobile,
  onChanged,
}: {
  selectedId: string;
  onSelect: (n: Node | null) => void;
  socket: Socket;
  onOpenUrl: (url: string, title?: string) => void;
  /** 侧栏头部汉堡:收起侧边栏(桌面端;展开入口在标签栏左端)。 */
  onToggleNav?: () => void;
  onOpenSide?: (n: Node) => void;
  onOpenTerminal?: (n: Node, opts?: { command?: string; titlePrefix?: string }) => void;
  onOpenGit?: (repo: GitRepositoryStatus) => void;
  createParentId?: string | null;
  refreshKey: number;
  settingsActive: boolean;
  onOpenSettings: () => void;
  activityActive?: boolean;
  onOpenActivity?: () => void;
  mobileOpen?: boolean;
  desktopOpen?: boolean;
  onCloseMobile?: () => void;
  onChanged?: () => void;
}) {
  // ── 面板装卸状态:已安装的扩展面板 + 当前面板,均跨启动记住 ──
  const [extPanels, setExtPanels] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("workbench.extPanels") || "[]");
      return Array.isArray(saved) ? saved.filter((id) => typeof id === "string" && EXT_PANELS[id]) : [];
    } catch { return []; }
  });
  const panels: PanelDef[] = [...BUILTIN_PANELS, ...extPanels.map((id) => EXT_PANELS[id]).filter(Boolean)];
  const [sideTab, setSideTab] = useState<string>(() => localStorage.getItem("workbench.sideTab") || "agents");
  const activePanelId = panels.some((p) => p.id === sideTab) ? sideTab : "agents";
  const switchTab = (tab: string) => {
    setSideTab(tab);
    localStorage.setItem("workbench.sideTab", tab);
  };
  const installPanel = (id: string) => {
    setExtPanels((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      localStorage.setItem("workbench.extPanels", JSON.stringify(next));
      return next;
    });
    switchTab(id);
  };
  const removePanel = (id: string) => {
    setExtPanels((prev) => {
      const next = prev.filter((x) => x !== id);
      localStorage.setItem("workbench.extPanels", JSON.stringify(next));
      return next;
    });
    if (sideTab === id) switchTab("agents");
  };

  // 文件面板的「在此新建对话」:切到会话面板并带上预设 workdir
  const [agentCreateReq, setAgentCreateReq] = useState<{ workdir?: string } | null>(null);
  const createAgentAt = (workdir?: string) => {
    switchTab("agents");
    setAgentCreateReq({ workdir });
  };

  // 聊天面板的工作目录芯片 → 切到文件面板(定位展开由 FilesPanel 自己做)
  useEffect(() => {
    const onReveal = () => switchTab("files");
    window.addEventListener("workbench:reveal-path", onReveal);
    return () => window.removeEventListener("workbench:reveal-path", onReveal);
  }, []);

  // ── 宽度拖拽 ──
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("workbench.sidebarWidth") || "");
    return Number.isFinite(saved) && saved >= 220 && saved <= 420 ? saved : 260;
  });
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    let currentWidth = startWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    beginGlobalDrag(); // 拖拽期让 webview/iframe 失明,pointerup 不再被网页吞掉
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      endGlobalDrag();
      localStorage.setItem("workbench.sidebarWidth", String(Math.round(currentWidth)));
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons === 0) { onUp(); return; } // 松手事件丢了也能自愈
      const next = Math.max(220, Math.min(420, startWidth + ev.clientX - startX));
      currentWidth = next;
      setSidebarWidth(next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── tab 行的响应式:放不下「图标+文字」就整行退化为纯图标(悬停有 title)──
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const labelWidth = (text: string) => {
    if (!measureCtxRef.current) measureCtxRef.current = document.createElement("canvas").getContext("2d");
    const ctx = measureCtxRef.current;
    if (!ctx) return text.length * 13;
    ctx.font = '500 13px Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    return ctx.measureText(text).width;
  };
  const PANEL_TAB_CHROME = 8 + 13 + 6; // px-1 两侧 + 图标 + 图标文字间距
  const panelsNeedWidth =
    panels.reduce((sum, p) => sum + PANEL_TAB_CHROME + Math.ceil(labelWidth(p.title)), 0)
    + 36 /* + 按钮及其边距 */ + 8 /* 呼吸余量 */;

  // ── 宿主自己的菜单(面板库 / 扩展面板移除)──
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openPanelGallery = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = Object.values(EXT_PANELS).map((p) => {
      const installed = extPanels.includes(p.id);
      const Icon = p.icon;
      return {
        label: installed ? `${p.title}(已添加)` : `添加「${p.title}」面板`,
        icon: <Icon size={13} className={installed ? "" : "text-accent"} />,
        onClick: () => (installed ? switchTab(p.id) : installPanel(p.id)),
      };
    });
    items.push("divider", {
      label: "用 AI 定制面板(即将开放)",
      icon: <Sparkles size={13} className="text-accent" />,
      disabled: true,
      onClick: () => {},
    });
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };
  const onPanelTabContext = (e: React.MouseEvent, p: PanelDef) => {
    if (!p.ext) return; // 内置面板无右键项
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [{ label: `移除「${p.title}」面板`, icon: <X size={13} />, danger: true, onClick: () => removePanel(p.id) }],
    });
  };

  // 移动端抽屉:选中即收(文件夹除外)
  const handleSelect = (n: Node | null) => {
    onSelect(n);
    if (mobileOpen && n?.kind !== "space") onCloseMobile?.();
  };
  const handleToggleActivity = () => {
    onOpenActivity?.();
    if (mobileOpen) onCloseMobile?.();
  };
  const handleToggleSettings = () => {
    onOpenSettings();
    if (mobileOpen) onCloseMobile?.();
  };

  return (
    <aside
      style={{ width: `min(${sidebarWidth}px, calc(100vw - 32px))` }}
      className={[
        "flex-col border-r border-border bg-bg-raised shrink-0",
        "absolute inset-y-0 left-0 z-40 shadow-2xl shadow-black/10",
        "md:relative md:shadow-none",
        // 移动端:关闭时直接 hidden;桌面端由汉堡切换
        mobileOpen ? "flex" : "hidden",
        desktopOpen ? "md:flex" : "md:hidden",
      ].join(" ")}
    >
      {/* brand:右上角 = 汉堡,只管侧栏收起(移动端沿用 X 关闭抽屉) */}
      <div className="flex items-center gap-2.5 px-3.5 h-11 border-b border-border">
        <span className="text-[20px] leading-none select-none">🌳</span>
        <span className="text-[17px] font-semibold text-text flex-1 tracking-tight">Workbench</span>
        {onToggleNav && (
          <button
            onClick={onToggleNav}
            title="收起侧边栏"
            className="hidden md:flex w-6 h-6 rounded items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
          >
            <Menu size={16} />
          </button>
        )}
        {onCloseMobile && (
          <button
            onClick={onCloseMobile}
            className="md:hidden w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* 面板区:可扩展功能区的 tab 行;行末 + = 添加面板(创建操作归各面板内部) */}
      <div className="flex items-stretch border-b border-border">
        {panels.map((p) => (
          <button
            key={p.id}
            onClick={() => switchTab(p.id)}
            onContextMenu={(e) => onPanelTabContext(e, p)}
            title={p.ext ? `${p.title}(扩展面板,右键可移除)` : p.title}
            className={[
              "flex-1 min-w-0 flex items-center justify-center gap-1.5 h-9 px-1 text-[13px] transition-colors border-b-2 -mb-px",
              activePanelId === p.id
                ? "border-accent text-text font-medium"
                : "border-transparent text-text-dim hover:text-text hover:bg-bg-hover",
            ].join(" ")}
          >
            <p.icon size={13} className="shrink-0" />
            {/* 空间不够放全 → 整行纯图标,不出半截省略号 */}
            {panelsNeedWidth <= sidebarWidth && <span className="truncate">{p.title}</span>}
          </button>
        ))}
        <button
          onClick={openPanelGallery}
          title="添加面板"
          className="self-center shrink-0 w-6 h-6 mx-1.5 rounded flex items-center justify-center text-text-faint hover:text-accent hover:bg-bg-hover transition-colors"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* ── 面板身体 ──
          会话:切走即卸(列表状态廉价,重挂即取);
          文件:常驻隐藏 —— 展开集/多选/键盘锚点都是重状态,必须跨切换保活;
          其余(预置「网站」+ 扩展):iframe 沙箱,激活时装载 */}
      {activePanelId === "agents" && (
        <AgentRail
          selectedId={selectedId}
          onSelect={handleSelect}
          refreshKey={refreshKey}
          socket={socket}
          createReq={agentCreateReq}
          onCreateHandled={() => setAgentCreateReq(null)}
        />
      )}
      <FilesPanel
        active={activePanelId === "files"}
        selectedId={selectedId}
        onSelect={handleSelect}
        onOpenSide={onOpenSide}
        onOpenTerminal={onOpenTerminal}
        onOpenGit={onOpenGit}
        onCreateAgentAt={createAgentAt}
        createParentId={createParentId}
        refreshKey={refreshKey}
        onChanged={onChanged}
      />
      {activePanelId !== "agents" && activePanelId !== "files" && (
        <PanelFrame key={activePanelId} panelId={activePanelId} onOpenUrl={onOpenUrl} />
      )}

      {/* footer */}
      <div className="border-t border-border px-1.5 py-1.5 flex items-center gap-1">
        <button
          onClick={handleToggleActivity}
          title="活动:智能体之间的调用"
          className={[
            "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[13px] transition-colors",
            activityActive ? "bg-bg-inset text-text" : "text-text-dim hover:bg-bg-hover hover:text-text",
          ].join(" ")}
        >
          <Radio size={13} />
          <span>活动</span>
        </button>
        <button
          onClick={handleToggleSettings}
          title="设置"
          className={[
            "flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[13px] transition-colors",
            settingsActive ? "bg-bg-inset text-text" : "text-text-dim hover:bg-bg-hover hover:text-text",
          ].join(" ")}
        >
          <Settings size={13} />
          <span>设置</span>
        </button>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <div
        onPointerDown={startResize}
        className="hidden md:block absolute top-0 right-[-3px] z-20 h-full w-1.5 cursor-col-resize hover:bg-accent/25"
        title="调整侧边栏宽度"
      />
    </aside>
  );
}
