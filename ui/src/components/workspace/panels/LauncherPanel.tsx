// 新标签页:问候 → 对话框 + 最近四个对话 → 网址框 + 最近四条浏览记录。
// 对话和网址完全分开:大输入只开对话,窄地址框只开网站,永不互相猜;各自的「最近」跟在各自的框下面。
import { useEffect, useRef, useState } from "react";
import { Bot, Globe } from "lucide-react";
import { api, type HistoryEntry, type Node } from "../../../api";
import { Favicon } from "../../ui";
import type { LauncherTab, WorkspaceGroupId } from "../types";

const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return "夜深了";
  if (h < 9) return "早上好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
};

/** 预览行是给人扫一眼的,把 Markdown 记号剥干净。 */
const plainPreview = (text: string) =>
  text.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|_-]+/g, " ").replace(/\s+/g, " ").trim();

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

const dateLine = () => {
  const now = new Date();
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 周${"日一二三四五六"[now.getDay()]}`;
};

export function LauncherPanel({ tab, groupId }: { tab: LauncherTab; groupId: WorkspaceGroupId }) {
  const [chatValue, setChatValue] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [chats, setChats] = useState<Node[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const chatRef = useRef<HTMLInputElement>(null);
  useEffect(() => { chatRef.current?.focus(); }, []);

  useEffect(() => {
    void api.listChats().then(({ chats }) => setChats(chats.filter((c) => c.kind === "chat").slice(0, 4))).catch(() => {});
    void api.listHistory().then((rows) => setHistory(rows.slice(0, 4))).catch(() => {});
  }, []);

  const fire = (type: string, detail: Record<string, unknown> = {}) =>
    window.dispatchEvent(new CustomEvent(type, { detail: { tabId: tab.id, groupId, ...detail } }));

  const onKey = (e: React.KeyboardEvent, kind: "chat" | "web", value: string) => {
    if (e.key === "Enter") { e.preventDefault(); fire("worktop:launch", { value, kind }); }
    if (e.key === "Escape") { e.preventDefault(); fire("worktop:launch-close"); }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-bg">
      <div className="max-w-[640px] mx-auto px-8 py-10 flex flex-col gap-6">
        {/* 问候 */}
        <div>
          <div className="text-[21px] font-semibold tracking-tight text-text">{greeting()}</div>
          <div className="text-[12.5px] text-text-faint mt-0.5">{dateLine()}</div>
        </div>

        {/* 对话:大框 + 最近四个对话 */}
        <div className="flex flex-col gap-2.5 min-w-0">
          <div className="flex items-center gap-2.5 bg-surface border border-border-strong rounded-xl px-4 py-3 transition-colors focus-within:border-accent">
            <Bot size={16} className="shrink-0 text-text-faint" />
            <input
              ref={chatRef}
              value={chatValue}
              onChange={(e) => setChatValue(e.target.value)}
              onKeyDown={(e) => onKey(e, "chat", chatValue)}
              placeholder="想做什么?说一句,开新对话"
              spellCheck={false}
              autoComplete="off"
              className="flex-1 min-w-0 bg-transparent outline-none text-[14.5px] text-text placeholder:text-text-faint"
            />
            <span className="shrink-0 text-[11px] rounded px-1.5 py-0.5 select-none text-text-faint bg-bg-inset">↩ 对话</span>
          </div>
          <div className="text-[11px] text-text-faint tracking-[1.5px] select-none pt-1">最近</div>
          {chats.map((c) => (
            <button
              key={c.id}
              onClick={() => fire("worktop:launch-open", { node: c })}
              className="flex items-start gap-2.5 text-left bg-surface border border-border rounded-[10px] px-3 py-2.5 hover:bg-bg-hover hover:border-border-strong transition-colors"
            >
              <span className="shrink-0 text-[15px] leading-[20px]">💬</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-text leading-[18px]">{c.title || "未命名对话"}</span>
                {c.last?.text && (
                  <span className="block truncate text-[11.5px] text-text-faint leading-[16px] mt-0.5">{plainPreview(c.last.text)}</span>
                )}
              </span>
            </button>
          ))}
          {!chats.length && <div className="text-[12.5px] text-text-faint py-2">还没有对话,上面说一句就开工</div>}
        </div>

        {/* 网址:一行地址框 + 最近四条浏览记录 */}
        <div className="flex flex-col gap-2.5 min-w-0">
          <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-4 py-2 transition-colors focus-within:border-accent">
            <Globe size={15} className="shrink-0 text-text-faint" />
            <input
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => onKey(e, "web", urlValue)}
              placeholder="打开网址…"
              spellCheck={false}
              autoComplete="off"
              className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-text placeholder:text-text-faint"
            />
          </div>
          <div className="text-[11px] text-text-faint tracking-[1.5px] select-none pt-1">最近</div>
          {history.map((h) => (
            <button
              key={h.url}
              onClick={() => fire("worktop:launch", { value: h.url, kind: "web" })}
              title={h.url}
              className="flex items-center gap-2.5 text-left bg-surface border border-border rounded-[10px] px-3 py-2 hover:bg-bg-hover hover:border-border-strong transition-colors"
            >
              <span className="shrink-0 w-5 h-5 rounded bg-bg-inset flex items-center justify-center"><Favicon url={h.url} size={14} /></span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-text leading-[18px]">{h.title || hostOf(h.url)}</span>
              <span className="shrink-0 text-[11px] text-text-faint">{hostOf(h.url)}</span>
            </button>
          ))}
          {!history.length && <div className="text-[12.5px] text-text-faint py-2">还没有浏览记录</div>}
        </div>

      </div>
    </div>
  );
}
