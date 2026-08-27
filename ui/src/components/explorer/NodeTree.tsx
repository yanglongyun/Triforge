import { useCallback, useEffect, useRef, useState } from "react";
import type { GitRepositoryStatus, Node } from "../../api";
import { api } from "../../api";
import { NodeRow, InlineCreateRow, iconFor, colorFor, type TreeControls } from "./NodeRow";
import { AgentRail } from "./AgentRail";
import { PanelFrame } from "../panels/PanelFrame";
import { ContextMenu, dialog, type MenuItem } from "../ui";
import { Settings, Folder, FolderPlus, FolderOpen, FileText, FilePlus, Bot, Trash2, Pencil, Plus, X, Copy, PanelRight, Terminal, GitBranch, Radio, Menu, MessageSquare, Files, Globe, ListTodo, Sparkles, Scissors, ClipboardPaste, FoldVertical } from "lucide-react";

const REVEAL_LABEL = /Mac/i.test(navigator.platform) ? "在 Finder 中显示"
  : /Win/i.test(navigator.platform) ? "在资源管理器中显示" : "在文件管理器中显示";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import { useTreeDnd, ROOT_ID } from "./useTreeDnd";
import { AddWorkspaceDialog } from "./AddWorkspaceDialog";

// ── 面板注册表:侧边栏 = 可扩展的面板宿主(见 PANEL.md)──
// 双轨制:会话/文件是原生 React(深度集成:拖拽/多选/快捷键);
// 「网站」是预置的 iframe 面板示例;从 + 安装的扩展面板一律 iframe 沙箱。
type PanelDef = { id: string; title: string; icon: typeof MessageSquare; ext?: boolean };
const BUILTIN_PANELS: PanelDef[] = [
  { id: "agents", title: "会话", icon: MessageSquare },
  { id: "files", title: "文件", icon: Files },
  { id: "sites", title: "网站", icon: Globe }, // 预置,但载体是 iframe —— 面板契约的白老鼠
];
const EXT_PANELS: Record<string, PanelDef> = {
  todo: { id: "todo", title: "任务", icon: ListTodo, ext: true },
};

export function NodeTree({
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
  socket: { send: (m: any) => void; on: (t: string, fn: (p: any) => void) => () => void };
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
  const [roots, setRoots] = useState<Node[]>([]);
  // ── 面板宿主状态:已安装的扩展面板 + 当前面板,均跨启动记住 ──
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
  // 文件夹右键「在此新建对话」→ 切到会话面板并带上预设 workdir
  const [agentCreateReq, setAgentCreateReq] = useState<{ workdir?: string } | null>(null);

  // ── 面板 tab 行的响应式:放不下「图标+文字」就整行退化为纯图标(悬停有 title)──
  // 侧栏宽度可拖(220–420),所以不按面板数量,按实测文字宽度判断;拖宽自动恢复文字。
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
  // 文件夹徽标:workdir → 绑定的智能体数
  const [agentDirs, setAgentDirs] = useState<Map<string, number>>(new Map());
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("workbench.sidebarWidth") || "");
    return Number.isFinite(saved) && saved >= 220 && saved <= 420 ? saved : 260;
  });
  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
  const [workspacePathDraft, setWorkspacePathDraft] = useState("");
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [addingWorkspace, setAddingWorkspace] = useState(false);
  const [pickingWorkspace, setPickingWorkspace] = useState(false);
  const autoExpandedWorkspaces = useRef<Set<string>>(new Set());

  // 展开集
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setExpanded = (id: string, on: boolean) =>
    setExpandedIds((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });

  // ── 多选(VS Code 资源管理器同款):Cmd/Ctrl 点选切换,Shift 范围选 ──
  const [multiSel, setMultiSel] = useState<Set<string>>(new Set());
  const multiSelRef = useRef(multiSel);
  multiSelRef.current = multiSel;
  const anchorRef = useRef<string | null>(null);
  const clearMulti = useCallback(() => { if (multiSelRef.current.size) setMultiSel(new Set()); }, []);
  /** 树的可见顺序 = DOM 顺序(data-nid 只有文件树的行在用)。 */
  const visibleTreeIds = () =>
    Array.from(document.querySelectorAll("[data-nid]")).map((el) => String(el.getAttribute("data-nid") || ""));
  /** 剔除「祖先也被选中」的行:id 就是绝对路径,前缀判断即可。 */
  const pruneNested = (ids: string[]) =>
    ids.filter((id) => !ids.some((other) => other !== id && id.startsWith(other + "/")));

  const handleRowClick = (e: React.MouseEvent, node: Node) => {
    if (e.metaKey || e.ctrlKey) {
      // 点选切换;从单选进入多选时把当前选中项一并带上
      setMultiSel((prev) => {
        const next = new Set(prev.size ? prev : selectedId ? [selectedId] : []);
        next.has(node.id) ? next.delete(node.id) : next.add(node.id);
        return next;
      });
      anchorRef.current = node.id;
      return;
    }
    if (e.shiftKey) {
      const order = visibleTreeIds();
      const from = anchorRef.current && order.includes(anchorRef.current)
        ? anchorRef.current
        : order.includes(selectedId) ? selectedId : node.id;
      const a = order.indexOf(from);
      const b = order.indexOf(node.id);
      if (a !== -1 && b !== -1) {
        setMultiSel(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)));
        return;
      }
    }
    // 普通点击:回到单选,文件夹顺带展开/收起
    anchorRef.current = node.id;
    clearMulti();
    handleSelect(node);
    if (node.kind === "space") toggleExpand(node.id);
  };

  useEffect(() => { clearMulti(); }, [sideTab, clearMulti]);


  // 创建
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<"space" | "file">("space");
  const [draftTitle, setDraftTitle] = useState("");

  // 重命名
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  // 菜单
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const load = useCallback(async () => {
    const result = await api.listRoots();
    setRoots(result.nodes || []);
  }, []);

  // 变更后:既刷新根,又冒泡到 App 让 refreshKey 自增 → 所有展开的子节点立即重载
  const refresh = useCallback(() => { load(); onChanged?.(); }, [load, onChanged]);

  // 拖拽:状态 + 落库都在 hook 里(多选时拖任一选中项 = 整组搬)
  const { sensors, activeNode, overDirId, dndHandlers } = useTreeDnd({
    refresh,
    setExpanded,
    getSelection: () => [...multiSelRef.current],
  });

  // ── 键盘与剪贴板(资源管理器快捷键)──
  // 行注册表:渲染时把 Node 对象按 id 登记,键盘操作按 anchor 查对象
  const nodesRef = useRef(new Map<string, Node>());
  const registerNode = useCallback((n: Node) => { nodesRef.current.set(n.id, n); }, []);
  /** 内部文件剪贴板:复制(可反复粘贴)/ 剪切(粘贴即移动,行半透明标记)。 */
  const clipboardRef = useRef<{ ids: string[]; cut: boolean } | null>(null);
  const [cutIds, setCutIds] = useState<Set<string>>(new Set());
  const rootsRef = useRef(roots); rootsRef.current = roots;
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const expandedRef = useRef(expandedIds); expandedRef.current = expandedIds;
  const sideTabRef = useRef(sideTab); sideTabRef.current = sideTab;

  /** 删除一组 id(菜单与 Delete 键共用):祖先已选剔除后代;工作区走移除。 */
  const deleteIds = useCallback(async (rawIds: string[]) => {
    const ids = pruneNested(rawIds.filter(Boolean));
    if (!ids.length) return;
    const workspaces = ids.filter((id) => rootsRef.current.some((r) => r.id === id && r.workspace));
    const normal = ids.filter((id) => !workspaces.includes(id));
    const hint = workspaces.length ? `\n其中 ${workspaces.length} 个是工作区:只从 Workbench 移除,不删磁盘文件。` : "";
    const label = rawIds.length === 1
      ? `「${nodesRef.current.get(rawIds[0])?.title || rawIds[0].split("/").pop()}」`
      : `选中的 ${rawIds.length} 项`;
    if (!(await dialog.confirm(`删除${label}?文件夹内的内容会一起删除。${hint}`, { danger: true, confirmText: "删除" }))) return;
    for (const id of workspaces) await api.removeWorkspace(id).catch(() => {});
    for (const id of normal) await api.deleteNode(id).catch(() => {});
    if (rawIds.includes(selectedIdRef.current)) onSelect(null);
    clearMulti();
    refresh();
  }, [clearMulti, onSelect, refresh]);

  /** 复制/剪切当前选择进内部剪贴板(工作区根除外)。 */
  const copySelection = useCallback((cut: boolean) => {
    const ids = multiSelRef.current.size ? [...multiSelRef.current] : anchorRef.current ? [anchorRef.current] : [];
    const usable = ids.filter((id) => !rootsRef.current.some((r) => r.id === id && r.workspace));
    if (!usable.length) return;
    clipboardRef.current = { ids: usable, cut };
    setCutIds(cut ? new Set(usable) : new Set());
  }, []);

  /** 粘贴到 anchor 所在目录(anchor 是文件夹 → 进它;是文件 → 进它的父级)。 */
  const pasteClipboard = useCallback(async () => {
    const clip = clipboardRef.current;
    if (!clip?.ids.length) return;
    const anchorNode = anchorRef.current ? nodesRef.current.get(anchorRef.current) : null;
    const targetDir = anchorNode
      ? anchorNode.kind === "space" ? anchorNode.id : (anchorNode.parent_id || rootsRef.current[0]?.id)
      : rootsRef.current[0]?.id;
    if (!targetDir) return;
    const ids = pruneNested(clip.ids).filter((id) => !(targetDir === id || targetDir.startsWith(id + "/")));
    for (const id of ids) {
      if (clip.cut) {
        try { await api.moveNode(id, targetDir); }
        catch (e: any) {
          if (/已有同名/.test(e?.message || "") && (await dialog.confirm(`${e.message}。覆盖吗?(被覆盖的会进废纸篓)`, { danger: true, confirmText: "覆盖" }))) {
            await api.moveNode(id, targetDir, undefined, true).catch((err: any) => void dialog.alert(err?.message || "移动失败"));
          } else if (!/已有同名/.test(e?.message || "")) void dialog.alert(e?.message || "移动失败");
        }
      } else {
        await api.copyNode(id, targetDir).catch((e: any) => void dialog.alert(e.message || "复制失败"));
      }
    }
    if (clip.cut) { clipboardRef.current = null; setCutIds(new Set()); }
    setExpanded(targetDir, true);
    refresh();
  }, [refresh, setExpanded]);

  // ── 外部拖入导入(从 Finder 拖文件/文件夹进树)──
  // webkitGetAsEntry 递归展开目录;内容经 FileReader 读出走 /api/tree/import 落盘。
  const traverseEntry = async (entry: any, prefix: string, out: { file: File; rel: string }[]) => {
    if (!entry || out.length >= 200) return;
    if (entry.isFile) {
      await new Promise<void>((done) => entry.file((f: File) => { out.push({ file: f, rel: prefix + f.name }); done(); }, () => done()));
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries 按批返回(每批至多 100),读空为止
      for (;;) {
        const batch: any[] = await new Promise((done) => reader.readEntries((es: any[]) => done(es), () => done([])));
        if (!batch.length) break;
        for (const child of batch) await traverseEntry(child, `${prefix}${entry.name}/`, out);
        if (out.length >= 200) break;
      }
    }
  };

  const onExternalDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); // 允许 drop
  };
  const onExternalDrop = async (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    // 落点:悬停行是文件夹 → 进它;是文件 → 进它的父级;空白处 → 第一个工作区
    const rowEl = (e.target as HTMLElement).closest?.("[data-nid]");
    const node = rowEl ? nodesRef.current.get(String(rowEl.getAttribute("data-nid"))) : null;
    const parentId = node ? (node.kind === "space" ? node.id : node.parent_id || undefined) : rootsRef.current[0]?.id;
    const out: { file: File; rel: string }[] = [];
    for (const item of [...(e.dataTransfer.items || [])]) {
      const entry = (item as any).webkitGetAsEntry?.();
      if (entry) await traverseEntry(entry, "", out);
      else { const f = item.getAsFile?.(); if (f) out.push({ file: f, rel: f.name }); }
    }
    if (!out.length) return;
    let done = 0, failed = 0, bytes = 0;
    for (const { file, rel } of out.slice(0, 200)) {
      if (file.size > 20 * 1024 * 1024 || (bytes += file.size) > 100 * 1024 * 1024) { failed += 1; continue; }
      try {
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onerror = () => reject(r.error);
          r.onload = () => resolve(String(r.result).split(",")[1] || "");
          r.readAsDataURL(file);
        });
        await api.importFile({ parentId, relPath: rel, dataBase64 });
        done += 1;
      } catch { failed += 1; }
    }
    if (parentId) setExpanded(parentId, true);
    refresh();
    if (failed) void dialog.alert(`导入完成:${done} 个成功,${failed} 个失败或超限(单文件 ≤20MB,单次 ≤200 个 / 100MB)`);
  };

  // ── Git 状态标记:文件按状态染色,脏目录点标 ──
  const [gitMarks, setGitMarks] = useState<{ files: Map<string, string>; dirs: Set<string> }>({ files: new Map(), dirs: new Set() });
  useEffect(() => {
    if (sideTab !== "files") return;
    let stale = false;
    api.gitStatus().then((r) => {
      if (stale) return;
      const files = new Map<string, string>();
      const dirs = new Set<string>();
      // git 会 C-quote 带空格/非 ASCII 的路径("sub/d copy.txt"),先反引号
      const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1).replace(/\\(.)/g, "$1") : p);
      const mark = (abs: string, status: string) => {
        // git 解析 symlink 后是 /private/tmp,树节点可能是 /tmp —— 两种键都登记
        for (const key of new Set([abs, abs.replace(/^\/private\/(tmp|var)\//, "/$1/")])) {
          files.set(key, status);
          let dir = key;
          while (dir.includes("/") && dir.length > 2) {
            dir = dir.slice(0, dir.lastIndexOf("/"));
            if (!dir) break;
            dirs.add(dir);
          }
        }
      };
      for (const repository of r.repositories || []) {
        const base = repository.root || repository.workspacePath;
        for (const f of repository.files || []) mark(`${base}/${unquote(f.path)}`, f.status);
      }
      setGitMarks({ files, dirs });
    }).catch(() => {});
    return () => { stale = true; };
  }, [refreshKey, sideTab]);

  // ── 文件名筛选(输入即筛,基于全量节点清单的扁平结果)──
  const [filterQ, setFilterQ] = useState("");
  const [allNodes, setAllNodes] = useState<Node[]>([]);
  useEffect(() => {
    if (!filterQ.trim()) return;
    api.listAllNodes().then((r) => setAllNodes(r.nodes || [])).catch(() => {});
  }, [!!filterQ.trim(), refreshKey]);
  const filterMatches = filterQ.trim()
    ? allNodes.filter((n) => n.title.toLowerCase().includes(filterQ.trim().toLowerCase())).slice(0, 100)
    : [];

  // 每渲染刷新一次的「最新函数」出口,键盘 handler 通过它调用,不吃过期闭包
  const keyApiRef = useRef({ handleSelect: (_n: Node | null) => {}, startRename: (_n: Node) => {}, toggleExpand: (_id: string) => {}, setExpanded: (_id: string, _on: boolean) => {} });

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || !!el.isContentEditable;
    };
    const focusRow = (id: string) => {
      anchorRef.current = id;
      setMultiSel(new Set([id]));
      document.querySelector(`[data-nid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { clearMulti(); return; }
      if (sideTabRef.current !== "files" || isTyping(e.target)) return;
      const anchor = anchorRef.current;
      const engaged = !!anchor || multiSelRef.current.size > 0;
      if (!engaged) return; // 没点过树,不抢任何键
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key;

      // 删除:Delete 或 Cmd/Ctrl+Backspace(VS Code mac 同款)
      if (key === "Delete" || (key === "Backspace" && meta)) {
        e.preventDefault();
        void deleteIds(multiSelRef.current.size ? [...multiSelRef.current] : anchor ? [anchor] : []);
        return;
      }
      if (meta && key.toLowerCase() === "a") {
        e.preventDefault();
        setMultiSel(new Set(visibleTreeIds()));
        return;
      }
      // 复制/剪切/粘贴:页面上有文字选区时让位给系统复制
      if (meta && key.toLowerCase() === "c" && !String(window.getSelection() || "")) { copySelection(false); return; }
      if (meta && key.toLowerCase() === "x" && !String(window.getSelection() || "")) { copySelection(true); return; }
      if (meta && key.toLowerCase() === "v" && clipboardRef.current) { void pasteClipboard(); return; }

      // Enter / F2:进入重命名(VS Code mac 习惯;文件、文件夹、工作区根都适用)
      if ((key === "F2" || key === "Enter") && anchor && !meta) {
        const node = nodesRef.current.get(anchor);
        if (!node) return;
        e.preventDefault();
        keyApiRef.current.startRename(node);
        return;
      }
      // ⌘↓:打开(文件开标签,文件夹展开/收起)—— 打开的键位让给它,Enter 归重命名
      if (meta && key === "ArrowDown" && anchor) {
        const node = nodesRef.current.get(anchor);
        if (!node) return;
        e.preventDefault();
        if (node.kind === "space") keyApiRef.current.toggleExpand(node.id);
        else keyApiRef.current.handleSelect(node);
        return;
      }

      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(key)) {
        if (meta) return; // 带 ⌘ 的方向键不参与焦点移动
        e.preventDefault();
        const order = visibleTreeIds();
        if (!order.length) return;
        const cur = anchor ? order.indexOf(anchor) : -1;
        if (key === "ArrowDown" || key === "ArrowUp") {
          const nextIdx = cur === -1
            ? (key === "ArrowDown" ? 0 : order.length - 1)
            : Math.max(0, Math.min(order.length - 1, cur + (key === "ArrowDown" ? 1 : -1)));
          const id = order[nextIdx];
          if (e.shiftKey) {
            setMultiSel((prev) => { const n = new Set(prev.size ? prev : anchor ? [anchor] : []); n.add(id); return n; });
            anchorRef.current = id;
            document.querySelector(`[data-nid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
          } else focusRow(id);
          return;
        }
        if (!anchor) return;
        const node = nodesRef.current.get(anchor);
        if (key === "ArrowRight") {
          if (node?.kind === "space" && !expandedRef.current.has(anchor)) keyApiRef.current.setExpanded(anchor, true);
          else if (cur >= 0 && cur < order.length - 1) focusRow(order[cur + 1]);
          return;
        }
        // ArrowLeft:展开的文件夹先收起;否则跳到父级
        if (node?.kind === "space" && expandedRef.current.has(anchor)) { keyApiRef.current.setExpanded(anchor, false); return; }
        const parent = anchor.slice(0, anchor.lastIndexOf("/"));
        if (order.includes(parent)) focusRow(parent);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearMulti, copySelection, deleteIds, pasteClipboard]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // 文件夹徽标数据(会话 tab 有自己的列表,这里只为树上的角标)
  useEffect(() => {
    api.listAgents().then((r) => {
      const map = new Map<string, number>();
      for (const a of r.agents) {
        if (!a.workdir) continue;
        map.set(a.workdir, (map.get(a.workdir) || 0) + 1);
      }
      setAgentDirs(map);
    }).catch(() => {});
  }, [refreshKey]);

  // 聊天面板的工作目录芯片 → 跳到文件 tab 并展开定位那个目录
  useEffect(() => {
    const onReveal = (e: Event) => {
      const abs = String((e as CustomEvent).detail?.path || "");
      if (!abs) return;
      switchTab("files");
      const root = roots.map((r) => r.id).filter((r) => abs === r || abs.startsWith(r + "/")).sort((a, b) => b.length - a.length)[0];
      if (!root) return;
      // 展开根到目标的每一级
      setExpandedIds((current) => {
        const next = new Set(current);
        let cursor = root;
        next.add(root);
        const rest = abs.slice(root.length).split("/").filter(Boolean);
        for (const seg of rest) { cursor = `${cursor}/${seg}`; next.add(cursor); }
        return next;
      });
      // 各级子行是懒加载的,轮询等目标行出现再滚过去
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        const el = document.querySelector(`[data-nid="${CSS.escape(abs)}"]`);
        if (el) { el.scrollIntoView({ block: "center" }); clearInterval(timer); }
        else if (tries > 12) clearInterval(timer);
      }, 120);
    };
    window.addEventListener("workbench:reveal-path", onReveal);
    return () => window.removeEventListener("workbench:reveal-path", onReveal);
  }, [roots]);

  useEffect(() => {
    const nextIds = roots.filter((root) => root.workspace && !autoExpandedWorkspaces.current.has(root.id)).map((root) => root.id);
    if (!nextIds.length) return;
    nextIds.forEach((id) => autoExpandedWorkspaces.current.add(id));
    setExpandedIds((current) => {
      const next = new Set(current);
      nextIds.forEach((id) => next.add(id));
      return next;
    });
  }, [roots]);

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
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(220, Math.min(420, startWidth + ev.clientX - startX));
      currentWidth = next;
      setSidebarWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      localStorage.setItem("workbench.sidebarWidth", String(Math.round(currentWidth)));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── 创建 ──
  const startCreate = (parentId: string | null, kind: "space" | "file") => {
    setCreatingUnder(parentId === null ? "" : parentId);
    setCreatingKind(kind);
    setDraftTitle("");
    if (parentId) setExpanded(parentId, true);
  };
  const currentCreateParentId = () => createParentId || roots[0]?.id || null;
  const commitCreate = async () => {
    const title = draftTitle.trim();
    if (creatingUnder === null) return;
    if (!title) { setCreatingUnder(null); setDraftTitle(""); return; }
    const parentId = creatingUnder === "" ? undefined : creatingUnder;
    const result = await api.createNode({ kind: creatingKind, title, parentId });
    setCreatingUnder(null);
    setDraftTitle("");
    handleSelect(result.node);
    refresh();
  };
  const cancelCreate = () => { setCreatingUnder(null); setDraftTitle(""); };

  const openAddWorkspace = () => {
    setWorkspacePathDraft("");
    setWorkspaceError(null);
    setAddWorkspaceOpen(true);
  };
  useEffect(() => {
    const open = () => openAddWorkspace();
    window.addEventListener("workbench:add-workspace", open);
    return () => window.removeEventListener("workbench:add-workspace", open);
  }, []);

  const addWorkspace = async () => {
    const workspacePath = workspacePathDraft.trim();
    if (!workspacePath) return;
    setAddingWorkspace(true);
    setWorkspaceError(null);
    try {
      const result = await api.addWorkspace({ path: workspacePath });
      setExpanded(result.node.id, true);
      handleSelect(result.node);
      setAddWorkspaceOpen(false);
      setWorkspacePathDraft("");
      refresh();
    } catch (e: any) {
      setWorkspaceError(e.message || "添加工作区失败");
    } finally {
      setAddingWorkspace(false);
    }
  };

  const pickWorkspace = async () => {
    setPickingWorkspace(true);
    setWorkspaceError(null);
    try {
      const result = await api.pickWorkspaceDirectory();
      if (result.path) setWorkspacePathDraft(result.path);
    } catch (e: any) {
      setWorkspaceError(e.message || "选择目录失败");
    } finally {
      setPickingWorkspace(false);
    }
  };

  // ── 重命名 ──
  const startRename = (n: Node) => { setRenamingId(n.id); setRenameDraft(n.title); };
  const commitRename = async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!id || !title) return;
    try {
      await api.updateNode(id, { title });
    } catch (e: any) {
      // 重名:确认后覆盖(旧的进废纸篓),否则放弃
      if (/已有同名/.test(e?.message || "") && (await dialog.confirm(`${e.message}。覆盖吗?(被覆盖的会进废纸篓)`, { danger: true, confirmText: "覆盖" }))) {
        await api.updateNode(id, { title, overwrite: true }).catch((err: any) => void dialog.alert(err?.message || "重命名失败"));
      } else if (!/已有同名/.test(e?.message || "")) {
        void dialog.alert(e?.message || "重命名失败");
      }
    }
    refresh();
  };
  const cancelRename = () => { setRenamingId(null); setRenameDraft(""); };

  // ── 右键 ──
  const onNodeContext = async (e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    e.stopPropagation();

    // 多选状态下:在选中项上右键 → 批量菜单;在选区外右键 → 退回单选(VS Code 行为)
    if (multiSel.size > 1) {
      if (multiSel.has(node.id)) {
        const count = multiSel.size;
        setMenu({
          x: e.clientX, y: e.clientY,
          items: [
            { label: `复制(${count} 项)`, icon: <Copy size={13} />, onClick: () => copySelection(false) },
            { label: `剪切(${count} 项)`, icon: <Scissors size={13} />, onClick: () => copySelection(true) },
            { label: `复制路径(${count} 项)`, icon: <Copy size={13} />,
              onClick: async () => {
                const text = [...multiSel].map((id) => id.replace(/^.*\/workspaces\//, "")).join("\n");
                try { await navigator.clipboard.writeText(text); } catch { /* 剪贴板不可用就算了 */ }
              } },
            "divider",
            { label: `删除选中的 ${count} 项`, icon: <Trash2 size={13} />, danger: true,
              onClick: () => { void deleteIds([...multiSel]); } },
          ],
        });
        return;
      }
      clearMulti(); // 选区外右键:清多选,走单项菜单
    }
    anchorRef.current = node.id; // 右键即聚焦:粘贴/键盘操作以它为落点

    const items: MenuItem[] = [];
    let gitRepo: GitRepositoryStatus | null = null;
    if (node.kind === "space" && onOpenGit) {
      try {
        gitRepo = (await api.gitRepository(node.id)).repository;
      } catch {
        gitRepo = null;
      }
    }
    if (node.kind === "space") {
      items.push(
        { label: "在此新建对话", icon: <Bot size={13} className="text-warning" />,
          onClick: () => { switchTab("agents"); setAgentCreateReq({ workdir: node.id }); } },
        "divider",
        { label: "新建文件夹", icon: <Folder size={13} className="text-accent" />,
          onClick: () => startCreate(node.id, "space") },
        { label: "新建文件", icon: <FileText size={13} className="text-text-faint" />,
          onClick: () => startCreate(node.id, "file") },
        "divider",
      );
    }
    const copyText = node.id.replace(/^.*\/workspaces\//, "");
    if (node.kind !== "space" && onOpenSide) {
      items.push(
        { label: "打开到侧边", icon: <PanelRight size={13} />, onClick: () => onOpenSide(node) },
        "divider",
      );
    }
    if (!node.workspace) {
      items.push(
        { label: "复制", icon: <Copy size={13} />,
          onClick: () => { clipboardRef.current = { ids: [node.id], cut: false }; setCutIds(new Set()); } },
        { label: "剪切", icon: <Scissors size={13} />,
          onClick: () => { clipboardRef.current = { ids: [node.id], cut: true }; setCutIds(new Set([node.id])); } },
      );
    }
    if (clipboardRef.current?.ids.length) {
      items.push({
        label: `粘贴(${clipboardRef.current.ids.length} 项)`, icon: <ClipboardPaste size={13} />,
        onClick: () => { void pasteClipboard(); },
      });
    }
    items.push(
      { label: "重命名", icon: <Pencil size={13} />, onClick: () => startRename(node) },
      { label: "复制路径", icon: <Copy size={13} />,
        onClick: async () => {
          try { await navigator.clipboard.writeText(copyText); }
          catch {
            const ta = document.createElement("textarea");
            ta.value = copyText; document.body.appendChild(ta);
            ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
          }
        },
      },
      { label: REVEAL_LABEL, icon: <FolderOpen size={13} />, onClick: () => { api.revealNode(node.id).catch(() => {}); } },
      "divider",
      { label: "打开终端", icon: <Terminal size={13} className="text-success" />,
        onClick: () => onOpenTerminal?.(node), disabled: !onOpenTerminal },
      { label: "启动 Codex", icon: <Terminal size={13} className="text-success" />,
        onClick: () => onOpenTerminal?.(node, { command: "codex", titlePrefix: "Codex" }), disabled: !onOpenTerminal },
      { label: "启动 Claude Code", icon: <Terminal size={13} className="text-success" />,
        onClick: () => onOpenTerminal?.(node, { command: "claude", titlePrefix: "Claude Code" }), disabled: !onOpenTerminal },
      "divider",
    );
    if (gitRepo?.root) {
      items.push(
        {
          label: `Git 变更 (${gitRepo.files.length})`,
          icon: <GitBranch size={13} className="text-accent" />,
          onClick: () => onOpenGit?.(gitRepo!),
        },
        "divider",
      );
    }
    items.push(
      { label: node.workspace ? "移除工作区" : "删除", icon: <Trash2 size={13} />, danger: true,
        onClick: async () => {
          if (node.workspace) {
            if (!(await dialog.confirm(`从 Workbench 移除工作区「${node.title}」?\n不会删除磁盘文件。`, { danger: true, confirmText: "移除" }))) return;
            await api.removeWorkspace(node.id);
          } else {
            if (!(await dialog.confirm(`删除「${node.title}」?${node.kind === "space" ? "\n里面所有内容也会一起删除。" : ""}`, { danger: true, confirmText: "删除" }))) return;
            await api.deleteNode(node.id);
          }
          if (selectedId === node.id) onSelect(null);
          refresh();
        },
      },
    );
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const onBlankContext = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "添加工作区", icon: <FolderPlus size={13} className="text-accent" />, onClick: openAddWorkspace },
      ],
    });
  };

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

  // 「添加面板」:面板库。运行时装进来的面板一律 iframe 沙箱(见 PANEL.md);
  // 创建对话/文件/网站等操作不在这里 —— 归各面板内部。
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

  // 扩展面板 tab 右键:移除(内置面板不可移除,无菜单)
  const onPanelTabContext = (e: React.MouseEvent, p: PanelDef) => {
    if (!p.ext) return;
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [{ label: `移除「${p.title}」面板`, icon: <X size={13} />, danger: true, onClick: () => removePanel(p.id) }],
    });
  };

  // 键盘 handler 的最新函数出口(handler 只挂一次,经 ref 调最新实现)
  keyApiRef.current = { handleSelect, startRename, toggleExpand, setExpanded };

  const controls: TreeControls = {
    expandedIds, toggleExpand, setExpanded,
    creatingUnder, creatingKind, draftTitle, setDraftTitle, commitCreate, cancelCreate,
    renamingId, renameDraft, setRenameDraft, commitRename, cancelRename,
    activeId: activeNode?.id || null, overDirId,
    agentDirs,
    multiSelectedIds: multiSel,
    cutIds,
    registerNode,
    gitMarks,
  };
  return (
    <DndContext sensors={sensors} {...dndHandlers}>
      <aside
        style={{ width: `min(${sidebarWidth}px, calc(100vw - 32px))` }}
        className={[
          "flex-col border-r border-border bg-bg-raised shrink-0",
          "absolute inset-y-0 left-0 z-40 shadow-2xl shadow-black/10",
          "md:relative md:shadow-none",
          // 移动端:关闭时直接 hidden;桌面端由左上角汉堡切换
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

        {activePanelId === "agents" ? (
          <AgentRail
            selectedId={selectedId}
            onSelect={handleSelect}
            refreshKey={refreshKey}
            socket={socket}
            createReq={agentCreateReq}
            onCreateHandled={() => setAgentCreateReq(null)}
          />
        ) : activePanelId !== "files" ? (
          // 预置示例「网站」+ 所有安装的扩展面板:iframe 沙箱,一切往来走宿主桥
          <PanelFrame key={activePanelId} panelId={activePanelId} onOpenUrl={onOpenUrl} />
        ) : (
        <>
        {/* 筛选 + 折叠全部 */}
        <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border">
          <input
            value={filterQ}
            onChange={(e) => setFilterQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setFilterQ(""); (e.target as HTMLInputElement).blur(); } }}
            placeholder="筛选文件名…"
            spellCheck={false}
            className="flex-1 min-w-0 h-6 px-2 rounded bg-bg-inset text-[12px] text-text placeholder:text-text-faint outline-none focus:ring-1 ring-accent/40"
          />
          {filterQ && (
            <button onClick={() => setFilterQ("")} title="清除筛选"
              className="w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover">
              <X size={12} />
            </button>
          )}
          {/* 面板内部的创建入口(顶部 + 已让位给「添加面板」) */}
          <button
            onClick={() => startCreate(currentCreateParentId(), "file")}
            title="新建文件"
            className="w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover"
          >
            <FilePlus size={13} />
          </button>
          <button
            onClick={() => startCreate(currentCreateParentId(), "space")}
            title="新建文件夹"
            className="w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover"
          >
            <FolderPlus size={13} />
          </button>
          <button
            onClick={() => setExpandedIds(new Set())}
            title="折叠全部"
            className="w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover"
          >
            <FoldVertical size={13} />
          </button>
        </div>

        {filterQ.trim() ? (
          <div className="flex-1 overflow-y-auto py-1">
            {filterMatches.map((node) => (
              <div
                key={node.id}
                onClick={() => {
                  if (node.kind === "space") {
                    setFilterQ("");
                    window.dispatchEvent(new CustomEvent("workbench:reveal-path", { detail: { path: node.id } }));
                  } else handleSelect(node);
                }}
                className="flex items-center gap-1.5 py-[3px] px-2 cursor-pointer select-none hover:bg-bg-hover"
                title={node.id}
              >
                {(() => { const Icon = iconFor(node.kind, node.title); return <Icon size={14} className={`shrink-0 ${colorFor(node.kind)}`} />; })()}
                <span className="shrink-0 truncate max-w-[55%] text-[13.5px] text-text">{node.title}</span>
                <span className="flex-1 min-w-0 truncate text-[11px] text-text-faint font-mono">{node.id.replace(/^.*\/workspaces\//, "").replace(/\/[^/]*$/, "")}</span>
              </div>
            ))}
            {!filterMatches.length && <div className="px-3 py-6 text-center text-[12.5px] text-text-faint">没有匹配的文件</div>}
          </div>
        ) : (
        <RootDroppable onContextMenu={onBlankContext} onNativeDragOver={onExternalDragOver} onNativeDrop={onExternalDrop}>
          {creatingUnder === "" && <InlineCreateRow depth={0} controls={controls} />}

          {roots.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              selectedId={selectedId}
              onRowClick={handleRowClick}
              onContextMenu={onNodeContext}
              refreshKey={refreshKey}
              controls={controls}
            />
          ))}

          {roots.length === 0 && creatingUnder !== "" && (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <div className="text-3xl opacity-80">🌱</div>
              <div className="text-[13px] text-text-faint leading-relaxed">
                还空着。<br />新建一个文件夹开始生长。
              </div>
              <button
                onClick={() => startCreate(null, "space")}
                className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
              >
                <Folder size={13} /> 新建文件夹
              </button>
            </div>
          )}
        </RootDroppable>
        )}
        </>
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
        {addWorkspaceOpen && (
          <AddWorkspaceDialog
            value={workspacePathDraft}
            error={workspaceError}
            submitting={addingWorkspace}
            picking={pickingWorkspace}
            onChange={(value) => { setWorkspacePathDraft(value); setWorkspaceError(null); }}
            onPick={pickWorkspace}
            onSubmit={addWorkspace}
            onClose={() => { if (!addingWorkspace && !pickingWorkspace) setAddWorkspaceOpen(false); }}
          />
        )}
        <div
          onPointerDown={startResize}
          className="hidden md:block absolute top-0 right-[-3px] z-20 h-full w-1.5 cursor-col-resize hover:bg-accent/25"
          title="调整侧边栏宽度"
        />
      </aside>

      {/* 拖动跟随物:小而不挡视野 —— 单个 = 图标牌,多选 = 第一层数量徽标 */}
      <DragOverlay dropAnimation={null}>
        {activeNode ? (
          <DragPreview
            node={activeNode}
            count={multiSel.has(activeNode.id) ? pruneNested([...multiSel]).length : 1}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function RootDroppable({
  children,
  onContextMenu,
  onNativeDragOver,
  onNativeDrop,
}: {
  children: React.ReactNode;
  onContextMenu: (e: React.MouseEvent) => void;
  /** 外部文件拖入(Finder → 树):dnd-kit 是指针拖拽,与原生 drag 事件不冲突。 */
  onNativeDragOver?: (e: React.DragEvent) => void;
  onNativeDrop?: (e: React.DragEvent) => void;
}) {
  // 仍注册 droppable:空白区是合法的悬停区域(无目标,不亮、放下无操作)
  const { setNodeRef } = useDroppable({ id: ROOT_ID });
  return (
    <div
      ref={setNodeRef}
      className="flex-1 overflow-y-auto"
      onContextMenu={onContextMenu}
      onDragOver={onNativeDragOver}
      onDrop={onNativeDrop}
    >
      {children}
    </div>
  );
}

/** 拖拽跟随物:不遮视野 —— 单个 = 小图标牌;多选 = 第一层数量徽标(Finder 习惯)。 */
function DragPreview({ node, count = 1 }: { node: Node; count?: number }) {
  if (count > 1) {
    return (
      <div className="w-7 h-7 rounded-full bg-accent text-white text-[12px] font-semibold flex items-center justify-center shadow-lg shadow-black/20 cursor-grabbing select-none">
        {count}
      </div>
    );
  }
  const Icon = iconFor(node.kind, node.title);
  return (
    <div className="w-7 h-7 rounded-md bg-surface border border-border-strong shadow-lg shadow-black/15 flex items-center justify-center cursor-grabbing select-none">
      <Icon size={14} className={colorFor(node.kind)} />
    </div>
  );
}
