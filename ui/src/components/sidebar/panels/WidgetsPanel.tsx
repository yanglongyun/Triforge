// 「组件」管理面板:装了哪些、钉/取下、删除、让 AI 造一个。
// 它不是活动栏三原生之一 —— 从活动栏底部的「组件」按钮进来(装十个组件也不会挤爆活动栏)。
import { useState } from "react";
import { Pin, PinOff, Sparkles, Trash2 } from "lucide-react";
import { ContextMenu, type MenuItem } from "../../ui";
import type { WidgetDef } from "../registry";

export function WidgetsPanel({
  widgets,
  pinnedIds,
  onTogglePin,
  onRemove,
  onCreateWithAI,
}: {
  widgets: WidgetDef[];
  pinnedIds: string[];
  onTogglePin: (widget: WidgetDef) => void;
  onRemove: (widget: WidgetDef) => void;
  onCreateWithAI: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const contextMenu = (e: React.MouseEvent, widget: WidgetDef) => {
    e.preventDefault(); e.stopPropagation();
    const pinned = pinnedIds.includes(widget.id);
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: pinned ? "从活动栏取下" : "钉到活动栏", icon: pinned ? <PinOff size={13} /> : <Pin size={13} className="text-accent" />, onClick: () => onTogglePin(widget) },
        "divider",
        { label: "删除组件", icon: <Trash2 size={13} />, danger: true, onClick: () => onRemove(widget) },
      ],
    });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto py-1">
        <div
          onClick={onCreateWithAI}
          className="flex items-center gap-1.5 py-[4px] pl-3 pr-2 cursor-pointer select-none text-text-faint hover:text-text hover:bg-bg-hover"
        >
          <Sparkles size={14} className="shrink-0 text-accent" />
          <span className="text-[13.5px]">让 AI 创建组件…</span>
        </div>

        {widgets.map((widget) => {
          const pinned = pinnedIds.includes(widget.id);
          return (
            <div
              key={widget.id}
              onClick={() => onTogglePin(widget)}
              onContextMenu={(e) => contextMenu(e, widget)}
              title={`${widget.name} —— widgets/${widget.id}/${widget.description ? `\n${widget.description}` : ""}`}
              className="group flex items-start gap-2 py-[6px] pl-3 pr-2 cursor-pointer select-none text-text hover:bg-bg-hover"
            >
              <span className="shrink-0 w-5 text-center text-[15px] leading-[18px]">{widget.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="truncate text-[14px] leading-[18px]">{widget.name}</div>
                {widget.description && (
                  <div className="truncate text-[11.5px] text-text-faint leading-[16px]">{widget.description}</div>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onTogglePin(widget); }}
                title={pinned ? "从活动栏取下" : "钉到活动栏"}
                className={[
                  "shrink-0 w-5 h-5 rounded flex items-center justify-center",
                  pinned ? "text-accent" : "text-text-faint opacity-0 group-hover:opacity-100 hover:text-text hover:bg-bg-inset",
                ].join(" ")}
              >
                {pinned ? <Pin size={12} /> : <PinOff size={12} />}
              </button>
            </div>
          );
        })}

        {!widgets.length && (
          <div className="px-3 py-6 text-center text-[12.5px] text-text-faint leading-relaxed">
还没有组件
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
