import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Activity, type Call } from "../../../api";
import { Radio, ArrowRight, Sparkles, User } from "lucide-react";

type Socket = { on: (t: string, fn: (p: any) => void) => () => void };

const STATUS: Record<string, { label: string; dot: string; text: string }> = {
  pending: { label: "等待", dot: "bg-text-faint", text: "text-text-faint" },
  running: { label: "进行中", dot: "bg-accent animate-pulse", text: "text-accent" },
  done: { label: "完成", dot: "bg-success", text: "text-success" },
  error: { label: "出错", dot: "bg-danger", text: "text-danger" },
  cancelled: { label: "已取消", dot: "bg-text-faint", text: "text-text-faint" },
};

const fmtTime = (s: string) => {
  // sqlite datetime('now') 是 UTC "YYYY-MM-DD HH:MM:SS"
  const d = new Date(s.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// 全局活动:全树智能体之间的调用(calls 表)实时 feed —— 第二根支柱「相互通信」的可视化。
export function ActivityPanel({ socket, onOpenAgent }: { socket: Socket; onOpenAgent?: (id: string) => void }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    api.listCalls()
      .then((r) => { setCalls((r.calls || []).slice().sort((a, b) => b.id - a.id)); setLoaded(true); })
      .catch(() => setLoaded(true));
    api.listActivities().then(setActivities).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  // call_changed / message 时节流刷新(流式时 message 很密)
  useEffect(() => {
    const bump = () => { if (timer.current) return; timer.current = setTimeout(() => { timer.current = null; load(); }, 400); };
    const offs = ["call_changed", "activity_changed", "message", "end"].map((t) => socket.on(t, bump));
    return () => { offs.forEach((f) => f()); if (timer.current) clearTimeout(timer.current); };
  }, [socket, load]);

  const running = calls.filter((c) => c.status === "running").length
    + activities.filter((a) => a.status === "running").length;

  // 合并信息流:智能体间调用(calls)+ 应用 AI 调用(activities),按时间倒序
  type FeedItem = { key: string; time: string } & ({ type: "call"; call: Call } | { type: "ai"; act: Activity });
  const feed: FeedItem[] = [
    ...calls.map((c) => ({ key: `c${c.id}`, time: c.created_at, type: "call" as const, call: c })),
    ...activities.map((a) => ({ key: `a${a.id}`, time: a.created_at, type: "ai" as const, act: a })),
  ].sort((x, y) => (x.time < y.time ? 1 : x.time > y.time ? -1 : 0));

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border text-[13px]">
        <Radio size={14} className="text-accent" />
        <span className="font-medium text-text">活动</span>
        <span className="text-text-faint">· 智能体与应用</span>
        <span className="flex-1" />
        {running > 0 && <span className="text-accent">{running} 进行中</span>}
        <span className="text-text-faint">{feed.length} 条</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loaded && feed.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-text-faint">
            <Radio size={28} className="opacity-40" />
            <div className="text-[13px]">还没有调用。让一个智能体 call_agent / create_agent 另一个试试。</div>
          </div>
        )}
        <ul className="divide-y divide-border/60">
          {feed.map((item) => {
            if (item.type === "ai") {
              const a = item.act;
              const st = STATUS[a.status] || STATUS.pending;
              return (
                <li key={item.key} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 text-[13.5px]">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                    <span className="inline-flex items-center gap-1 shrink-0 text-text-dim">
                      <Sparkles size={12} className="text-accent" /> 应用·{a.source.replace(/^app:/, "")}
                    </span>
                    <span className="text-text truncate">{a.summary}</span>
                    <span className="flex-1" />
                    {a.tokens > 0 && <span className="text-[11px] text-text-faint shrink-0 tabular-nums">{a.tokens} tk</span>}
                    <span className={`text-[11.5px] shrink-0 ${st.text}`}>{st.label}</span>
                    <span className="text-[11.5px] text-text-faint shrink-0 tabular-nums">{fmtTime(a.created_at)}</span>
                  </div>
                  {a.detail && (
                    <div className={`mt-1 pl-4 text-[12px] line-clamp-2 ${a.status === "error" ? "text-danger/80" : "text-text-faint"}`}>
                      {a.detail}
                    </div>
                  )}
                </li>
              );
            }
            const c = item.call;
            const st = STATUS[c.status] || STATUS.pending;
            const detail = c.error || c.result || "";
            return (
              <li
                key={item.key}
                onClick={() => c.callee_id && onOpenAgent?.(c.callee_id)}
                className="px-4 py-2.5 hover:bg-bg-hover cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2 text-[13.5px]">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} />
                  <span className="flex items-center gap-1.5 min-w-0">
                    {c.caller_id
                      ? c.caller_id.startsWith("app:")
                        ? <span className="inline-flex items-center gap-1 text-text-dim"><Sparkles size={12} className="text-accent" /> 应用·{c.caller_id.slice(4)}</span>
                        : <span className="text-text-dim truncate">{c.callerTitle || c.caller_id.slice(0, 8)}</span>
                      : <span className="inline-flex items-center gap-1 text-text-dim"><User size={12} /> 你</span>}
                    <ArrowRight size={13} className="text-text-faint shrink-0" />
                    <span className="text-text font-medium truncate">{c.calleeTitle || c.callee_id.slice(0, 8)}</span>
                  </span>
                  <span className="flex-1" />
                  <span className={`text-[11.5px] shrink-0 ${st.text}`}>{st.label}</span>
                  <span className="text-[11.5px] text-text-faint shrink-0 tabular-nums">{fmtTime(c.created_at)}</span>
                </div>
                {detail && (
                  <div className={`mt-1 pl-4 text-[12px] line-clamp-2 ${c.error ? "text-danger/80" : "text-text-faint"}`}>
                    {detail}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
