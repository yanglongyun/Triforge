// 「网站」面板:原生三件之一 —— 收藏的链接,点开即在网页标签里打开(Electron 壳的 <webview>,真登录态)。
// 数据是宿主自己的一张表(server/service/sites.ts),不是组件。
import { useCallback, useEffect, useState } from "react";
import { Globe, Plus, Trash2 } from "lucide-react";
import { api, type Site } from "../../../api";
import { ContextMenu, dialog, type MenuItem } from "../../ui";

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };

export function SitesPanel({ onOpenUrl, socket }: {
  onOpenUrl: (url: string, title?: string) => void;
  socket: { on: (event: string, fn: (payload: unknown) => void) => () => void };
}) {
  const [sites, setSites] = useState<Site[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const load = useCallback(() => { void api.listSites().then(setSites).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => socket.on("sites_changed", () => load()), [socket, load]);

  const add = async () => {
    const url = await dialog.prompt("", { title: "添加网站", placeholder: "example.com 或 https://…", confirmText: "添加" });
    if (!url || !url.trim()) return;
    try { await api.createSite({ url: url.trim() }); load(); }
    catch (e: any) { void dialog.alert(e?.message || "添加失败"); }
  };

  const remove = async (site: Site) => {
    if (!(await dialog.confirm(`从收藏里移除「${site.title}」?`, { danger: true, confirmText: "移除" }))) return;
    try { await api.removeSite(site.id); load(); } catch { /* 列表会自己对齐 */ }
  };

  const rename = async (site: Site) => {
    const title = await dialog.prompt(site.title, { title: "重命名", confirmText: "保存" });
    if (!title || !title.trim()) return;
    try { await api.updateSite(site.id, { title: title.trim() }); load(); } catch { /* 同上 */ }
  };

  const contextMenu = (e: React.MouseEvent, site: Site) => {
    e.preventDefault(); e.stopPropagation();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: "打开", icon: <Globe size={13} />, onClick: () => onOpenUrl(site.url, site.title) },
        { label: "重命名…", onClick: () => void rename(site) },
        "divider",
        { label: "移除", icon: <Trash2 size={13} />, danger: true, onClick: () => void remove(site) },
      ],
    });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto py-1">
        <div
          onClick={add}
          className="flex items-center gap-1.5 py-[4px] pl-3 pr-2 cursor-pointer select-none text-text-faint hover:text-text hover:bg-bg-hover"
        >
          <Plus size={14} className="shrink-0 text-accent" />
          <span className="text-[13.5px]">添加网站…</span>
        </div>

        {sites.map((site) => (
          <div
            key={site.id}
            onClick={() => onOpenUrl(site.url, site.title)}
            onContextMenu={(e) => contextMenu(e, site)}
            title={site.url}
            className="group flex items-center gap-2 py-[5px] pl-3 pr-2 cursor-pointer select-none text-text hover:bg-bg-hover"
          >
            <img
              src={`/api/favicon?url=${encodeURIComponent(site.url)}`}
              alt=""
              className="shrink-0 w-4 h-4 rounded-[3px] object-contain"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
            />
            <span className="flex-1 min-w-0 truncate text-[14px]">{site.title || hostOf(site.url)}</span>
            <button
              onClick={(e) => { e.stopPropagation(); void remove(site); }}
              title="移除"
              className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-faint opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-bg-inset"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {!sites.length && (
          <div className="px-3 py-6 text-center text-[12.5px] text-text-faint leading-relaxed">
            还没有收藏的网站<br />点上面「添加网站」
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
