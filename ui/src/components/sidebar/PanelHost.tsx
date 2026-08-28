// 面板宿主:侧边栏的「壳」。
//
// 活动栏 = 原生三件(会话/文件/应用,焊死)+ 钉上来的应用面板(panel 挂载)。
// 宿主只管:品牌行与汉堡、tab 行(空间不足退化纯图标)、应用的钉与卸、宽度、移动端抽屉、
// 底部 活动/组件/设置。组件的身体是 iframe,指向组件自己的 origin,契约见 WIDGET.md。
import { useEffect, useRef, useState } from "react";
import { api, type GitRepositoryStatus, type Node } from "../../api";
import { ContextMenu, dialog, type MenuItem } from "../ui";
import { LayoutGrid, Menu, Plus, Settings, X } from "lucide-react";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import { NATIVE_PANELS, type WidgetDef } from "./registry";
import { ChatRail } from "./panels/ChatRail";
import { FilesPanel } from "./panels/FilesPanel";
import { WidgetsPanel } from "./panels/WidgetsPanel";
import { SitesPanel } from "./panels/SitesPanel";
import { WidgetFrame } from "../widgets/WidgetFrame";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

const load = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
};
const save = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

/** 钉在活动栏上的组件。默认一个都不钉 —— 装了 ≠ 常用。 */
const initialPinned = (): string[] => {
  const saved = load<string[] | null>("workbench.widgets.pinned", null);
  return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
};

/** 「让 AI 造一个组件」的开工指令:自包含的契约速查表(全写进提示词,不指望 AI 去翻文档)。 */
const buildWidgetPrompt = (desc: string) => `请为我造一个 Workbench 组件:${desc.trim()}

Workbench 组件 = 组件的家里的一个目录,**零构建**(浏览器直接吃,不打包、不装依赖),
写出目录即安装,自动出现在「组件」面板里:

<组件的家>/widgets/<id>/
  widget.json   manifest
  index.html    入口(必需)
  main.js       随便几个 js/css,用 ES module 互相 import
  style.css
  data.db       组件的数据(宿主自动创建,别手建、别读写它)

先用 bash 查出组件的家:它是 Workbench 默认工作区根下的 widgets/ 目录。

widget.json:
{ "name": "习惯打卡", "icon": "✅",
  "description": "一句话说明这个组件干什么(以后 AI 靠它判断该不该复用)",
  "permissions": ["sql"] }        ← sql / ai / fs,不写就没有

宿主 API = **同源 HTTP**,不需要引入任何 SDK,直接 fetch:

  // 数据(权限 sql):组件有自己独立的 SQLite,表结构你自己定
  const sql = (sql, params = []) =>
    fetch("/_wb/sql", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql, params }) }).then((r) => r.json());

  await sql("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT)");
  await sql("INSERT INTO items (text) VALUES (?)", ["买牛奶"]);
  const { rows } = await sql("SELECT * FROM items ORDER BY id DESC");

  // 其它端点
  POST /_wb/sql/batch   { statements: [{sql, params}] }   一个事务
  POST /_wb/ai          { summary, system, prompt }       调 AI(权限 ai,summary 必填)
  GET  /_wb/context                                        组件自身信息

硬性要求:
1. **零构建**:只能用浏览器直接能跑的东西 —— ES module、原生 CSS。
   不要 JSX / TypeScript / SCSS / 打包器,也不要任何外部 CDN(组件被 CSP 断网,连不出去);
2. **相对路径**:<script type="module" src="./main.js">、href="./style.css";
3. **主题变量**:颜色一律用 var(--bg) / var(--bg-raised) / var(--text) / var(--text-dim) /
   var(--border) / var(--accent) / var(--danger),宿主已自动注入,明暗主题会跟着走。
   **不要写死背景色和文字色**;
4. **窄**:它挂在侧栏面板里,最窄 240px 也要能用;
5. 建表用 CREATE TABLE IF NOT EXISTS,放在启动时跑一次。

写完告诉我组件名,以及在「组件」面板里怎么把它钉到活动栏上。`;

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
  mobileOpen = false,
  desktopOpen = true,
  onCloseMobile,
  onChanged,
}: {
  selectedId: string;
  onSelect: (n: Node | null) => void;
  socket: Socket;
  onOpenUrl: (url: string, title?: string) => void;
  /** 在标签页打开应用(tab 挂载;去重聚焦与 route 推送在工作区层)。 */
  onToggleNav?: () => void;
  onOpenSide?: (n: Node) => void;
  onOpenTerminal?: (n: Node, opts?: { command?: string; titlePrefix?: string }) => void;
  onOpenGit?: (repo: GitRepositoryStatus) => void;
  createParentId?: string | null;
  refreshKey: number;
  settingsActive: boolean;
  onOpenSettings: () => void;
  mobileOpen?: boolean;
  desktopOpen?: boolean;
  onCloseMobile?: () => void;
  onChanged?: () => void;
}) {
  // ── 组件:全部来自组件的家(<家>/widgets/<id>/),目录即安装 ──
  const [pinned, setPinned] = useState<string[]>(initialPinned);
  const [widgets, setWidgets] = useState<WidgetDef[]>([]);
  const reloadWidgets = () => api.listWidgets()
    .then((list) => setWidgets(list as WidgetDef[]))
    .catch(() => {});
  useEffect(() => { void reloadWidgets(); }, [refreshKey]);
  const pinnedWidgets = pinned
    .map((id) => widgets.find((w) => w.id === id))
    .filter((w): w is WidgetDef => !!w);

  const [sideTab, setSideTab] = useState<string>(() => localStorage.getItem("workbench.sideTab") || "agents");
  const nativeIds = NATIVE_PANELS.map((p) => p.id as string);
  const activePanelId = nativeIds.includes(sideTab) || sideTab === "widgets" || pinnedWidgets.some((w) => w.id === sideTab)
    ? sideTab : "agents";
  const switchTab = (tab: string) => {
    setSideTab(tab);
    localStorage.setItem("workbench.sideTab", tab);
  };

  const togglePin = (widget: WidgetDef) => {
    setPinned((prev) => {
      const next = prev.includes(widget.id) ? prev.filter((x) => x !== widget.id) : [...prev, widget.id];
      save("workbench.widgets.pinned", next);
      return next;
    });
    if (sideTab === widget.id) switchTab("widgets");
  };
  const removeWidget = async (widget: WidgetDef) => {
    const ok = await dialog.confirm(
      `删除组件「${widget.name}」?\n目录 widgets/${widget.id}/(含数据 data.db)会移进回收站,30 天后清除。`,
      { danger: true, confirmText: "删除" },
    );
    if (!ok) return;
    try { await api.removeWidget(widget.id); } catch (e: any) { void dialog.alert(e?.message || "删除失败"); return; }
    void reloadWidgets();
    setPinned((prev) => {
      const next = prev.filter((x) => x !== widget.id);
      save("workbench.widgets.pinned", next);
      return next;
    });
    if (sideTab === widget.id) switchTab("widgets");
  };

  // 让 AI 造一个组件:一句话 → 新对话 → agent 在 widgets/ 里写出目录 → 自动出现在「组件」面板
  const createWidgetWithAI = async () => {
    const desc = await dialog.prompt("", {
      title: "让 AI 造一个组件",
      placeholder: "描述你要的组件,如:喝水打卡,记录每天几杯",
      confirmText: "开工",
    });
    if (!desc || !desc.trim()) return;
    try {
      const r = await api.createChat({ title: "", workdir: createParentId || undefined });
      onSelect(r.node);
      socket.send({ type: "send", chatId: r.node.id, prompt: buildWidgetPrompt(desc) });
      switchTab("agents");
    } catch (e: any) {
      void dialog.alert(e?.message || "创建失败");
    }
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
    beginGlobalDrag();
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      endGlobalDrag();
      localStorage.setItem("workbench.sidebarWidth", String(Math.round(currentWidth)));
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.buttons === 0) { onUp(); return; }
      const next = Math.max(220, Math.min(420, startWidth + ev.clientX - startX));
      currentWidth = next;
      setSidebarWidth(next);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── tab 行响应式:放不下「图标+文字」就整行纯图标 ──
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const labelWidth = (text: string) => {
    if (!measureCtxRef.current) measureCtxRef.current = document.createElement("canvas").getContext("2d");
    const ctx = measureCtxRef.current;
    if (!ctx) return text.length * 13;
    ctx.font = '500 13px Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    return ctx.measureText(text).width;
  };
  const TAB_CHROME = 8 + 14 + 6; // 内边距 + 图标 + 间距
  const tabTitles = [...NATIVE_PANELS.map((p) => p.title), ...pinnedWidgets.map((w) => w.name)];
  const needWidth = tabTitles.reduce((sum, t) => sum + TAB_CHROME + Math.ceil(labelWidth(t)), 0) + 36 + 8;
  const iconOnly = needWidth > sidebarWidth;

  // ── 宿主菜单:+ = 钉面板快捷入口;钉住的应用 tab 右键 = 取下 ──
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openPinPicker = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const candidates = widgets.filter((w) => !pinned.includes(w.id));
    const items: MenuItem[] = candidates.map((w) => ({
      label: `钉上「${w.name}」`,
      icon: <span className="text-[13px] leading-none">{w.icon}</span>,
      onClick: () => { togglePin(w); switchTab(w.id); },
    }));
    if (items.length) items.push("divider");
    items.push({ label: "在「组件」里管理…", icon: <LayoutGrid size={13} />, onClick: () => switchTab("widgets") });
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };
  const onPinnedTabContext = (e: React.MouseEvent, widget: WidgetDef) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [{ label: `从活动栏取下「${widget.name}」`, icon: <X size={13} />, onClick: () => togglePin(widget) }],
    });
  };

  // 移动端抽屉:选中即收(文件夹除外)
  const handleSelect = (n: Node | null) => {
    onSelect(n);
    if (mobileOpen && n?.kind !== "space") onCloseMobile?.();
  };
  const handleToggleSettings = () => {
    onOpenSettings();
    if (mobileOpen) onCloseMobile?.();
  };

  const tabClass = (active: boolean) => [
    "flex-1 min-w-0 flex items-center justify-center gap-1.5 h-9 px-1 text-[13px] transition-colors border-b-2 -mb-px",
    active ? "border-accent text-text font-medium" : "border-transparent text-text-dim hover:text-text hover:bg-bg-hover",
  ].join(" ");

  const activeWidget = pinnedWidgets.find((w) => w.id === activePanelId) || null;

  return (
    <aside
      style={{ width: `min(${sidebarWidth}px, calc(100vw - 32px))` }}
      className={[
        "flex-col border-r border-border bg-bg-raised shrink-0",
        "absolute inset-y-0 left-0 z-40 shadow-2xl shadow-black/10",
        "md:relative md:shadow-none",
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

      {/* 活动栏:原生三件 + 钉住的应用面板;行末 + = 钉面板快捷入口 */}
      <div className="flex items-stretch border-b border-border">
        {NATIVE_PANELS.map((p) => (
          <button key={p.id} onClick={() => switchTab(p.id)} title={p.title} className={tabClass(activePanelId === p.id)}>
            <p.icon size={13} className="shrink-0" />
            {!iconOnly && <span className="truncate">{p.title}</span>}
          </button>
        ))}
        {pinnedWidgets.map((w) => (
          <button
            key={w.id}
            onClick={() => switchTab(w.id)}
            onContextMenu={(e) => onPinnedTabContext(e, w)}
            title={`${w.name}(组件,右键可取下)`}
            className={tabClass(activePanelId === w.id)}
          >
            <span className="shrink-0 text-[13px] leading-none">{w.icon}</span>
            {!iconOnly && <span className="truncate">{w.name}</span>}
          </button>
        ))}
        <button
          onClick={openPinPicker}
          title="钉一个组件到活动栏"
          className="self-center shrink-0 w-6 h-6 mx-1.5 rounded flex items-center justify-center text-text-faint hover:text-accent hover:bg-bg-hover transition-colors"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* ── 面板身体:会话切走即卸;文件常驻隐藏保重状态;应用 = iframe 沙箱 ── */}
      {activePanelId === "agents" && (
        <ChatRail
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
      {activePanelId === "sites" && <SitesPanel onOpenUrl={onOpenUrl} socket={socket} />}
      {activePanelId === "widgets" && (
        <WidgetsPanel
          widgets={widgets}
          pinnedIds={pinned}
          onTogglePin={(w) => { togglePin(w); if (!pinned.includes(w.id)) switchTab(w.id); }}
          onRemove={removeWidget}
          onCreateWithAI={createWidgetWithAI}
        />
      )}
      {activeWidget && <WidgetFrame key={activeWidget.id} widget={activeWidget} />}

      {/* footer */}
      <div className="border-t border-border px-1.5 py-1.5 flex items-center gap-1">
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
