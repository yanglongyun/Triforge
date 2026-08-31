// 审批卡:一次工具调用停在这儿,等你表态。
//
// 它**长在对话流里**,不做浮层 —— 它本来就是这一轮的一部分:
// 调用停在哪儿,卡就出现在哪儿,你能看见上下文里助手正在干什么。
//
// 出口只有两个:不允许 / 允许。**没有「以后都允许」** ——
// 那是一种失控:今天的放行会替将来的你放过你并不想放的事。
import { useState } from "react";
import { AlertTriangle, Check, MessageCircleQuestion, ShieldAlert, X } from "lucide-react";
import { highlightCommand, permissionApi, type ApprovalCard as Card } from "../../lib/permission";

export function ApprovalCard({ card, onDone }: { card: Card; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  // 提醒和规则命中刻意长得不一样:前者是助手自己的判断(会漏),后者是你定的闸(必到)。
  // 界面绝不能让人以为「危险操作它一定会问」。
  const consulting = card.source === "consult";
  const tone = consulting
    ? { border: "border-accent/40", bg: "bg-accent/[0.04]", rule: "border-accent/20 bg-accent/[0.03]", text: "text-accent" }
    : { border: "border-warning/40", bg: "bg-warning/[0.04]", rule: "border-warning/20 bg-warning/[0.03]", text: "text-warning" };

  const answer = (value: "allow" | "deny") => {
    setBusy(true);
    void permissionApi.respond(card.id, value)
      .then(() => onDone(card.id))
      .catch(() => setBusy(false));
  };

  return (
    <div className={`w-full max-w-2xl rounded-xl border ${tone.border} ${tone.bg} overflow-hidden`}>
      <div className="flex items-start gap-2.5 px-4 pt-3.5 pb-2">
        {consulting
          ? <MessageCircleQuestion size={16} className={`shrink-0 mt-0.5 ${tone.text}`} />
          : <ShieldAlert size={16} className={`shrink-0 mt-0.5 ${tone.text}`} />}
        <div className="min-w-0 flex-1">
          {consulting && (
            <div className={`mb-1 text-[11px] font-medium ${tone.text}`}>助手提醒</div>
          )}
          <div className="text-[14px] text-text leading-snug">
            {card.summary || `助手要调用 ${card.tool}`}
          </div>
          {/* 动作标签:这次操作「属于什么」,比读命令快 */}
          {card.actionLabels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {card.actionLabels.map((label) => (
                <span key={label} className={`px-1.5 py-0.5 rounded bg-warning/15 text-[11px] ${tone.text}`}>
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 命令原文:危险的那几个词标出来,别让人在一整行里自己找 */}
      {card.command && (
        <pre className="mx-4 mb-2 px-3 py-2 rounded-lg bg-bg-panel text-[12px] font-mono
          leading-relaxed whitespace-pre-wrap break-all select-text max-h-[104px] overflow-y-auto">
          {highlightCommand(card.command).map((part, i) => (
            <span key={i} className={part.danger ? "text-danger font-semibold" : "text-text-dim"}>
              {part.text}
            </span>
          ))}
        </pre>
      )}

      {!card.command && card.paths.length > 0 && (
        <div className="mx-4 mb-2 px-3 py-2 rounded-lg bg-bg-panel text-[12px] font-mono text-text-dim break-all select-text max-h-[104px] overflow-y-auto">
          {card.paths.join("\n")}
        </div>
      )}

      {/* 操作正文:光有工具名和路径判断不了该不该放行 ——
          写什么、把哪句改成哪句,得摊在眼前 */}
      {(card.preview || []).map((block) => (
        <div key={block.label} className="mx-4 mb-2">
          <div className="mb-1 text-[10.5px] text-text-faint tracking-wide">{block.label}</div>
          <pre className="px-3 py-2 rounded-lg bg-bg-panel text-[12px] font-mono text-text-dim
            leading-relaxed whitespace-pre-wrap break-all select-text max-h-[132px] overflow-y-auto">
            {block.text || <span className="text-text-faint">(空)</span>}
          </pre>
        </div>
      ))}

      {/* 为什么停下来:助手说的风险,或命中的那条规则原话 */}
      {(card.risk || card.reason || card.rule) && (
        <div className="px-4 pb-2.5 flex items-start gap-1.5 text-[12px] text-text-faint">
          <AlertTriangle size={11} className="shrink-0 mt-[3px]" />
          <span className="min-w-0">
            {consulting
              ? card.risk
              : card.rule
                ? <>命中规则:<span className="text-text-dim">{card.rule.text}</span></>
                : card.reason}
          </span>
        </div>
      )}

      <div className={`flex items-center gap-2 px-4 py-2.5 border-t ${tone.rule}`}>
        <span className="flex-1 text-[11.5px] text-text-faint">允许只对这一次生效</span>
        <button
          disabled={busy}
          onClick={() => answer("deny")}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border bg-surface
            text-[13px] text-text hover:bg-bg-hover disabled:opacity-40 transition-colors"
        >
          <X size={13} /> 不允许
        </button>
        <button
          disabled={busy}
          onClick={() => answer("allow")}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent text-white
            text-[13px] hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          <Check size={13} /> 允许
        </button>
      </div>
    </div>
  );
}
