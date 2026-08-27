// 面板宿主:侧边栏的「壳」。
//
// 活动栏 = 原生三件(会话/文件/应用,焊死)+ 钉上来的应用面板(panel 挂载)。
// 宿主只管:品牌行与汉堡、tab 行(空间不足退化纯图标)、应用的钉与卸、宽度、移动端抽屉、
// 底部 活动/设置。应用的身体一律 iframe 沙箱(AppFrame),契约见 APP.md。
import { useEffect, useRef, useState } from "react";
import { api, type GitRepositoryStatus, type Node } from "../../api";
import { ContextMenu, dialog, type MenuItem } from "../ui";
import { Menu, Plus, Radio, Settings, X } from "lucide-react";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import { NATIVE_PANELS, PRESET_APPS, type AppDef } from "./registry";
import { AgentRail } from "./panels/AgentRail";
import { FilesPanel } from "./panels/FilesPanel";
import { AppsPanel } from "./panels/AppsPanel";
import { AppFrame } from "../apps/AppFrame";

type Socket = { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };

const load = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
};
const save = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

/** 首次迁移:0.5.x 的 extPanels(装过的扩展面板)并入钉住列表;网站默认在栏上。 */
const initialPinned = (): string[] => {
  const saved = load<string[] | null>("workbench.apps.pinned", null);
  if (saved) return saved.filter((id) => typeof id === "string");
  const legacy = load<string[]>("workbench.extPanels", []);
  return ["sites", ...legacy.filter((id) => id !== "sites")];
};

/** 「让 AI 造一个应用」的开工指令:自包含的契约速查表(用户工作区里没有 APP.md,全都写进提示词)。 */
const buildAppPrompt = (desc: string) => `请在当前工作目录为我建一个 Workbench 应用:${desc.trim()}

Workbench 应用 = 工作区里的一个目录,建好即自动出现在「应用」面板(无需注册步骤):

apps/<id>/app.json   ← manifest,示例:
{ "id": "notebook", "name": "笔记本", "icon": "📔",
  "mounts": { "tab": "index.html" },          ← 可选 "panel": 另一个 html(侧栏紧凑视图)
  "capabilities": ["db"] }                     ← 按需声明:storage / db / tabs / ai / agent / fs:workspace / system

apps/<id>/index.html ← 自包含页面(iframe 沙箱,样式用 var(--color-bg/text/border/accent…) 自动随主题),
引入 SDK:<script src="/apps/workbench-sdk.js"></script>,await workbench.ready() 后可用:
- workbench.storage.get()/set(v)                     KV 小状态
- workbench.db.exec(sql, params)                     应用私有 SQLite,自由建表增删改查(推荐主力)
- workbench.tabs.open({url}) / openApp({route})      开网页 / 打开自己的标签页(带路由)
- workbench.ai.complete({summary, prompt, system?})  调 AI(summary 必填,活动里展示)
- workbench.agent.run({summary, message})            派活给智能体(能用工具,较重)
- workbench.fs.read/write/list({path, content?})     工作区文件(需 fs:workspace 能力)
- workbench.context() / on(event,fn) / emit(event)   实例信息 / 同应用实例间事件
- workbench.ui.toast(msg) / dialog.confirm(msg)      提示与确认

进阶(可选):应用可以有真后端 —— manifest 加 "server": "server.js",写 apps/<id>/server.js:
  import { WorkerEntrypoint } from "cloudflare:workers";
  export class Gadget extends WorkerEntrypoint {
    async myMethod(x) { return this.env.HOST.dbExec("SELECT ...", [x]); }  // 同一张应用私有库
  }
它跑在 workerd 沙箱里(物理断网,只有 env.HOST:dbExec/log);前端经 workbench.gadget.myMethod(x)
直连调用。逻辑重、要事务、要服务端校验时用它;纯 CRUD 用前端 db.exec 就够。

要求:先 write 出 app.json 和 index.html,界面简洁贴合 Workbench 风格(浅色变量兜底),
数据用 db 能力自建表;完成后告诉我应用名和怎么用。`;

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
  /** 在标签页打开应用(tab 挂载;去重聚焦与 route 推送在工作区层)。 */
  onOpenApp: (app: AppDef, route?: string) => void;
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
  // ── 应用注册状态:预装(可移除)+ 工作区(目录即安装)+ 钉住列表 ──
  const [removedPresets, setRemovedPresets] = useState<string[]>(() => load("workbench.apps.removedPresets", []));
  const [pinned, setPinned] = useState<string[]>(initialPinned);
  const [workspaceApps, setWorkspaceApps] = useState<AppDef[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.listWorkspaceApps()
      .then((apps) => { if (!cancelled) setWorkspaceApps(apps as AppDef[]); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  const apps: AppDef[] = [
    ...PRESET_APPS.filter((p) => !removedPresets.includes(p.id)),
    ...workspaceApps.filter((w) => !PRESET_APPS.some((p) => p.id === w.id)),
  ];
  const pinnedApps = pinned
    .map((id) => apps.find((a) => a.id === id))
    .filter((a): a is AppDef => !!a && !!a.mounts.panel);

  const [sideTab, setSideTab] = useState<string>(() => localStorage.getItem("workbench.sideTab") || "agents");
  const nativeIds = NATIVE_PANELS.map((p) => p.id as string);
  const activePanelId = nativeIds.includes(sideTab) || pinnedApps.some((a) => a.id === sideTab) ? sideTab : "agents";
  const switchTab = (tab: string) => {
    setSideTab(tab);
    localStorage.setItem("workbench.sideTab", tab);
  };

  const togglePin = (app: AppDef) => {
    setPinned((prev) => {
      const next = prev.includes(app.id) ? prev.filter((x) => x !== app.id) : [...prev, app.id];
      save("workbench.apps.pinned", next);
      return next;
    });
    if (sideTab === app.id) switchTab("apps");
  };
  const pinAndShow = (app: AppDef) => {
    setPinned((prev) => {
      if (prev.includes(app.id)) return prev;
      const next = [...prev, app.id];
      save("workbench.apps.pinned", next);
      return next;
    });
    switchTab(app.id);
  };
  const removePreset = (app: AppDef) => {
    setRemovedPresets((prev) => {
      const next = prev.includes(app.id) ? prev : [...prev, app.id];
      save("workbench.apps.removedPresets", next);
      return next;
    });
    setPinned((prev) => {
      const next = prev.filter((x) => x !== app.id);
      save("workbench.apps.pinned", next);
      return next;
    });
    if (sideTab === app.id) switchTab("apps");
  };

  // 让 AI 造一个应用:一句话 → 新对话 → agent 在工作区 apps/ 里写出目录 → 自动出现
  const createAppWithAI = async () => {
    const desc = await dialog.prompt("", {
      title: "让 AI 造一个应用",
      placeholder: "描述你要的应用,如:记账本,支持分类和月度统计",
      confirmText: "开工",
    });
    if (!desc || !desc.trim()) return;
    try {
      const r = await api.createAgent({ title: "", workdir: createParentId || undefined });
      onSelect(r.node);
      socket.send({ type: "send", agentId: r.node.id, prompt: buildAppPrompt(desc) });
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
  const tabTitles = [...NATIVE_PANELS.map((p) => p.title), ...pinnedApps.map((a) => a.name)];
  const needWidth = tabTitles.reduce((sum, t) => sum + TAB_CHROME + Math.ceil(labelWidth(t)), 0) + 36 + 8;
  const iconOnly = needWidth > sidebarWidth;

  // ── 宿主菜单:+ = 钉面板快捷入口;钉住的应用 tab 右键 = 取下 ──
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const openPinPicker = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const candidates = apps.filter((a) => a.mounts.panel && !pinned.includes(a.id));
    const items: MenuItem[] = candidates.map((a) => ({
      label: `钉上「${a.name}」`,
      icon: <span className="text-[13px] leading-none">{a.icon}</span>,
      onClick: () => pinAndShow(a),
    }));
    if (items.length) items.push("divider");
    items.push({ label: "在「应用」面板中管理…", icon: <Plus size={13} />, onClick: () => switchTab("apps") });
    setMenu({ x: r.left, y: r.bottom + 4, items });
  };
  const onPinnedTabContext = (e: React.MouseEvent, app: AppDef) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [{ label: `从侧栏取下「${app.name}」`, icon: <X size={13} />, onClick: () => togglePin(app) }],
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

  const tabClass = (active: boolean) => [
    "flex-1 min-w-0 flex items-center justify-center gap-1.5 h-9 px-1 text-[13px] transition-colors border-b-2 -mb-px",
    active ? "border-accent text-text font-medium" : "border-transparent text-text-dim hover:text-text hover:bg-bg-hover",
  ].join(" ");

  const activeApp = pinnedApps.find((a) => a.id === activePanelId) || null;

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
        {pinnedApps.map((a) => (
          <button
            key={a.id}
            onClick={() => switchTab(a.id)}
            onContextMenu={(e) => onPinnedTabContext(e, a)}
            title={`${a.name}(应用,右键可取下)`}
            className={tabClass(activePanelId === a.id)}
          >
            <span className="shrink-0 text-[13px] leading-none">{a.icon}</span>
            {!iconOnly && <span className="truncate">{a.name}</span>}
          </button>
        ))}
        <button
          onClick={openPinPicker}
          title="钉一个应用面板"
          className="self-center shrink-0 w-6 h-6 mx-1.5 rounded flex items-center justify-center text-text-faint hover:text-accent hover:bg-bg-hover transition-colors"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* ── 面板身体:会话切走即卸;文件常驻隐藏保重状态;应用 = iframe 沙箱 ── */}
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
      {activePanelId === "apps" && (
        <AppsPanel
          apps={apps}
          pinnedIds={pinned}
          onOpenTab={(app) => onOpenApp(app)}
          onTogglePin={togglePin}
          onRemovePreset={removePreset}
          onCreateWithAI={createAppWithAI}
        />
      )}
      {activeApp && (
        <AppFrame key={activeApp.id} app={activeApp} mount="panel" onOpenUrl={onOpenUrl} onOpenApp={onOpenApp} />
      )}

      {/* footer */}
      <div className="border-t border-border px-1.5 py-1.5 flex items-center gap-1">
        <button
          onClick={handleToggleActivity}
          title="活动:智能体与应用的调用"
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
