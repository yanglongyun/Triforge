// 护盾:权限的就地管理,全在输入框这一行完成,不进设置页。
//
// 不叫「权限模式」—— 用户不需要理解三种档位,只需要知道**盾开着还是关着**:
//   盾关 = 完全跳过;盾开 = 按规则把关;「逐步确认」= 内置规则「任何操作都问我」勾上。
// 整个模型只剩两个概念:盾是开关,规则是内容。
//
// 按钮显示的是**后果**不是名字:「护盾 · 3」「每次都问」「护盾已关」,一眼读出现在谁在把关。
// 规则的增删改走两级导航:列表点进详情,详情推回列表 —— 面板窄,摊不开两栏。
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, Loader2, Plus,
  ShieldCheck, ShieldOff, Trash2,
} from "lucide-react";
import { ASK_ALL_ID, permissionApi, type Mode, type Rule } from "../../lib/permission";
import { Switch } from "../ui";

export function RulesControl({ mode, onModeChange }: { mode: Mode; onModeChange: (m: Mode) => void }) {
  const shield = mode !== "skip";
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  const reload = () => { void permissionApi.listRules().then(setRules).catch(() => {}); };
  // 挂载即取一次:按钮上的计数(护盾 · N)不等面板打开才有
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (open) { reload(); setNote(""); } }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as any)) { setOpen(false); setDetailId(null); }
    };
    const onKey = (e: KeyboardEvent) => {
      // Escape 先退详情,再退面板 —— 和推入的层级一致
      if (e.key !== "Escape") return;
      if (detailId) setDetailId(null);
      else setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, detailId]);

  const askAllRule = rules.find((r) => r.id === ASK_ALL_ID) || null;
  const askAll = !!askAllRule?.enabled;
  const liveCount = rules.filter((r) => r.enabled && r.id !== ASK_ALL_ID).length;

  const toggleRule = (rule: Rule) => {
    void permissionApi.updateRule(rule.id, { enabled: !rule.enabled }).then(reload).catch(() => {});
  };

  const add = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setNote("");
    // 编译要调模型,慢是正常的 —— 但结果必须让人看见:编译成了什么条件、有没有降级
    void permissionApi.createRule(text)
      .then((r) => { setDraft(""); setNote(r.note || ""); reload(); })
      .catch((e) => setNote(e?.message || "没能保存"))
      .finally(() => setBusy(false));
  };

  const label = !shield ? "护盾已关" : askAll ? "每次都问" : liveCount ? `护盾 · ${liveCount}` : "护盾";
  const Icon = shield ? ShieldCheck : ShieldOff;

  return (
    <div ref={boxRef} className="relative">
      {/* 盾牌按钮:状态一眼可见 —— 开是绿,关是红,不点开也知道现在谁在把关 */}
      <button
        onClick={() => { setOpen((v) => !v); setDetailId(null); }}
        title="护盾:什么情况下要先问过你"
        className={[
          "inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12.5px] transition-colors",
          shield
            ? "text-success bg-success/10 hover:bg-success/[0.16]"
            : "text-danger bg-danger/10 hover:bg-danger/[0.16]",
        ].join(" ")}
      >
        <Icon size={14} />
        <span>{label}</span>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-[360px] rounded-xl border border-border
          bg-surface shadow-[0_10px_30px_rgba(15,15,15,0.14),0_2px_6px_rgba(15,15,15,0.08)] overflow-hidden">

          {/* 头:盾牌开关 —— 状态、后果、开关在同一行 */}
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <span className={[
              "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center",
              shield ? "bg-success/[0.12] text-success" : "bg-bg-inset text-text-faint",
            ].join(" ")}>
              <Icon size={16} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[13.5px] font-medium text-text leading-tight">
                {shield ? "护盾" : "护盾已关闭"}
              </span>
              <span className="block text-[11.5px] text-text-faint mt-0.5 leading-tight">
                {shield
                  ? askAll ? "每一次动手前都会问你" : liveCount ? `按 ${liveCount} 条规则把关` : "还没有规则,什么都拦不住"
                  : "助手做任何事都不会问你"}
              </span>
            </span>
            <Switch
              on={shield}
              label={shield ? "关闭护盾" : "打开护盾"}
              onChange={(next) => onModeChange(next ? "rules" : "skip")}
            />
          </div>

          {shield ? (
            <div className="relative overflow-hidden border-t border-border" style={detailId ? { minHeight: 268 } : undefined}>
              {/* 列表:命中任意一条就停下来问 */}
              <div className={detailId ? "pointer-events-none opacity-50" : ""}>
                <div className="px-3.5 pt-2 pb-1 text-[11px] text-text-faint">命中任意一条,就停下来问你</div>
                <div className="max-h-56 overflow-y-auto pb-1">
                  {rules.map((rule) => {
                    const builtin = rule.id === ASK_ALL_ID;
                    return (
                      <div
                        key={rule.id}
                        onClick={() => setDetailId(rule.id)}
                        className={[
                          "group flex items-center gap-2 pl-3 pr-2 py-1.5 cursor-pointer transition-colors",
                          builtin ? "bg-accent-soft/60 hover:bg-accent-soft" : "hover:bg-bg-hover",
                        ].join(" ")}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleRule(rule); }}
                          title={rule.enabled ? "停用" : "启用"}
                          className={[
                            "shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors",
                            rule.enabled ? "bg-accent border-accent text-white" : "border-border-strong text-transparent",
                          ].join(" ")}
                        >
                          <Check size={9} strokeWidth={3.5} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className={`text-[12.5px] leading-snug ${rule.enabled ? "text-text" : "text-text-faint"}`}>
                            {rule.text}
                            {builtin && (
                              <span className="ml-1.5 align-[1px] text-[9.5px] px-1 py-px rounded bg-accent text-white">内置</span>
                            )}
                          </div>
                          {/* 编译不出条件的规则必须长得不一样 ——
                              以为拦得住其实拦不住,比没有这条规则更糟 */}
                          {builtin ? (
                            <div className="mt-0.5 text-[11px] text-text-faint">勾上 = 每次动手前都问</div>
                          ) : !rule.compiled ? (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-warning">
                              <AlertTriangle size={10} className="shrink-0" />
                              只靠助手自觉,拦不住
                            </div>
                          ) : (
                            <div className="mt-0.5 text-[11px] text-text-faint font-mono truncate">
                              {[...rule.match.actions, ...rule.match.tools, ...rule.match.paths].join(" · ")}
                            </div>
                          )}
                        </div>
                        <ChevronRight size={13} className="shrink-0 text-text-faint opacity-50 group-hover:opacity-100" />
                      </div>
                    );
                  })}
                  {!rules.length && (
                    <div className="px-3.5 py-3 text-[12px] text-text-faint leading-relaxed">
                      还没有规则。写一句大白话,比如<br />
                      「删我文档以外的东西之前先问我」
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 p-2 border-t border-border">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                    placeholder="什么情况下要先问过你…"
                    className="flex-1 min-w-0 h-7 px-2 rounded-md border border-border bg-bg text-[12.5px]
                      text-text placeholder:text-text-faint outline-none focus:border-accent transition-colors"
                  />
                  <button
                    onClick={add}
                    disabled={!draft.trim() || busy}
                    className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center bg-accent text-white
                      hover:opacity-90 disabled:opacity-30 transition-opacity"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={14} />}
                  </button>
                </div>
                {note && (
                  <div className="px-3.5 pb-2 -mt-0.5 flex items-start gap-1 text-[11px] text-warning">
                    <AlertTriangle size={10} className="shrink-0 mt-[2px]" />
                    <span>{note}</span>
                  </div>
                )}
              </div>

              {/* 详情:从右侧推入 —— 列表看清单,这里改一条 */}
              {detailId && (
                <RuleDetail
                  rule={rules.find((r) => r.id === detailId) || null}
                  onBack={() => setDetailId(null)}
                  onSaved={(n) => { setNote(n); setDetailId(null); reload(); }}
                  onDeleted={() => { setDetailId(null); reload(); }}
                />
              )}
            </div>
          ) : (
            /* 关闭态:一张红卡直说后果,不绕弯 */
            <div className="px-3.5 pb-3.5">
              <div className="rounded-lg px-3 py-2.5 bg-danger/[0.06] border border-danger/25">
                <div className="text-[12.5px] font-medium text-danger">盾关着的时候,没有任何拦截</div>
                <div className="mt-0.5 text-[11.5px] text-text-dim leading-relaxed">
                  删文件、装东西、推代码 —— 助手都会直接做,不会再问你一句。你定的规则暂时不生效。
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 规则详情页:内置规则只读说明;用户规则可改正文(保存即重编译)、可删。 */
function RuleDetail({
  rule,
  onBack,
  onSaved,
  onDeleted,
}: {
  rule: Rule | null;
  onBack: () => void;
  onSaved: (note: string) => void;
  onDeleted: () => void;
}) {
  const builtin = rule?.id === ASK_ALL_ID;
  const [text, setText] = useState(rule?.text || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setText(rule?.text || ""); setError(""); }, [rule?.id]);
  if (!rule) return null;

  const save = () => {
    const next = text.trim();
    if (!next || busy) return;
    if (next === rule.text) { onBack(); return; }
    setBusy(true);
    void permissionApi.updateRule(rule.id, { text: next })
      .then((r) => onSaved(r.note || ""))
      .catch((e) => { setError(e?.message || "没能保存"); setBusy(false); });
  };
  const remove = () => {
    if (busy) return;
    setBusy(true);
    void permissionApi.deleteRule(rule.id)
      .then(onDeleted)
      .catch((e) => { setError(e?.message || "没能删除"); setBusy(false); });
  };

  return (
    <div className="absolute inset-0 bg-surface flex flex-col wb-slide-in">
      <div className="shrink-0 flex items-center gap-1.5 px-2.5 py-2 border-b border-border">
        <button
          onClick={onBack}
          title="返回列表"
          className="w-6 h-6 rounded-md flex items-center justify-center text-text-dim hover:text-text hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="text-[12.5px] font-medium text-text">{builtin ? "内置规则" : "编辑规则"}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col gap-1.5">
        <span className="text-[10.5px] text-text-faint tracking-wide">规则原话</span>
        {builtin ? (
          <>
            <div className="text-[13px] text-text pb-1">{rule.text}</div>
            <div className="text-[11.5px] text-text-faint leading-relaxed">
              最保守的一档:助手每一次动手前都会停下来等你点头。适合你想全程盯着的时候。
              勾上它,下面的规则就不用一条条命中了 —— 反正每次都问。
            </div>
          </>
        ) : (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              className="w-full min-h-[52px] px-2.5 py-2 rounded-lg border border-border bg-bg text-[12.5px]
                text-text leading-relaxed outline-none resize-none focus:border-accent transition-colors"
            />
            <span className="mt-1.5 text-[10.5px] text-text-faint tracking-wide">它会在什么时候拦下来</span>
            {rule.compiled ? (
              <div className="flex flex-wrap gap-1">
                {[...rule.match.actions, ...rule.match.tools, ...rule.match.paths].map((c) => (
                  <span key={c} className="px-1.5 py-0.5 rounded bg-accent-soft text-[11px] font-mono text-accent">{c}</span>
                ))}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1 text-[11px] text-warning">
                  <AlertTriangle size={10} className="shrink-0" />
                  这句话编译不出条件,拦不住
                </div>
                <div className="text-[11px] text-text-faint leading-relaxed">
                  它仍会写进助手的提示词,靠助手自觉遵守 —— 但没有硬拦截。
                  换个更具体的说法试试,比如点名某个目录或某个动作。
                </div>
              </>
            )}
            {error && (
              <div className="flex items-start gap-1 text-[11px] text-danger">
                <AlertTriangle size={10} className="shrink-0 mt-[2px]" />
                <span>{error}</span>
              </div>
            )}
          </>
        )}
      </div>

      {!builtin && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-border">
          <button
            onClick={save}
            disabled={!text.trim() || busy}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-accent text-white text-[12.5px]
              hover:opacity-90 disabled:opacity-30 transition-opacity"
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            保存并重新编译
          </button>
          <button
            onClick={remove}
            disabled={busy}
            title="删除这条规则"
            className="ml-auto inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12.5px] text-danger
              hover:bg-danger/10 disabled:opacity-40 transition-colors"
          >
            <Trash2 size={12} /> 删除
          </button>
        </div>
      )}
    </div>
  );
}
