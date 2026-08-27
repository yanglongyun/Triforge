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
import { NATIVE_PANELS, type AppDef } from "./registry";
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

/** 「让 AI 造一个应用」的开工指令:自包含的契约速查表(用户工作区里没有 APP.md,全写进提示词)。 */
const buildAppPrompt = (desc: string) => `请在当前工作目录为我建一个 Workbench 应用:${desc.trim()}

Workbench 应用 = 工作区里的一个目录,**本身就是一个标准 Cloudflare Worker 网站**,建好即自动
出现在「应用」面板(没有注册步骤):

apps/<id>/
  app.json     manifest
  server.js    Worker:export default { async fetch(req, env) {…} }
  public/      静态资源(index.html 等)
  data.db      数据(自动生成,别手建)

app.json:
{ "id": "notebook", "name": "笔记本", "icon": "📔",
  "mounts": { "tab": "/" },              ← 可选加 "panel": "/panel.html"(侧栏窄视图)
  "capabilities": ["db"] }               ← db / ai / agent / tabs / system / fs:workspace

server.js —— 和真实 Cloudflare Worker 写法完全一致:
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/notes") {
      const { results } = await env.DB.prepare("SELECT * FROM notes ORDER BY id DESC").all();
      return Response.json(results);
    }
    return env.ASSETS.fetch(req);   // 其余交给 public/ 下的静态资源
  },
};

env 里有三样(都不用 import):
  env.DB      D1 接口,落在 apps/<id>/data.db:
              env.DB.prepare(sql).bind(a, b).all() / .first() / .run()
              env.DB.exec("CREATE TABLE IF NOT EXISTS …")   多语句建表脚本
              env.DB.batch([stmt, stmt])                    一个事务
  env.ASSETS  public/ 下的静态资源:return env.ASSETS.fetch(req)
  env.HOST    Workbench 专有能力:
              await env.HOST.ai({ summary, prompt, system })      调 AI(需 ai 能力,summary 必填)
              await env.HOST.agent({ summary, message })          派活给智能体(需 agent 能力)
              await env.HOST.log("…")                             日志回流到控制台,调试用

public/index.html —— 前端页面。它和自己的后端**同源**,直接 fetch("/api/notes") 即可,
不需要任何 SDK。样式用 var(--color-bg / --color-text / --color-border / --color-accent /
--color-bg-inset / --color-text-faint …) 自动随明暗主题(给浅色兜底值)。

只有要用宿主 UI 能力时才引 SDK:<script src="/_wb/sdk.js"></script>
  workbench.ui.toast(msg)                       轻提示
  workbench.dialog.confirm(msg)                 确认框
  workbench.tabs.open({ url })                  开网页标签(需 tabs 能力)
  workbench.system.copyText(text)               剪贴板(需 system 能力)
  workbench.context() / on("route", fn)         实例信息 / 侧栏与标签页实例间的路由与事件

要求:
1. 建表放在请求处理开头(CREATE TABLE IF NOT EXISTS),isolate 会重启,别依赖内存状态;
2. 界面简洁、贴合 Workbench 风格,别引外部 CDN(应用物理断网,只有这三个 binding 能碰外界);
3. 先 write 出 app.json / server.js / public/index.html,完成后告诉我应用名和怎么用。`;

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
  // ── 应用:全部来自工作区(<workspace>/apps/<id>/),目录即安装 ──
  const [pinned, setPinned] = useState<string[]>(initialPinned);
  const [apps, setApps] = useState<AppDef[]>([]);
  const reloadApps = () => api.listWorkspaceApps()
    .then((list) => setApps(list as AppDef[]))
    .catch(() => {});
  useEffect(() => { void reloadApps(); }, [refreshKey]);
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
  const removeApp = async (app: AppDef) => {
    if (!(await dialog.confirm(`删除应用「${app.name}」?\n它的目录 apps/${app.id}/(含数据 data.db)会一并删除。`, { danger: true, confirmText: "删除" }))) return;
    try { await api.removeApp(app.id); } catch (e: any) { void dialog.alert(e?.message || "删除失败"); return; }
    void reloadApps();
    onChanged?.();
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
          onRemoveApp={removeApp}
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
