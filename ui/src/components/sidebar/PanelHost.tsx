// 面板宿主:侧边栏的「壳」= 最左侧竖排活动栏 + 内容面板。
//
// 活动栏仿 VS Code:贯穿整个窗口高度,分三段 ——
//   原生四件(会话/文件/网站/应用,焊死)钉顶 → 钉住的组件(唯一可滚动段)→ 加号/设置钉底。
// 组件再多也挤不走原生入口;状态点(会话未读/运行、应用在跑)上浮到图标上,面板关着也看得见。
// 「收起侧栏」只收内容面板,活动栏常驻;点当前图标一下 = 收起(VS Code 的肌肉记忆)。
// 组件的身体是 iframe,指向组件自己的 origin,契约见 WIDGET.md。
import { useEffect, useState } from "react";
import { api, type GitRepositoryStatus, type Node } from "../../api";
import { ContextMenu, dialog, type MenuItem } from "../ui";
import { PanelLeft, Plus, Settings, Trash2, X } from "lucide-react";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import { CREATE_WIDGET_EVENT, applyOrder, dropFromOrder, useWidgetOrder, writeOrder } from "../../lib/widgetOrder";
import { EVENTS } from "../../../../server/shared/events";
import { NATIVE_PANELS, type WidgetDef } from "./registry";
import { ChatRail } from "./panels/ChatRail";
import { FilesPanel } from "./panels/FilesPanel";
import { SitesPanel } from "./panels/SitesPanel";
import { AppsPanel } from "./panels/AppsPanel";
import { WidgetFrame } from "../widgets/WidgetFrame";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

/** 「让 AI 造一个组件」的开工指令:自包含的契约速查表(全写进提示词,不指望 AI 去翻文档)。 */
const buildWidgetPrompt = (desc: string) => `请为我造一个组件:${desc.trim()}

组件 = 组件的家里的一个目录,**零构建**(浏览器直接吃,不打包、不装依赖),
写出目录即安装,自动出现在「组件」面板里:

<组件的家>/widgets/<id>/
  widget.json   manifest
  index.html    入口(必需)
  main.js       随便几个 js/css,用 ES module 互相 import
  style.css
  data.db       组件的数据(宿主自动创建,别手建、别读写它)

先用 bash 查出组件的家:它是默认工作区根下的 widgets/ 目录。

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

写完告诉我组件名,以及在「组件」标签页里怎么打开它的显示开关。`;

export function PanelHost({
  selectedId,
  onSelect,
  socket,
  onOpenUrl,
  onOpenApp,
  onToggleNav,
  onSetDesktopOpen,
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
  /** 打开一个应用(开在标签页 —— 组件挂侧栏,应用上标签)。 */
  onOpenApp: (appId: string, name: string) => void;
  onToggleNav?: () => void;
  /** 直接设定内容面板开合(点当前图标收起、点别的图标展开都要一个确定态,toggle 不够)。 */
  onSetDesktopOpen?: (open: boolean) => void;
  onOpenSide?: (n: Node) => void;
  onOpenTerminal?: (n: Node, opts?: { command?: string; titlePrefix?: string }) => void;
  onOpenGit?: (repo: GitRepositoryStatus) => void;
  createParentId?: string | null;
  refreshKey: number;
  settingsActive: boolean;
  onOpenSettings: () => void;
  /** 打开「组件」管理标签页(管理是摊开来看的事,不塞侧栏)。 */
  mobileOpen?: boolean;
  desktopOpen?: boolean;
  onCloseMobile?: () => void;
  onChanged?: () => void;
}) {
  // ── 组件:全部来自组件的家(<家>/widgets/<id>/),目录即安装 ──
  const order = useWidgetOrder();
  const [widgets, setWidgets] = useState<WidgetDef[]>([]);
  const reloadWidgets = () => api.listWidgets()
    .then((list) => setWidgets(list as WidgetDef[]))
    .catch(() => {});
  useEffect(() => { void reloadWidgets(); }, [refreshKey]);
  // 装了就上活动栏,没有钉选;顺序 = 用户拖出来的顺序,新装的垫后
  const railWidgets = applyOrder(widgets);
  void order; // 订阅它只为拖拽后重排

  const [sideTab, setSideTab] = useState<string>(() => localStorage.getItem("workbench.sideTab") || "agents");
  // 活动栏组件段的拖拽排序:dragId = 手里拿着谁;dropAt = 松手会插到谁前面(null = 段尾)
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null | undefined>(undefined);
  const reorder = (id: string, beforeId: string | null) => {
    const ids = railWidgets.map((w) => w.id).filter((x) => x !== id);
    const at = beforeId == null ? ids.length : ids.indexOf(beforeId);
    ids.splice(at < 0 ? ids.length : at, 0, id);
    writeOrder(ids);
  };
  const nativeIds = NATIVE_PANELS.map((p) => p.id as string);
  const activePanelId = nativeIds.includes(sideTab) || railWidgets.some((w) => w.id === sideTab)
    ? sideTab : "agents";
  const switchTab = (tab: string) => {
    setSideTab(tab);
    localStorage.setItem("workbench.sideTab", tab);
  };

  // 活动栏点击:点当前图标 = 收起面板;点别的 = 切换并展开(VS Code 的肌肉记忆)
  const onRailClick = (id: string) => {
    const desktop = window.matchMedia("(min-width: 768px)").matches;
    if (desktop && activePanelId === id && desktopOpen) { onSetDesktopOpen?.(false); return; }
    switchTab(id);
    if (desktop && !desktopOpen) onSetDesktopOpen?.(true);
  };

  // ── 图标上的状态点:面板关着也看得见 ──
  // 会话:运行中亮蓝点,只有未读亮绿点(与列表里的点同一套语义)
  const [chatBadge, setChatBadge] = useState<"" | "run" | "unread">("");
  useEffect(() => {
    let gone = false;
    const load = () => {
      void Promise.all([api.listChats().catch(() => null), api.listRuns().catch(() => null)])
        .then(([chats, runs]) => {
          if (gone) return;
          const running = !!(runs?.ids || []).length;
          const unread = !!chats?.chats.some((c) => c.unread);
          setChatBadge(running ? "run" : unread ? "unread" : "");
        });
    };
    load();
    // refreshKey 不含 START(App 只在终局事件上节流刷新),运行点要即时亮,这里自己订阅
    const offs = [EVENTS.START, EVENTS.DONE, EVENTS.ABORTED, EVENTS.ERROR, EVENTS.INPUT, "chats_changed"]
      .map((t) => socket.on(t, load));
    return () => { gone = true; offs.forEach((off) => off()); };
  }, [socket, refreshKey]);
  // 应用:有一个在跑就亮蓝点
  const [appsRunning, setAppsRunning] = useState(false);
  useEffect(() => {
    const load = () => void api.listApps()
      .then((list) => setAppsRunning(list.some((a) => a.status === "ready" || a.status === "starting")))
      .catch(() => {});
    load();
    return socket.on("app_status", load);
  }, [socket]);
  const nativeBadge = (id: string): "" | "run" | "unread" => {
    if (id === "agents") return chatBadge;
    if (id === "apps") return appsRunning ? "run" : "";
    return "";
  };

  const removeWidget = async (widget: WidgetDef) => {
    const ok = await dialog.confirm(
      `删除组件「${widget.name}」?\n目录 widgets/${widget.id}/(含数据 data.db)会移进回收站,30 天后清除。`,
      { danger: true, confirmText: "删除" },
    );
    if (!ok) return;
    try { await api.removeWidget(widget.id); } catch (e: any) { void dialog.alert(e?.message || "删除失败"); return; }
    void reloadWidgets();
    dropFromOrder(widget.id);
    if (sideTab === widget.id) switchTab("agents");
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

  // 组件管理页(标签页)里点「让 AI 造一个」—— 动作住在这儿(要开对话、发提示词)
  useEffect(() => {
    const onCreate = () => { void createWidgetWithAI(); };
    window.addEventListener(CREATE_WIDGET_EVENT, onCreate);
    return () => window.removeEventListener(CREATE_WIDGET_EVENT, onCreate);
  });

  // ── 宽度拖拽(只管内容面板;活动栏定宽)──
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

  // ── 右键菜单(组件图标):删除。加号不再是菜单 —— 点了就是创建 ──
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const onWidgetContext = (e: React.MouseEvent, widget: WidgetDef) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [{ label: `删除组件「${widget.name}」`, icon: <Trash2 size={13} />, danger: true, onClick: () => void removeWidget(widget) }],
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

  const activeWidget = railWidgets.find((w) => w.id === activePanelId) || null;
  const activeNative = NATIVE_PANELS.find((p) => p.id === activePanelId) || null;

  return (
    <aside
      className={[
        "flex border-r border-border bg-bg-raised shrink-0",
        "absolute inset-y-0 left-0 z-40 shadow-2xl shadow-black/10",
        "md:relative md:shadow-none",
        mobileOpen ? "flex" : "hidden",
        "md:flex", // 桌面端活动栏常驻 —— 收起收的是内容面板,不是它
      ].join(" ")}
    >
      {/* ── 活动栏:52px 竖排,三段 ── */}
      <div className="w-[52px] shrink-0 flex flex-col items-center pt-2 pb-1.5 border-r border-border">
        <div className="shrink-0 w-full flex flex-col items-center gap-0.5">
          {NATIVE_PANELS.map((p) => (
            <RailButton
              key={p.id}
              title={p.title}
              active={activePanelId === p.id && !settingsActive}
              badge={nativeBadge(p.id)}
              onClick={() => onRailClick(p.id)}
            >
              <p.icon size={18} />
            </RailButton>
          ))}
        </div>
        <div className="shrink-0 w-7 h-px bg-border my-1.5" />
        {/* 组件段:唯一允许滚动的一段 —— 组件再多,原生四件和底部加号/设置也永远钉住 */}
        <div
          className="flex-1 min-h-0 w-full overflow-y-auto no-scrollbar flex flex-col items-center gap-0.5"
          onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropAt(null); } }}
          onDrop={(e) => { if (dragId) { e.preventDefault(); reorder(dragId, null); } }}
        >
          {railWidgets.map((w) => (
            <div
              key={w.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                setDragId(w.id);
                beginGlobalDrag();
              }}
              onDragEnd={() => { setDragId(null); setDropAt(undefined); endGlobalDrag(); }}
              onDragOver={(e) => {
                if (!dragId || dragId === w.id) return;
                e.preventDefault();
                e.stopPropagation();
                setDropAt(w.id);
              }}
              onDrop={(e) => {
                if (!dragId || dragId === w.id) return;
                e.preventDefault();
                e.stopPropagation();
                reorder(dragId, w.id);
              }}
              className={[
                "relative",
                dragId === w.id ? "opacity-40" : "",
                // 插入指示线:落点上方一条 accent 短线
                dropAt === w.id ? "before:content-[''] before:absolute before:-top-[3px] before:left-1 before:right-1 before:h-[2px] before:rounded before:bg-accent" : "",
              ].join(" ")}
            >
              <RailButton
                title={`${w.name}(组件,可拖动排序,右键删除)`}
                active={activePanelId === w.id && !settingsActive}
                onClick={() => onRailClick(w.id)}
                onContextMenu={(e) => onWidgetContext(e, w)}
              >
                <span className="text-[16px] leading-none">{w.icon}</span>
              </RailButton>
            </div>
          ))}
        </div>
        <div className="shrink-0 w-full flex flex-col items-center gap-0.5 pt-1">
          <div className="w-7 h-px bg-border mb-1" />
          <RailButton title="创建组件" active={false} onClick={createWidgetWithAI}>
            <Plus size={18} />
          </RailButton>
          <RailButton title="设置" active={settingsActive} onClick={handleToggleSettings}>
            <Settings size={18} />
          </RailButton>
        </div>
      </div>

      {/* ── 内容面板:桌面端可收起(活动栏留着),移动端跟抽屉走 ── */}
      <div
        style={{ width: `min(${sidebarWidth}px, calc(100vw - 84px))` }}
        className={[
          "relative flex flex-col min-w-0",
          desktopOpen ? "" : "md:hidden",
        ].join(" ")}
      >
        {/* 面板头:一行搞定 —— 当前面板叫什么 + 右侧收起(移动端 X 关抽屉),没有品牌行 */}
        <div className="shrink-0 h-10 flex items-center gap-2 px-3.5 border-b border-border">
          {activeWidget
            ? <span className="text-[14px] leading-none">{activeWidget.icon}</span>
            : activeNative && <activeNative.icon size={14} className="text-accent shrink-0" />}
          <span className="text-[13px] font-medium text-text truncate flex-1">
            {activeWidget ? activeWidget.name : activeNative?.title}
          </span>
          {onToggleNav && (
            <button
              onClick={onToggleNav}
              title="收起侧栏面板(活动栏不会消失)"
              className="hidden md:flex w-6 h-6 rounded items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
            >
              <PanelLeft size={16} />
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

        {/* ── 面板身体:会话切走即卸;文件常驻隐藏保重状态;组件 = iframe 沙箱 ── */}
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
        {activePanelId === "apps" && (
          <AppsPanel socket={socket} onOpenApp={(app) => onOpenApp(app.id, app.name)} />
        )}
        {activeWidget && <WidgetFrame key={activeWidget.id} widget={activeWidget} />}

        <div
          onPointerDown={startResize}
          className="hidden md:block absolute top-0 right-[-3px] z-20 h-full w-1.5 cursor-col-resize hover:bg-accent/25"
          title="调整侧边栏宽度"
        />
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}

/** 活动栏按钮:44×40,选中 = 软底色 + 左缘指示条;状态点压在图标右上角。 */
function RailButton({
  title,
  active,
  badge = "",
  onClick,
  onContextMenu,
  children,
}: {
  title: string;
  active: boolean;
  badge?: "" | "run" | "unread";
  onClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
      className={[
        "relative w-11 h-10 shrink-0 rounded-lg flex items-center justify-center transition-colors",
        active ? "bg-accent-soft text-accent" : "text-text-faint hover:text-text-dim hover:bg-bg-hover",
      ].join(" ")}
    >
      {children}
      {badge && (
        <span className={[
          "absolute top-1.5 right-2 w-[7px] h-[7px] rounded-full border-2 border-bg-raised",
          badge === "run" ? "bg-accent" : "bg-success",
        ].join(" ")} />
      )}
      {active && <span className="absolute -left-1 top-2 bottom-2 w-[3px] rounded-r bg-accent" />}
    </button>
  );
}
