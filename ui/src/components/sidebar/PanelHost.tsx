// 面板宿主:侧边栏的「壳」。
//
// 活动栏 = 原生四件(会话/文件/网站/应用,焊死)+ 用户在「组件」里打开显示开关的组件。
// 宿主只管:品牌行与开关、tab 行(空间不足退化纯图标,再溢出则横向滚动)、宽度、移动端抽屉、
// 底部设置。组件的身体是 iframe,指向组件自己的 origin,契约见 WIDGET.md。
import { useEffect, useRef, useState } from "react";
import { api, type GitRepositoryStatus, type Node } from "../../api";
import { ContextMenu, dialog, type MenuItem } from "../ui";
import { LayoutGrid, MoreHorizontal, PanelLeft, Settings, Sparkles, X } from "lucide-react";
import { APP_NAME } from "../../lib/brand";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import { CREATE_WIDGET_EVENT, dropPin, togglePin as togglePinId, useWidgetPins } from "../../lib/widgetPins";
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

/** 「让 AI 造一个应用」的开工指令:自包含的契约速查表(见 AGENT 仓库 SPEC.md)。 */
const buildAppPrompt = (desc: string) => `请为我造一个应用:${desc.trim()}

应用 = 应用的家里的一个目录,**一个有自己 origin 的本地网站**。
宿主把它跑起来、摆进「应用」面板、介绍给 AI:

<应用的家>/apps/<id>/
  manifest.json   声明:是什么、怎么跑、要什么
  APP.md          文档:API 表 / 什么时候用 / 数据 —— 给模型读
  icon.svg        可选
  (实现)          随便什么语言、框架、构建方式,契约不管

先用 bash 查出应用的家:它是默认工作区根下的 apps/ 目录(与 widgets/ 并列)。

manifest.json:
{ "id": "notes", "name": "便签", "version": "0.1.0",
  "description": "一句话说清是什么、什么时候用 —— 这行会常驻 AI 的提示词",
  "run": { "command": "node", "args": ["server.js"], "health": "/health", "mode": "on-demand" },
  "permissions": ["ai.complete"] }     ← ai.complete / notify,不写就没有

生命周期,这几条必须守:
1. **监听 process.env.PORT,绑定 process.env.HOST**(别写死 127.0.0.1 ——
   绑哪个地址是宿主决定的);
2. **整站自己应答**:页面、静态资源、API 全从这个端口出,GUI 在 / 上;
3. **health 是三态的**:2xx = 就绪;其它 HTTP 应答(如 503)= 活着但还在初始化,
   宿主会继续等;连不上 = 没起来。启动慢就先答 503,起好了再答 200;
4. 数据写 process.env.APP_DATA_DIR(宿主已建好),别写进 app 目录;
5. on-demand 的应用闲置会被回收。**浏览器直连你的 origin,那些流量宿主看不见** ——
   有长任务就在 health 里应答 {"busy": true},或者把状态落盘、随时可恢复;
6. run.args 原样传给进程,不经 shell、不做变量展开 —— 要用 PORT 就在程序里读环境变量。

宿主能力(要用才声明,带 Authorization: Bearer \${process.env.APP_TOKEN}):
  POST \${process.env.HOST_URL}/host/ai/complete   { prompt, instructions? } → { text }
  POST \${process.env.HOST_URL}/host/notify        { text, kind?: "toast"|"badge" }
文件、网络、进程你本来就有,不需要宿主转手。

**人机协同是重点:状态只有一份真相,在你的 server 侧。**
人在界面上改、AI 调你的 API 改,改的是同一份状态;而且经 API 发生的变更
必须反映到正在看的界面上(SSE / WebSocket / 轮询都行)——
否则 AI 改了内容而用户在屏幕上看不见,协同就是背对背各改各的。

最后写 APP.md:API 表(方法/路径/参数/返回,AI 照着 curl 你)、什么时候用、
数据结构、以及不可逆的端点必须写明「此操作不可逆」。

写完告诉我应用名,以及怎么在「应用」面板里打开它。`;

export function PanelHost({
  selectedId,
  onSelect,
  socket,
  onOpenUrl,
  onOpenApp,
  onToggleNav,
  onOpenSide,
  onOpenTerminal,
  onOpenGit,
  createParentId,
  refreshKey,
  settingsActive,
  onOpenSettings,
  onOpenWidgets,
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
  /** 在标签页打开应用(tab 挂载;去重聚焦与 route 推送在工作区层)。 */
  onToggleNav?: () => void;
  onOpenSide?: (n: Node) => void;
  onOpenTerminal?: (n: Node, opts?: { command?: string; titlePrefix?: string }) => void;
  onOpenGit?: (repo: GitRepositoryStatus) => void;
  createParentId?: string | null;
  refreshKey: number;
  settingsActive: boolean;
  onOpenSettings: () => void;
  /** 打开「组件」管理标签页(管理是摊开来看的事,不塞侧栏)。 */
  onOpenWidgets?: () => void;
  mobileOpen?: boolean;
  desktopOpen?: boolean;
  onCloseMobile?: () => void;
  onChanged?: () => void;
}) {
  // ── 组件:全部来自组件的家(<家>/widgets/<id>/),目录即安装 ──
  const pinned = useWidgetPins();
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
  const activePanelId = nativeIds.includes(sideTab) || pinnedWidgets.some((w) => w.id === sideTab)
    ? sideTab : "agents";
  const switchTab = (tab: string) => {
    setSideTab(tab);
    localStorage.setItem("workbench.sideTab", tab);
  };

  const togglePin = (widget: WidgetDef) => {
    togglePinId(widget.id);
    if (sideTab === widget.id) switchTab("agents"); // 取下的正是当前面板,回会话
  };
  const removeWidget = async (widget: WidgetDef) => {
    const ok = await dialog.confirm(
      `删除组件「${widget.name}」?\n目录 widgets/${widget.id}/(含数据 data.db)会移进回收站,30 天后清除。`,
      { danger: true, confirmText: "删除" },
    );
    if (!ok) return;
    try { await api.removeWidget(widget.id); } catch (e: any) { void dialog.alert(e?.message || "删除失败"); return; }
    void reloadWidgets();
    dropPin(widget.id);
    if (sideTab === widget.id) switchTab("agents");
  };

  // 让 AI 造一个组件:一句话 → 新对话 → agent 在 widgets/ 里写出目录 → 自动出现在「组件」面板
  const createWidgetWithAI = async () => {
    const desc = await dialog.prompt("", {
      title: "让 AI 创建组件",
      placeholder: "描述组件功能,例如:喝水打卡,记录每天几杯",
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

  // 让 AI 造一个应用:与造组件同一条路,只是给的契约不同
  const createAppWithAI = async () => {
    const desc = await dialog.prompt("", {
      title: "让 AI 创建应用",
      placeholder: "描述应用功能,例如:看板,任务可拖动改变状态",
      confirmText: "开工",
    });
    if (!desc || !desc.trim()) return;
    try {
      const r = await api.createChat({ title: "", workdir: createParentId || undefined });
      onSelect(r.node);
      socket.send({ type: "send", chatId: r.node.id, prompt: buildAppPrompt(desc) });
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

  // ── 活动栏溢出:标签区横向滚动 ────────────────────────────────────────
  const tabStripRef = useRef<HTMLDivElement>(null);
  // 鼠标竖向滚轮 → 横向滚动(触控板横滑由 overflow-x-auto 原生处理)
  const onTabStripWheel = (e: React.WheelEvent) => {
    const el = tabStripRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    el.scrollLeft += e.deltaY;
  };
  // 当前面板滚进视野:排在末尾的组件被切到时,不能停在看不见的地方
  useEffect(() => {
    tabStripRef.current
      ?.querySelector<HTMLElement>(`[data-panel-tab="${CSS.escape(activePanelId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePanelId, pinnedWidgets.length]);

  // ── 活动栏的「更多」菜单 ──────────────────────────────────────────────
  // 勾选式:一眼看清哪些组件在活动栏上,点一下即上/下。仿 VS Code 活动栏右键菜单。
  // 点完即关 —— 菜单项是打开那一刻的快照,留着不关勾选状态就是假的。
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openMoreMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = widgets.map((w) => {
      const on = pinned.includes(w.id);
      return {
        label: w.name,
        checked: on,
        icon: <span className="text-[13px] leading-none">{w.icon}</span>,
        onClick: () => {
          togglePin(w);
          if (!on) switchTab(w.id); // 刚勾上就切过去,省一次点击
        },
      };
    });
    if (!widgets.length) {
      items.push({ label: "还没有组件", disabled: true, onClick: () => {} });
    }
    items.push("divider");
    items.push({ label: "创建组件…", icon: <Sparkles size={13} />, onClick: createWidgetWithAI });
    items.push({ label: "管理组件…", icon: <LayoutGrid size={13} />, onClick: () => onOpenWidgets?.() });
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };
  const onPinnedTabContext = (e: React.MouseEvent, widget: WidgetDef) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [{ label: `从侧边栏隐藏「${widget.name}」`, icon: <X size={13} />, onClick: () => togglePin(widget) }],
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

  // 有文字时平分宽度;退化成纯图标后改固定宽 —— 再多也只是滚动,不会继续压扁到糊在一起
  const tabClass = (active: boolean) => [
    "flex items-center justify-center gap-1.5 h-9 text-[13px] transition-colors border-b-2 -mb-px",
    iconOnly ? "shrink-0 w-9" : "flex-1 min-w-0 px-1",
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
        <span className="text-[17px] font-semibold text-text flex-1 tracking-tight">{APP_NAME}</span>
        {onToggleNav && (
          <button
            onClick={onToggleNav}
            title="收起侧边栏"
            className="hidden md:flex w-6 h-6 rounded items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
          >
            {/* 分割线偏左 = 左侧那块面板,指的就是这条侧栏;居中的那个(Columns2)是分屏 */}
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

      <div className="flex items-stretch border-b border-border">
        {/* 只有标签区滚动,行末 ⋯ 不参与 —— 与标签栏同一口径,按钮永远在,标签再多也不糊 */}
        <div ref={tabStripRef} onWheel={onTabStripWheel} className="flex-1 min-w-0 flex items-stretch overflow-x-auto no-scrollbar">
        {NATIVE_PANELS.map((p) => (
          <button key={p.id} data-panel-tab={p.id} onClick={() => switchTab(p.id)} title={p.title} className={tabClass(activePanelId === p.id)}>
            <p.icon size={13} className="shrink-0" />
            {!iconOnly && <span className="truncate">{p.title}</span>}
          </button>
        ))}
        {pinnedWidgets.map((w) => (
          <button
            key={w.id}
            data-panel-tab={w.id}
            onClick={() => switchTab(w.id)}
            onContextMenu={(e) => onPinnedTabContext(e, w)}
            title={`${w.name}(组件,右键可从侧边栏隐藏)`}
            className={tabClass(activePanelId === w.id)}
          >
            <span className="shrink-0 text-[13px] leading-none">{w.icon}</span>
            {!iconOnly && <span className="truncate">{w.name}</span>}
          </button>
        ))}
        </div>
        <button
          onClick={openMoreMenu}
          title="更多:选择活动栏上的组件"
          className="self-center shrink-0 w-6 h-6 mx-1.5 rounded flex items-center justify-center text-text-faint hover:text-accent hover:bg-bg-hover transition-colors"
        >
          <MoreHorizontal size={15} />
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
      {activePanelId === "apps" && (
        <AppsPanel socket={socket} onOpenApp={(app) => onOpenApp(app.id, app.name)} onCreate={createAppWithAI} />
      )}
      {activeWidget && <WidgetFrame key={activeWidget.id} widget={activeWidget} />}

      {/* footer:只剩设置一项,按普通行左对齐(不再是两个并排的等分格) */}
      <div className="border-t border-border px-1.5 py-1.5">
        <button
          onClick={handleToggleSettings}
          title="设置"
          className={[
            "w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] transition-colors",
            settingsActive ? "bg-bg-inset text-text" : "text-text-dim hover:bg-bg-hover hover:text-text",
          ].join(" ")}
        >
          <Settings size={13} className="shrink-0" />
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
