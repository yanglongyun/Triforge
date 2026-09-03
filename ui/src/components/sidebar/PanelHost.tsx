// 面板宿主:侧边栏的「壳」。
//
// 骨架三层:
//   上半 = 品牌行(名字 + 收起把手)→ 三段固定面板(对话 / 文件 / 网站)下划线式横向切换;运行中的对话在段名旁亮点
//   下半 = 工具箱(可开合):打开后侧栏上下对半分,格子里是装好的组件,点一个整块进入该组件(iframe),「‹」返回
//   底栏 = 工具箱开关(带数量)+ 设置(在主区开标签页)
// 没有活动栏、没有钉住:组件不占侧栏任何常驻位置。应用与技能在新标签页进,任务在标签栏右端。
// 组件的身体是 iframe,指向组件自己的 origin;契约是出厂技能 skills/widget。
import { useEffect, useState } from "react";
import { api, type GitRepositoryStatus, type Node } from "../../api";
import { ContextMenu, dialog, type MenuItem } from "../ui";
import { ChevronLeft, MoreHorizontal, PanelLeft, Plus, Settings, Trash2, Wrench, X } from "lucide-react";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import { applyOrder, dropFromOrder, useWidgetOrder, writeOrder } from "../../lib/widgetOrder";
import { CREATE_APP_EVENT, CREATE_WIDGET_EVENT } from "../../lib/createRequests";
import { EVENTS } from "../../../../server/shared/events";
import { APP_NAME } from "../../lib/brand";
import { NATIVE_PANELS, type NativePanelId, type WidgetDef } from "./registry";
import { ChatRail } from "./panels/ChatRail";
import { FilesPanel } from "./panels/FilesPanel";
import { SitesPanel } from "./panels/SitesPanel";
import { WidgetFrame } from "../widgets/WidgetFrame";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

/** 「让 AI 造一个组件」的开工指令:契约在出厂技能里,提示词只要指过去。 */
const buildWidgetPrompt = (desc: string) => `请为我造一个组件:${desc.trim()}

按「技能」里的 widget 做。写完告诉我组件名,它会出现在侧栏的工具箱里。`;

/** 「让 AI 造一个应用」的开工指令:自包含的契约速查表(见 AGENT 仓库 SPEC.md)。 */
const buildAppPrompt = (desc: string) => `请为我造一个应用:${desc.trim()}

应用 = 应用的家里的一个目录,**一个有自己 origin 的本地网站**。
宿主把它跑起来、摆进「应用」页、介绍给 AI:

<应用的家>/apps/<id>/
  manifest.json   声明:是什么、怎么跑、要什么
  APP.md          文档:API 表 / 什么时候用 / 数据 —— 给模型读
  icon.svg        可选
  (实现)          随便什么语言、框架、构建方式,契约不管

应用的家是 ~/.worktop/apps/(不是工作目录,不是工作区)。

manifest.json:
{ "id": "notes", "name": "便签", "version": "0.1.0",
  "description": "一句话说清是什么、什么时候用 —— 这行会常驻 AI 的提示词",
  "run": { "command": "node", "args": ["server.js"], "health": "/health", "mode": "on-demand" },
  "permissions": ["ai.complete"] }     ← ai.complete / ai.agent / notify,不写就没有

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

写完告诉我应用名,以及怎么在「应用」页里打开它。`;

const TAB_KEY = "worktop.sideTab";
const TOOLBOX_OPEN_KEY = "worktop.toolbox.open";
const TOOLBOX_WIDGET_KEY = "worktop.toolbox.widget";
const readTab = (): NativePanelId => {
  const v = localStorage.getItem(TAB_KEY);
  return v === "files" || v === "sites" ? v : "agents";
};

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
  /** 整体收起侧栏(收起后标签栏左端出现汉堡)。 */
  onToggleNav?: () => void;
  onOpenSide?: (n: Node) => void;
  onOpenTerminal?: (n: Node, opts?: { command?: string; titlePrefix?: string }) => void;
  onOpenGit?: (repo: GitRepositoryStatus) => void;
  createParentId?: string | null;
  refreshKey: number;
  settingsActive: boolean;
  onOpenSettings: () => void;
  /** 打开「组件」管理标签页(管理是摊开来看的事,不塞侧栏)。 */
  onOpenWidgets: () => void;
  mobileOpen?: boolean;
  desktopOpen?: boolean;
  onCloseMobile?: () => void;
  onChanged?: () => void;
}) {
  // ── 上半:三段 ──
  const [tab, setTab] = useState<NativePanelId>(readTab);
  const switchTab = (next: NativePanelId) => {
    setTab(next);
    localStorage.setItem(TAB_KEY, next);
  };

  // 对话段的状态点:运行中亮蓝点,只有未读亮绿点(与列表里的点同一套语义)
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

  // ── 下半:工具箱 ──
  // 组件全部来自组件的家(<家>/widgets/<id>/),目录即安装;顺序 = 用户拖出来的顺序,新装的垫后
  const order = useWidgetOrder();
  const [widgets, setWidgets] = useState<WidgetDef[]>([]);
  const reloadWidgets = () => api.listWidgets()
    .then((list) => setWidgets(list as WidgetDef[]))
    .catch(() => {});
  useEffect(() => { void reloadWidgets(); }, [refreshKey]);
  const tiles = applyOrder(widgets);
  void order; // 订阅它只为拖拽后重排

  const [toolboxOpen, setToolboxOpen] = useState(() => localStorage.getItem(TOOLBOX_OPEN_KEY) === "1");
  const [widgetId, setWidgetId] = useState<string | null>(() => localStorage.getItem(TOOLBOX_WIDGET_KEY));
  const activeWidget = toolboxOpen ? tiles.find((w) => w.id === widgetId) || null : null;
  const openToolbox = (open: boolean) => {
    setToolboxOpen(open);
    localStorage.setItem(TOOLBOX_OPEN_KEY, open ? "1" : "0");
    if (!open) enterWidget(null);
  };
  const enterWidget = (id: string | null) => {
    setWidgetId(id);
    if (id) localStorage.setItem(TOOLBOX_WIDGET_KEY, id); else localStorage.removeItem(TOOLBOX_WIDGET_KEY);
  };

  // 格子拖拽排序:dragId = 手里拿着谁;dropAt = 松手会插到谁前面(null = 段尾)
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null | undefined>(undefined);
  const reorder = (id: string, beforeId: string | null) => {
    const ids = tiles.map((w) => w.id).filter((x) => x !== id);
    const at = beforeId == null ? ids.length : ids.indexOf(beforeId);
    ids.splice(at < 0 ? ids.length : at, 0, id);
    writeOrder(ids);
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
    if (widgetId === widget.id) enterWidget(null);
  };

  // 让 AI 造一个组件:一句话 → 新对话 → agent 在 widgets/ 里写出目录 → 自动出现在工具箱
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
  // 组件管理页 / 应用页里点「让 AI 造一个」—— 动作住在这儿(要开对话、发提示词)
  useEffect(() => {
    const onWidget = () => { void createWidgetWithAI(); };
    const onApp = () => { void createAppWithAI(); };
    window.addEventListener(CREATE_WIDGET_EVENT, onWidget);
    window.addEventListener(CREATE_APP_EVENT, onApp);
    return () => {
      window.removeEventListener(CREATE_WIDGET_EVENT, onWidget);
      window.removeEventListener(CREATE_APP_EVENT, onApp);
    };
  });

  // 文件面板的「在此新建对话」:切到对话段并带上预设 workdir
  const [agentCreateReq, setAgentCreateReq] = useState<{ workdir?: string } | null>(null);
  const createAgentAt = (workdir?: string) => {
    switchTab("agents");
    setAgentCreateReq({ workdir });
  };

  // 聊天面板的工作目录芯片 → 切到文件段(定位展开由 FilesPanel 自己做)
  useEffect(() => {
    const onReveal = () => switchTab("files");
    window.addEventListener("worktop:reveal-path", onReveal);
    return () => window.removeEventListener("worktop:reveal-path", onReveal);
  }, []);

  // ── 宽度拖拽 ──
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("worktop.sidebarWidth") || "");
    return Number.isFinite(saved) && saved >= 220 && saved <= 420 ? saved : 280;
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
      localStorage.setItem("worktop.sidebarWidth", String(Math.round(currentWidth)));
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

  // ── 菜单 ──
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const onWidgetContext = (e: React.MouseEvent, widget: WidgetDef) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [{ label: `删除组件「${widget.name}」`, icon: <Trash2 size={13} />, danger: true, onClick: () => void removeWidget(widget) }],
    });
  };
  const onToolboxMore = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.right - 176, y: r.bottom + 4,
      items: [
        { label: "管理组件", onClick: onOpenWidgets },
        { label: "让 AI 造一个…", icon: <Plus size={13} />, onClick: () => void createWidgetWithAI() },
      ],
    });
  };

  // 移动端抽屉:选中即收(文件夹除外)
  const handleSelect = (n: Node | null) => {
    onSelect(n);
    if (mobileOpen && n?.kind !== "space") onCloseMobile?.();
  };
  const handleOpenSettings = () => {
    onOpenSettings();
    if (mobileOpen) onCloseMobile?.();
  };

  const iconBtn = "w-6 h-6 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors";

  return (
    <aside
      style={{ width: `min(${sidebarWidth}px, calc(100vw - 48px))` }}
      className={[
        "flex flex-col border-r border-border bg-bg-raised shrink-0",
        "absolute inset-y-0 left-0 z-40 shadow-2xl shadow-black/10",
        "md:relative md:shadow-none",
        mobileOpen ? "flex" : "hidden",
        desktopOpen ? "md:flex" : "md:hidden",
      ].join(" ")}
    >
      {/* ── 上半:三段 ── */}
      <div className="flex-1 min-h-0 basis-0 flex flex-col">
        {/* brand:右上角 = 把手,只管侧栏收起(移动端沿用 X 关闭抽屉) */}
        <div className="shrink-0 flex items-center gap-2.5 px-3.5 h-11 border-b border-border">
          <img src="/icon.svg" alt="" className="w-5 h-5 select-none" draggable={false} />
          <span className="text-[17px] font-semibold text-text flex-1 tracking-tight">{APP_NAME}</span>
          {onToggleNav && (
            <button
              onClick={onToggleNav}
              title="收起侧边栏"
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

        {/* 三段切换:下划线式,三等分;运行中的对话在段名旁亮点 */}
        <div className="shrink-0 flex items-stretch border-b border-border">
          {NATIVE_PANELS.map((p) => {
            const on = tab === p.id;
            const badge = p.id === "agents" ? chatBadge : "";
            return (
              <button
                key={p.id}
                onClick={() => switchTab(p.id)}
                title={p.title}
                className={[
                  "flex-1 min-w-0 px-1 flex items-center justify-center gap-1.5 h-9 text-[13px] transition-colors border-b-2 -mb-px",
                  on ? "border-accent text-text font-medium" : "border-transparent text-text-dim hover:text-text hover:bg-bg-hover",
                ].join(" ")}
              >
                <p.icon size={13} className="shrink-0" />
                <span className="truncate">{p.title}</span>
                {badge && (
                  <span className={["shrink-0 w-[6px] h-[6px] rounded-full", badge === "run" ? "bg-accent animate-pulse" : "bg-success"].join(" ")} />
                )}
              </button>
            );
          })}
        </div>

        {/* 面板身体:对话切走即卸;文件常驻隐藏保重状态;网站切走即卸 */}
        {tab === "agents" && (
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
          active={tab === "files"}
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
        {tab === "sites" && <SitesPanel onOpenUrl={onOpenUrl} socket={socket} />}
      </div>

      {/* ── 下半:工具箱(打开后与上半对半分)── */}
      {toolboxOpen && (
        <div className="flex-1 min-h-0 basis-0 flex flex-col border-t border-border">
          <div className="shrink-0 h-8 flex items-center gap-1 pl-2 pr-1.5 border-b border-border">
            {activeWidget ? (
              <>
                <button onClick={() => enterWidget(null)} title="返回工具箱" className={iconBtn}>
                  <ChevronLeft size={15} />
                </button>
                <span className="text-[13px] leading-none">{activeWidget.icon}</span>
                <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium text-text">{activeWidget.name}</span>
              </>
            ) : (
              <>
                <Wrench size={13} className="shrink-0 text-accent" />
                <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium text-text">工具箱</span>
                <button onClick={onToolboxMore} title="更多" className={iconBtn}>
                  <MoreHorizontal size={15} />
                </button>
              </>
            )}
            <button onClick={() => openToolbox(false)} title="关闭工具箱" className={iconBtn}>
              <X size={14} />
            </button>
          </div>

          {activeWidget ? (
            <WidgetFrame key={activeWidget.id} widget={activeWidget} />
          ) : (
            <div
              className="flex-1 min-h-0 overflow-y-auto p-2"
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropAt(null); } }}
              onDrop={(e) => { if (dragId) { e.preventDefault(); reorder(dragId, null); } }}
            >
              <div className="grid grid-cols-4 gap-1">
                {tiles.map((w) => (
                  <button
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
                    onClick={() => enterWidget(w.id)}
                    onContextMenu={(e) => onWidgetContext(e, w)}
                    title={`${w.name}${w.description ? `\n${w.description}` : ""}\n(可拖动排序,右键删除)`}
                    className={[
                      "relative flex flex-col items-center gap-1 px-1 py-2.5 rounded-lg text-[11.5px] text-text-dim hover:bg-bg-hover transition-colors",
                      dragId === w.id ? "opacity-40" : "",
                      // 插入指示线:落点左侧一条 accent 短线
                      dropAt === w.id ? "before:content-[''] before:absolute before:-left-[3px] before:top-1 before:bottom-1 before:w-[2px] before:rounded before:bg-accent" : "",
                    ].join(" ")}
                  >
                    <span className="text-[22px] leading-none">{w.icon}</span>
                    <span className="max-w-full truncate">{w.name}</span>
                  </button>
                ))}
                <button
                  onClick={() => void createWidgetWithAI()}
                  title="让 AI 造一个组件"
                  className="flex flex-col items-center gap-1 px-1 py-2.5 rounded-lg text-[11.5px] text-text-faint hover:text-text hover:bg-bg-hover transition-colors"
                >
                  <span className="w-[22px] h-[22px] flex items-center justify-center"><Plus size={18} /></span>
                  <span>造一个</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 底栏:工具箱 / 设置 ── */}
      <div className="shrink-0 h-10 flex items-center gap-1 px-2 border-t border-border">
        <button
          onClick={() => openToolbox(!toolboxOpen)}
          title="工具箱:你的组件"
          className={[
            "h-7 px-2.5 rounded-md flex items-center gap-1.5 text-[12.5px] transition-colors",
            toolboxOpen ? "bg-bg-inset text-text" : "text-text-dim hover:text-text hover:bg-bg-hover",
          ].join(" ")}
        >
          <Wrench size={14} className={toolboxOpen ? "text-accent" : ""} />
          工具箱
          {tiles.length > 0 && (
            <span className="px-1.5 py-px rounded-full bg-bg-inset text-[11px] text-text-faint">{tiles.length}</span>
          )}
        </button>
        <span className="flex-1" />
        <button
          onClick={handleOpenSettings}
          title="设置"
          className={[
            "w-7 h-7 rounded-md flex items-center justify-center transition-colors",
            settingsActive ? "bg-bg-inset text-accent" : "text-text-dim hover:text-text hover:bg-bg-hover",
          ].join(" ")}
        >
          <Settings size={15} />
        </button>
      </div>

      <div
        onPointerDown={startResize}
        className="hidden md:block absolute top-0 right-[-3px] z-20 h-full w-1.5 cursor-col-resize hover:bg-accent/25"
        title="调整侧边栏宽度"
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}
