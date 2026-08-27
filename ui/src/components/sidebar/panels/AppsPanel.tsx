// 「应用」面板:原生三件之一 —— 应用的家。
// 列出预装应用(可移除)与工作区应用(<workspace>/apps/<id>/,删除目录即移除),
// 打开标签页 / 钉到侧栏 / 让 AI 造一个新应用,都从这里出发。见 APP.md。
import { useState } from "react";
import { Pin, PinOff, Plus, Sparkles, SquareArrowOutUpRight, Trash2 } from "lucide-react";
import { ContextMenu, type MenuItem } from "../../ui";
import type { AppDef } from "../registry";

export function AppsPanel({
  apps,
  pinnedIds,
  onOpenTab,
  onTogglePin,
  onRemoveApp,
  onCreateWithAI,
}: {
  apps: AppDef[];
  pinnedIds: string[];
  /** 在标签页打开(tab 挂载)。 */
  onOpenTab: (app: AppDef) => void;
  onTogglePin: (app: AppDef) => void;
  onRemoveApp: (app: AppDef) => void;
  onCreateWithAI: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  // 点击 = 在标签页打开,永远如此。动作在侧栏、结果在主区域 —— 不改活动栏、不吞掉当前面板。
  // 「钉到侧栏」是另一件事,只从图钉按钮/右键菜单显式发生。
  const openApp = (app: AppDef) => onOpenTab(app);

  const appMenu = (e: React.MouseEvent, app: AppDef) => {
    e.preventDefault();
    e.stopPropagation();
    const pinned = pinnedIds.includes(app.id);
    const items: MenuItem[] = [];
    items.push({ label: "在标签页打开", icon: <SquareArrowOutUpRight size={13} />, onClick: () => onOpenTab(app) });
    if (app.mounts.panel) {
      items.push({
        label: pinned ? "从侧栏取下" : "钉到侧栏",
        icon: pinned ? <PinOff size={13} /> : <Pin size={13} className="text-accent" />,
        onClick: () => onTogglePin(app),
      });
    }
    items.push("divider", { label: "删除应用", icon: <Trash2 size={13} />, danger: true, onClick: () => onRemoveApp(app) });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto py-1">
        {/* 让 AI 造应用:AIOS 哲学的入口 —— 一句话到可用软件 */}
        <div
          onClick={onCreateWithAI}
          className="flex items-center gap-1.5 py-[4px] pl-3 pr-2 cursor-pointer select-none text-text-faint hover:text-text hover:bg-bg-hover"
        >
          <Sparkles size={14} className="shrink-0 text-accent" />
          <span className="text-[13.5px]">让 AI 造一个应用…</span>
        </div>

        {apps.map((app) => {
          const pinned = pinnedIds.includes(app.id);
          return (
            <div
              key={app.id}
              onClick={() => openApp(app)}
              onContextMenu={(e) => appMenu(e, app)}
              title={`${app.name} —— apps/${app.id}/`}
              className="group flex items-center gap-2 py-[5px] pl-3 pr-2 cursor-pointer select-none text-text hover:bg-bg-hover"
            >
              <span className="shrink-0 w-5 text-center text-[15px] leading-none">{app.icon}</span>
              <span className="flex-1 min-w-0 truncate text-[14px]">{app.name}</span>
              {app.mounts.panel && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTogglePin(app); }}
                  title={pinned ? "从侧栏取下" : "钉到侧栏"}
                  className={[
                    "shrink-0 w-5 h-5 rounded flex items-center justify-center hover:bg-bg-inset",
                    pinned ? "text-accent" : "text-text-faint opacity-0 group-hover:opacity-100 hover:text-text",
                  ].join(" ")}
                >
                  <Pin size={12} className={pinned ? "fill-current" : ""} />
                </button>
              )}
              <button
                onClick={(e) => appMenu(e, app)}
                className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-text-faint hover:text-text hover:bg-bg-inset opacity-0 group-hover:opacity-100"
                title="更多操作"
              >
                <span className="text-[15px] leading-none -mt-1">⋯</span>
              </button>
            </div>
          );
        })}

        {apps.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <Plus size={24} className="text-text-faint opacity-60" />
            <div className="text-[13px] text-text-faint leading-relaxed">
              还没有应用。<br />让 AI 造一个,或在工作区建 apps/&lt;id&gt;/ 目录。
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-2 border-t border-border text-[11px] text-text-faint leading-relaxed select-none">
        应用 = 工作区里的一个目录(app.json + HTML)。AI 用 write 工具就能造,契约见 APP.md。
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
