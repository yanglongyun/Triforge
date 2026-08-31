// 护盾:权限的就地管理,全在输入框这一行完成,不进设置页。
//
// 不叫「权限模式」—— 用户不需要理解档位,只需要知道**盾开着还是关着**:
//   盾关 = 不问不拦;盾开 = 按你写的规则把关。整个模型只有两个概念:盾是开关,规则是内容。
//
// **规则的本职是写进提示词约束助手**,硬闸(gate)是附加的。所以界面不说
// 「编译失败」「拦不住」—— 那会把主路画成异常;只如实说明每条规则怎么起作用。
//
// 按钮显示的是**后果**不是名字:「护盾 · 3」比「按照规则」告诉你的多。
// 规则的增删改走两级导航:列表点进详情,详情推回列表 —— 面板窄,摊不开两栏。
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, Check, ChevronRight, GripVertical, Loader2, Plus,
  ShieldCheck, ShieldOff, Trash2,
} from "lucide-react";
import { permissionApi, type Mode, type Rule } from "../../lib/permission";
import { beginGlobalDrag, endGlobalDrag } from "../../lib/drag";
import { Switch } from "../ui";


/** 硬闸的作用范围说成人话。三维全空 = 不设限 = 任何一次工具调用。 */
const scopeOf = (rule: Rule) => {
  const parts = [...rule.match.tools, ...rule.match.actions, ...rule.match.paths];
  return parts.length ? parts.join(" · ") : "任何工具调用";
};

export function RulesControl({ mode, onModeChange }: { mode: Mode; onModeChange: (m: Mode) => void }) {
  const shield = mode !== "skip";
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");   // 编译结果的说明:中性信息,不是错误
  const [error, setError] = useState(""); // 真失败:存不下来
  const boxRef = useRef<HTMLDivElement>(null);

  const reload = () => { void permissionApi.listRules().then(setRules).catch(() => {}); };
  // 挂载即取一次:按钮上的计数(护盾 · N)不等面板打开才有
  useEffect(() => { reload(); }, []);
  useEffect(() => { if (open) { reload(); setNote(""); setError(""); } }, [open]);

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

  const liveCount = rules.filter((r) => r.enabled).length;

  // ── 拖动排序 ──────────────────────────────────────────────────────────
  // 指针拖拽,与标签栏同一套路:超过阈值才算拖(不然点一下就被当成拖),
  // 拖拽期挂全局护栏让 webview/iframe 失明,松手事件被吞掉时靠 buttons===0 自愈。
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; from: number; to: number; startY: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  /** 指针落在第几条之前。落在最后一条的下半截 = 排到末尾。 */
  const indexAt = (y: number) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-rule-index]") || [])];
    for (const el of rows) {
      const r = el.getBoundingClientRect();
      if (y < r.top + r.height / 2) return Number(el.dataset.ruleIndex);
    }
    return rows.length;
  };

  const applyReorder = (from: number, to: number) => {
    const next = [...rules];
    const [moved] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, moved);
    setRules(next); // 乐观:手一松就到位,不等网络
    void permissionApi.reorderRules(next.map((r) => r.id)).catch(reload);
  };

  const startDrag = (e: React.PointerEvent, rule: Rule, index: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { id: rule.id, from: index, to: index, startY: e.clientY, dragging: false };

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (ev.buttons === 0) { onUp(); return; }
      if (!drag.dragging && Math.abs(ev.clientY - drag.startY) > 5) {
        drag.dragging = true;
        setDragId(drag.id);
        document.body.style.cursor = "grabbing";
        beginGlobalDrag();
      }
      if (!drag.dragging) return;
      ev.preventDefault();
      drag.to = indexAt(ev.clientY);
      setOverIndex(drag.to);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const drag = dragRef.current;
      dragRef.current = null;
      setDragId(null);
      setOverIndex(null);
      if (!drag?.dragging) return;
      document.body.style.cursor = "";
      endGlobalDrag();
      // 拖完那一下的 click 别把详情页顶出来
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
      if (drag.to !== drag.from && drag.to !== drag.from + 1) applyReorder(drag.from, drag.to);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const toggleRule = (rule: Rule) => {
    void permissionApi.updateRule(rule.id, { enabled: !rule.enabled }).then(reload).catch(() => {});
  };

  const add = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setNote("");
    setError("");
    // 编译要调模型,慢是正常的 —— 结果要让人看见:范围编成了什么,或者为什么没有闸
    void permissionApi.createRule(text)
      .then((r) => { setDraft(""); setNote(r.note || ""); reload(); })
      .catch((e) => setError(e?.message || "没能保存"))
      .finally(() => setBusy(false));
  };

  const label = !shield ? "护盾已关" : liveCount ? `护盾 · ${liveCount}` : "护盾";
  const Icon = shield ? ShieldCheck : ShieldOff;

  return (
    <div ref={boxRef} className="relative">
      {/* 盾牌按钮:状态一眼可见 —— 开是绿,关是红,不点开也知道现在谁在把关 */}
      <button
        onClick={() => { setOpen((v) => !v); setDetailId(null); }}
        title="护盾:规则与拦截"
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
                  ? liveCount ? `${liveCount} 条规则` : "没有规则"
                  : "规则不再生效"}
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
                <div ref={listRef} className="max-h-56 overflow-y-auto pb-1">
                  {rules.map((rule, index) => (
                      <div
                        key={rule.id}
                        data-rule-index={index}
                        onClick={() => { if (!suppressClick.current) setDetailId(rule.id); }}
                        className={[
                          "group relative flex items-center gap-2 pl-1 pr-2 py-1.5 cursor-pointer transition-colors hover:bg-bg-hover",
                          dragId === rule.id ? "opacity-40" : "",
                        ].join(" ")}
                      >
                        {/* 落点提示:一条 2px 的线,插在哪儿一目了然 */}
                        {overIndex === index && (
                          <span className="absolute left-3 right-3 -top-px h-0.5 rounded bg-accent" />
                        )}
                        <span
                          onPointerDown={(e) => startDrag(e, rule, index)}
                          onClick={(e) => e.stopPropagation()}
                          title="拖动排序"
                          className="shrink-0 w-4 flex justify-center text-text-faint cursor-grab
                            opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
                        >
                          <GripVertical size={12} />
                        </span>
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
                          </div>
                          {/* 只摆事实:有拦截条件就显示条件,没有就不显示 */}
                          {rule.gate && (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-text-faint">
                              <ShieldCheck size={10} className="shrink-0 text-accent" />
                              <span className="font-mono truncate">{scopeOf(rule)}</span>
                            </div>
                          )}
                        </div>
                        <ChevronRight size={13} className="shrink-0 text-text-faint opacity-50 group-hover:opacity-100" />
                      </div>
                  ))}
                  {overIndex === rules.length && rules.length > 0 && (
                    <div className="relative h-0"><span className="absolute left-3 right-3 h-0.5 rounded bg-accent" /></div>
                  )}
                  {!rules.length && (
                    <div className="px-3.5 py-3 text-[12px] text-text-faint leading-relaxed">
                      还没有规则。例如:<br />
                      「删我文档以外的东西之前先问我」<br />
                      「所有编辑工具都先问我」
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 p-2 border-t border-border">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") add(); }}
                    placeholder="新增规则…"
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
                  <div className="px-3.5 pb-2 -mt-0.5 text-[11px] text-text-faint leading-relaxed">{note}</div>
                )}
                {error && (
                  <div className="px-3.5 pb-2 -mt-0.5 flex items-start gap-1 text-[11px] text-danger">
                    <AlertTriangle size={10} className="shrink-0 mt-[2px]" />
                    <span>{error}</span>
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
                <div className="text-[12.5px] font-medium text-danger">护盾已关闭</div>
                <div className="mt-0.5 text-[11.5px] text-text-dim leading-relaxed">
                  规则全部不生效,删除、安装、推送等操作不再拦截。
                  助手也不会再主动提醒,动手前不会停。
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 规则详情页:改正文(保存即重编译)、看它编译成了什么条件、删掉它。 */
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
        <span className="text-[12.5px] font-medium text-text">编辑规则</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col gap-1.5">
        <span className="text-[10.5px] text-text-faint tracking-wide">规则内容</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          className="w-full min-h-[52px] px-2.5 py-2 rounded-lg border border-border bg-bg text-[12.5px]
            text-text leading-relaxed outline-none resize-none focus:border-accent transition-colors"
        />
        <span className="mt-1.5 text-[10.5px] text-text-faint tracking-wide">拦截条件</span>
        {rule.gate ? (
          <div className="flex flex-wrap gap-1">
            {[...rule.match.tools, ...rule.match.actions, ...rule.match.paths].map((c) => (
              <span key={c} className="px-1.5 py-0.5 rounded bg-accent-soft text-[11px] font-mono text-accent">{c}</span>
            ))}
            {!rule.match.tools.length && !rule.match.actions.length && !rule.match.paths.length && (
              <span className="px-1.5 py-0.5 rounded bg-accent-soft text-[11px] text-accent">任何工具调用</span>
            )}
          </div>
        ) : (
          <div className="text-[12px] text-text-faint">无</div>
        )}
        {error && (
          <div className="flex items-start gap-1 text-[11px] text-danger">
            <AlertTriangle size={10} className="shrink-0 mt-[2px]" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-t border-border">
        <button
          onClick={save}
          disabled={!text.trim() || busy}
          className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-accent text-white text-[12.5px]
            hover:opacity-90 disabled:opacity-30 transition-opacity"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          保存
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
    </div>
  );
}
