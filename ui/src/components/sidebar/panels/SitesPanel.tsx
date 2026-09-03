// 「网站」面板:收藏 + 历史。点开即在网页标签里打开(Electron 壳的 <webview>,真登录态)。
// 收藏是宿主自己的一张表(server/service/sites.ts):一棵树,文件夹可以无限嵌套,同级可拖动排序。
// 历史是另一张表(server/service/history.ts):一个 url 一行,重复访问只抬时间与次数。
//
// 顶部一条搜索:输入即筛,收藏和历史一起搜,分两段列出;清空回到当前视图。
// 搜索框下面一个「收藏 / 历史」切换,记在 localStorage。
//
// 拖拽用指针事件,和标签栏同一套路:超阈值才算拖、挂 lib/drag.ts 的
// 全局护栏(webview/iframe 会吞 pointerup)、松手事件被吞时靠 buttons===0 自愈。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus, Globe, History, Plus, Star, Trash2, X } from "lucide-react";
import { api, type HistoryEntry, type Site } from "../../../api";
import { beginGlobalDrag, endGlobalDrag } from "../../../lib/drag";
import { ContextMenu, dialog, type MenuItem } from "../../ui";

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const OPEN_KEY = "worktop.sites.openFolders";
const VIEW_KEY = "worktop.sites.view";
const readOpen = (): string[] => {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"); } catch { return []; }
};
const readView = (): "sites" | "history" => {
  try { return localStorage.getItem(VIEW_KEY) === "history" ? "history" : "sites"; } catch { return "sites"; }
};

/** "2026-09-01 13:20:11"(UTC)→ 相对时间。 */
const ago = (at: string) => {
  const t = new Date(at.replace(" ", "T") + "Z").getTime();
  const ms = Date.now() - t;
  if (!Number.isFinite(ms)) return at;
  if (ms < 60_000) return "刚刚";
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} 分钟前`;
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)} 小时前`;
  return `${Math.round(ms / 86400_000)} 天前`;
};
/** 按天分组的标题:今天 / 昨天 / 9 月 1 日。 */
const dayLabel = (at: string) => {
  const d = new Date(at.replace(" ", "T") + "Z");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400_000);
  if (diff <= 0) return "今天";
  if (diff === 1) return "昨天";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};

/** 落点:插在某一行之前 / 之后,或落进某个文件夹里。 */
type Drop = { overId: string; where: "before" | "after" | "inside" } | null;

const Favicon = ({ url }: { url: string }) => (
  <img
    src={`/api/favicon?url=${encodeURIComponent(url)}`}
    alt=""
    className="shrink-0 w-4 h-4 rounded-[3px] object-contain"
    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
  />
);

export function SitesPanel({ onOpenUrl, socket }: {
  onOpenUrl: (url: string, title?: string) => void;
  socket: { on: (event: string, fn: (payload: unknown) => void) => () => void };
}) {
  const [sites, setSites] = useState<Site[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hits, setHits] = useState<HistoryEntry[]>([]); // 搜索态的历史命中(服务端搜,不限于最近 200)
  const [view, setView] = useState<"sites" | "history">(() => readView());
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(readOpen()));
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const [q, setQ] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startY: number; dragging: boolean; drop: Drop } | null>(null);
  const suppressClick = useRef(false);

  const load = useCallback(() => { void api.listSites().then(setSites).catch(() => {}); }, []);
  const loadHistory = useCallback(() => { void api.listHistory().then(setHistory).catch(() => {}); }, []);
  useEffect(() => { load(); loadHistory(); }, [load, loadHistory]);
  useEffect(() => socket.on("sites_changed", () => load()), [socket, load]);
  useEffect(() => socket.on("history_changed", () => loadHistory()), [socket, loadHistory]);
  const switchView = (next: "sites" | "history") => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* 隐私模式 */ }
  };

  // 搜索态:历史走服务端(防抖),收藏在内存里筛
  const needle = q.trim().toLowerCase();
  useEffect(() => {
    if (!needle) { setHits([]); return; }
    let gone = false;
    const timer = setTimeout(() => { void api.listHistory(q.trim()).then((rows) => { if (!gone) setHits(rows); }).catch(() => {}); }, 180);
    return () => { gone = true; clearTimeout(timer); };
  }, [needle, q]);

  const byId = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const childrenOf = (id: string | null) => sites.filter((s) => (s.parent_id || null) === id);
  const isWithin = (target: string | null, folderId: string) => {
    let cur = target;
    for (let i = 0; cur && i < 64; i++) { if (cur === folderId) return true; cur = byId.get(cur)?.parent_id || null; }
    return false;
  };
  const pathOf = (site: Site) => {
    const names: string[] = [];
    let cur = site.parent_id;
    for (let i = 0; cur && i < 64; i++) { const p = byId.get(cur); if (!p) break; names.unshift(p.title); cur = p.parent_id; }
    return names.join(" / ");
  };
  const bookmarked = useMemo(() => new Set(sites.filter((s) => s.kind === "site").map((s) => s.url.replace(/\/$/, ""))), [sites]);

  const toggleFolder = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* 隐私模式 */ }
      return next;
    });
  };

  // ── 收藏:增删改 ──
  const add = async (parentId: string | null = null) => {
    const url = await dialog.prompt("", { title: "添加网站", placeholder: "example.com 或 https://…", confirmText: "添加" });
    if (!url || !url.trim()) return;
    try { await api.createSite({ url: url.trim(), parentId }); load(); }
    catch (e: any) { void dialog.alert(e?.message || "添加失败"); }
  };
  const addFolder = async (parentId: string | null = null) => {
    const title = await dialog.prompt("", { title: "新建文件夹", placeholder: "文件夹名…", confirmText: "创建" });
    if (!title || !title.trim()) return;
    try { await api.createSiteFolder({ title: title.trim(), parentId }); if (parentId) setOpen((p) => new Set(p).add(parentId)); load(); }
    catch (e: any) { void dialog.alert(e?.message || "创建失败"); }
  };
  const remove = async (site: Site) => {
    const isFolder = site.kind === "folder";
    const count = isFolder ? childrenOf(site.id).length : 0;
    const hint = count ? `\n里面的 ${count} 项会移到上一层,不会被删除。` : "";
    if (!(await dialog.confirm(`${isFolder ? "删除文件夹" : "从收藏里移除"}「${site.title}」?${hint}`,
      { danger: true, confirmText: isFolder ? "删除" : "移除" }))) return;
    try { await api.removeSite(site.id); load(); } catch { /* 列表会自己对齐 */ }
  };
  const rename = async (site: Site) => {
    const title = await dialog.prompt(site.title, { title: "重命名", confirmText: "保存" });
    if (!title || !title.trim()) return;
    try { await api.updateSite(site.id, { title: title.trim() }); load(); } catch { /* 同上 */ }
  };
  const contextMenu = (e: React.MouseEvent, site: Site) => {
    e.preventDefault(); e.stopPropagation();
    const isFolder = site.kind === "folder";
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        ...(isFolder
          ? [
            { label: "在此添加网站…", icon: <Plus size={13} />, onClick: () => void add(site.id) },
            { label: "在此新建文件夹…", icon: <FolderPlus size={13} />, onClick: () => void addFolder(site.id) },
          ]
          : [{ label: "打开", icon: <Globe size={13} />, onClick: () => onOpenUrl(site.url, site.title) }]),
        { label: "重命名…", onClick: () => void rename(site) },
        "divider" as const,
        { label: isFolder ? "删除文件夹" : "移除", icon: <Trash2 size={13} />, danger: true, onClick: () => void remove(site) },
      ],
    });
  };

  // ── 历史:收藏 / 忘掉 / 清空 ──
  const bookmark = async (h: HistoryEntry) => {
    try { await api.createSite({ url: h.url, title: h.title || undefined }); load(); } catch (e: any) { void dialog.alert(e?.message || "收藏失败"); }
  };
  const forget = async (h: HistoryEntry) => {
    try { await api.forgetHistory({ url: h.url }); loadHistory(); if (needle) setHits((rows) => rows.filter((r) => r.url !== h.url)); } catch { /* 同上 */ }
  };
  const clearHistory = async () => {
    if (!history.length) return;
    if (!(await dialog.confirm("清空全部浏览记录?不可恢复。", { danger: true, confirmText: "清空" }))) return;
    try { await api.forgetHistory({ all: true }); loadHistory(); setHits([]); } catch { /* 同上 */ }
  };
  const historyMenu = (e: React.MouseEvent, h: HistoryEntry) => {
    e.preventDefault(); e.stopPropagation();
    const saved = bookmarked.has(h.url.replace(/\/$/, ""));
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "打开", icon: <Globe size={13} />, onClick: () => onOpenUrl(h.url, h.title) },
        { label: saved ? "已在收藏里" : "收藏", icon: <Star size={13} />, disabled: saved, onClick: () => void bookmark(h) },
        "divider" as const,
        { label: "从历史里删除", icon: <Trash2 size={13} />, danger: true, onClick: () => void forget(h) },
      ],
    });
  };

  // ── 拖拽(仅收藏树)──
  const dropAt = (y: number): Drop => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-site-id]") || [])];
    for (const el of rows) {
      const r = el.getBoundingClientRect();
      if (y < r.top || y > r.bottom) continue;
      const id = String(el.dataset.siteId);
      const row = byId.get(id);
      if (!row) continue;
      const offset = (y - r.top) / r.height;
      if (row.kind === "folder" && offset > 0.25 && offset < 0.75) return { overId: id, where: "inside" };
      return { overId: id, where: offset < 0.5 ? "before" : "after" };
    }
    const last = rows[rows.length - 1];
    return last ? { overId: String(last.dataset.siteId), where: "after" } : null;
  };
  const commit = (movedId: string, target: Drop) => {
    if (!target) return;
    const moved = byId.get(movedId);
    const over = byId.get(target.overId);
    if (!moved || !over || moved.id === over.id) return;
    const parentId: string | null = target.where === "inside" ? over.id : (over.parent_id || null);
    if (moved.kind === "folder" && isWithin(parentId, moved.id)) return;
    const siblings = childrenOf(parentId).filter((s) => s.id !== movedId);
    let index = siblings.length;
    if (target.where !== "inside") {
      const at = siblings.findIndex((s) => s.id === over.id);
      if (at >= 0) index = target.where === "before" ? at : at + 1;
    }
    const ids = siblings.map((s) => s.id);
    ids.splice(index, 0, movedId);
    setSites((prev) => prev.map((s) => (s.id === movedId ? { ...s, parent_id: parentId } : s)));
    if (parentId) setOpen((prev) => new Set(prev).add(parentId));
    void api.reorderSites({ parentId, ids }).then(setSites).catch(load);
  };
  const startDrag = (e: React.PointerEvent, site: Site) => {
    if (e.button !== 0 || needle) return;
    dragRef.current = { id: site.id, startY: e.clientY, dragging: false, drop: null };
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (ev.buttons === 0) { onUp(); return; }
      if (!d.dragging && Math.abs(ev.clientY - d.startY) > 5) {
        d.dragging = true; setDragId(d.id); document.body.style.cursor = "grabbing"; beginGlobalDrag();
      }
      if (!d.dragging) return;
      ev.preventDefault();
      d.drop = dropAt(ev.clientY);
      setDrop(d.drop);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const d = dragRef.current;
      dragRef.current = null; setDragId(null); setDrop(null);
      if (!d?.dragging) return;
      document.body.style.cursor = ""; endGlobalDrag();
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      commit(d.id, d.drop);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const Row = ({ site, depth }: { site: Site; depth: number }) => {
    const isFolder = site.kind === "folder";
    const expanded = isFolder && open.has(site.id);
    const marker = drop?.overId === site.id ? drop.where : null;
    return (
      <div
        data-site-id={site.id}
        onPointerDown={(e) => startDrag(e, site)}
        onClick={() => {
          if (suppressClick.current) return;
          if (isFolder) toggleFolder(site.id); else onOpenUrl(site.url, site.title);
        }}
        onContextMenu={(e) => contextMenu(e, site)}
        title={isFolder ? site.title : site.url}
        style={{ paddingLeft: 12 + depth * 16 }}
        className={[
          "group relative flex items-center gap-2 py-[5px] pr-2 cursor-pointer select-none text-text transition-colors",
          dragId === site.id ? "opacity-40" : "",
          marker === "inside" ? "bg-accent-soft" : "hover:bg-bg-hover",
        ].join(" ")}
      >
        {marker === "before" && <span className="absolute left-3 right-2 -top-px h-0.5 rounded bg-accent" />}
        {marker === "after" && <span className="absolute left-3 right-2 -bottom-px h-0.5 rounded bg-accent" />}
        {isFolder ? (
          <>
            {expanded ? <ChevronDown size={13} className="shrink-0 text-text-faint" /> : <ChevronRight size={13} className="shrink-0 text-text-faint" />}
            <Folder size={15} className="shrink-0 text-accent" />
          </>
        ) : <Favicon url={site.url} />}
        <span className="flex-1 min-w-0 truncate text-[14px]">{site.title || hostOf(site.url)}</span>
        <button
          onClick={(e) => { e.stopPropagation(); void remove(site); }}
          onPointerDown={(e) => e.stopPropagation()}
          title={isFolder ? "删除文件夹" : "移除"}
          className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-faint opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-bg-inset"
        >
          <Trash2 size={12} />
        </button>
      </div>
    );
  };
  const Tree = ({ parentId, depth }: { parentId: string | null; depth: number }) => (
    <>
      {childrenOf(parentId).map((site) => (
        <div key={site.id}>
          <Row site={site} depth={depth} />
          {site.kind === "folder" && open.has(site.id) && <Tree parentId={site.id} depth={depth + 1} />}
        </div>
      ))}
    </>
  );

  const HistoryRow = ({ h, showTime }: { h: HistoryEntry; showTime: boolean }) => (
    <div
      onClick={() => onOpenUrl(h.url, h.title)}
      onContextMenu={(e) => historyMenu(e, h)}
      title={h.url}
      className="group flex items-center gap-2 py-[5px] px-3 cursor-pointer select-none hover:bg-bg-hover"
    >
      <Favicon url={h.url} />
      <span className="flex-1 min-w-0 truncate text-[13.5px] text-text">{h.title || hostOf(h.url)}</span>
      <span className="shrink-0 text-[11px] text-text-faint">{showTime ? ago(h.visited_at) : hostOf(h.url)}</span>
      <button
        onClick={(e) => { e.stopPropagation(); void forget(h); }}
        title="从历史里删除"
        className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-faint opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-bg-inset"
      >
        <X size={12} />
      </button>
    </div>
  );

  // 搜索态:收藏在内存筛,历史用服务端命中
  const siteHits = needle
    ? sites.filter((s) => s.kind === "site" && (s.title.toLowerCase().includes(needle) || hostOf(s.url).toLowerCase().includes(needle))).slice(0, 50)
    : [];

  // 历史按天分组
  const groups = useMemo(() => {
    const out: { label: string; rows: HistoryEntry[] }[] = [];
    for (const h of history) {
      const label = dayLabel(h.visited_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(h); else out.push({ label, rows: [h] });
    }
    return out;
  }, [history]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-1 px-2 pt-1.5 pb-1">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); } }}
          placeholder="搜索收藏和历史…"
          spellCheck={false}
          className="flex-1 min-w-0 h-6 px-2 rounded bg-bg-inset text-[12px] text-text placeholder:text-text-faint outline-none focus:ring-1 ring-accent/40"
        />
        {q && (
          <button onClick={() => setQ("")} title="清除" className="w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover">
            <X size={12} />
          </button>
        )}
      </div>
      {!needle && (
        <div className="shrink-0 flex px-2 pb-1.5 border-b border-border">
          {([["sites", "收藏", Star], ["history", "历史", History]] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => switchView(id)}
              className={[
                "flex-1 h-6 rounded flex items-center justify-center gap-1 text-[12px] transition-colors",
                view === id ? "bg-bg-inset text-text font-medium" : "text-text-faint hover:text-text",
              ].join(" ")}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
      )}

      {needle ? (
        <div className="flex-1 overflow-y-auto py-1">
          {siteHits.length > 0 && <div className="px-3 pt-1 pb-0.5 text-[11px] font-medium text-text-faint select-none">收藏</div>}
          {siteHits.map((site) => (
            <div
              key={site.id}
              onClick={() => onOpenUrl(site.url, site.title)}
              onContextMenu={(e) => contextMenu(e, site)}
              title={site.url}
              className="flex items-center gap-2 py-[5px] px-3 cursor-pointer select-none hover:bg-bg-hover"
            >
              <Favicon url={site.url} />
              <span className="shrink-0 truncate max-w-[60%] text-[13.5px] text-text">{site.title || hostOf(site.url)}</span>
              <span className="flex-1 min-w-0 truncate text-[11px] text-text-faint">{pathOf(site) || hostOf(site.url)}</span>
            </div>
          ))}
          {hits.length > 0 && <div className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-text-faint select-none">历史</div>}
          {hits.map((h) => <HistoryRow key={h.url} h={h} showTime={true} />)}
          {!siteHits.length && !hits.length && <div className="px-3 py-6 text-center text-[12.5px] text-text-faint">没有匹配的网站</div>}
        </div>
      ) : view === "sites" ? (
        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          <div className="flex items-center">
            <div onClick={() => void add()} className="flex-1 flex items-center gap-1.5 py-[4px] pl-3 pr-2 cursor-pointer select-none text-text hover:bg-bg-hover">
              <Plus size={14} className="shrink-0" />
              <span className="text-[13.5px]">添加网站…</span>
            </div>
            <button onClick={() => void addFolder()} title="新建文件夹" className="shrink-0 w-7 h-7 mr-1.5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-hover transition-colors">
              <FolderPlus size={14} />
            </button>
          </div>
          <Tree parentId={null} depth={0} />
          {!sites.length && <div className="px-3 py-6 text-center text-[12.5px] text-text-faint">还没有收藏的网站</div>}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 overflow-y-auto py-1">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="px-3 pt-2 pb-0.5 text-[11px] font-medium text-text-faint select-none">{g.label}</div>
                {g.rows.map((h) => <HistoryRow key={h.url} h={h} showTime={true} />)}
              </div>
            ))}
            {!history.length && <div className="px-3 py-6 text-center text-[12.5px] text-text-faint">还没有浏览记录</div>}
          </div>
          {history.length > 0 && (
            <div className="shrink-0 border-t border-border">
              <button onClick={() => void clearHistory()} className="w-full py-1.5 text-[12px] text-text-faint hover:text-danger hover:bg-bg-hover transition-colors">清空浏览记录</button>
            </div>
          )}
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
