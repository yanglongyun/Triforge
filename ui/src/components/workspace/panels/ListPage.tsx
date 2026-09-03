// 列表页外壳:应用 / 技能 / 任务这三张列表标签共用 —— 一行标题 + 说明(+ 可选主按钮),下面就是列表本身。
import { Sparkles } from "lucide-react";

export function ListPage({ title, hint, action, children }: {
  title: string;
  hint?: string;
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-2xl px-5 md:px-8 py-6 flex flex-col min-h-full">
        <div className="flex items-center gap-3 pb-3 border-b border-border">
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-semibold text-text">{title}</h1>
            {hint && <p className="mt-0.5 text-[12.5px] text-text-faint">{hint}</p>}
          </div>
          {action && (
            <button
              onClick={action.onClick}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-white text-[13px] hover:opacity-90 transition-opacity"
            >
              <Sparkles size={14} /> {action.label}
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0 flex flex-col -mx-3 pt-2">{children}</div>
      </div>
    </div>
  );
}
