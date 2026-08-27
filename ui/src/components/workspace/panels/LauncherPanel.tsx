// 新标签页(方案 C):一个全能输入框 —— 内容即类型。
//   输入文字 → 新建对话并把文字作为第一条消息发出;
//   输入网址 → 打开网页标签(同站已开则聚焦);
//   空输入 Enter → 空白对话;Esc → 关闭本标签。
// 提交动作经全局事件交给 App(workbench:launch*),标签在原位「就地转身」成目标标签。
import { useEffect, useRef, useState } from "react";
import { Bot, CornerDownLeft, FileText, Globe, Terminal } from "lucide-react";
import { looksLikeUrl } from "../../../lib/urls";
import type { LauncherTab, WorkspaceGroupId } from "../types";

export function LauncherPanel({ tab, groupId }: { tab: LauncherTab; groupId: WorkspaceGroupId }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const web = looksLikeUrl(value.trim());
  const fire = (type: string, detail: Record<string, unknown> = {}) =>
    window.dispatchEvent(new CustomEvent(type, { detail: { tabId: tab.id, groupId, ...detail } }));

  return (
    <div className="flex-1 flex items-center justify-center bg-bg">
      <div className="w-full max-w-[560px] px-6 flex flex-col gap-4 -mt-[6vh]">
        <div className="text-center text-[15px] text-text-faint select-none">开始一段对话,或打开一个网站</div>

        <div className="flex items-center gap-2.5 bg-surface border border-border-strong rounded-xl px-4 py-3 shadow-sm transition-colors focus-within:border-accent">
          {web
            ? <Globe size={17} className="shrink-0 text-accent" />
            : <Bot size={17} className="shrink-0 text-text-faint" />}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); fire("workbench:launch", { value }); }
              if (e.key === "Escape") { e.preventDefault(); fire("workbench:launch-close"); }
            }}
            placeholder="输入消息开启对话 · 输入网址打开网站"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-text placeholder:text-text-faint"
          />
          <span className={[
            "shrink-0 text-[11px] rounded px-1.5 py-0.5 select-none",
            web ? "text-accent bg-accent-soft" : "text-text-faint bg-bg-inset",
          ].join(" ")}>
            {web ? "打开网站" : "新对话"}
          </span>
        </div>

        <div className="flex justify-center gap-2">
          <button
            onClick={() => fire("workbench:launch-create", { kind: "file" })}
            className="flex items-center gap-1.5 text-[12.5px] text-text-dim border border-border rounded-full px-3.5 py-1.5 hover:bg-bg-hover hover:text-text hover:border-border-strong transition-colors"
          >
            <FileText size={13} className="text-text-faint" /> 新建文件
          </button>
          <button
            onClick={() => fire("workbench:launch-create", { kind: "terminal" })}
            className="flex items-center gap-1.5 text-[12.5px] text-text-dim border border-border rounded-full px-3.5 py-1.5 hover:bg-bg-hover hover:text-text hover:border-border-strong transition-colors"
          >
            <Terminal size={13} className="text-success" /> 新建终端
          </button>
        </div>

        <div className="text-center text-[11.5px] text-text-faint select-none flex items-center justify-center gap-1">
          <CornerDownLeft size={11} /> 开启(空输入 = 空白对话) · Esc 关闭此标签
        </div>
      </div>
    </div>
  );
}
