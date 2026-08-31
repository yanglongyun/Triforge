import { useEffect, useRef, useState } from 'react';
import { CARD_STATUSES, ITEM_STATUSES, cardStatus } from '@shared/status.mjs';
import type { Card, Item } from '../types';
import { Markdown } from '../lib/markdown';
import { StatusPicker } from './StatusPicker';
import { Close, Trash } from './icons';

const stamp = (ms: number) => new Date(ms).toLocaleString('zh-CN',
  { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 焦点圈在面板里，Esc 关闭 —— 键盘和读屏都不会跑到背后的看板上去。 */
function useSheetFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    const previously = document.activeElement as HTMLElement | null;
    node?.focus({ preventScroll: true }); // 别自动聚焦输入框 —— 手机上会立刻弹键盘
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !node) return;
      const focusable = node.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])');
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previously?.focus();
    };
  }, [onClose]);
  return ref;
}

function Shell(
  { crumb, onClose, children, footer }:
  { crumb: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode },
) {
  const ref = useSheetFocus(onClose);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={crumb} ref={ref} tabIndex={-1}>
        <header className="sheet-head">
          <span className="crumb">{crumb}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭"><Close /></button>
        </header>
        <div className="sheet-body">{children}</div>
        <footer className="sheet-foot">{footer}</footer>
      </div>
    </>
  );
}

/** 标题就地编辑：失焦即存，Esc 撤销，Enter 收工。 */
function TitleField(
  { value, onCommit, ...rest }: { value: string; onCommit: (next: string) => void } & { 'aria-label': string },
) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      {...rest}
      className="sheet-title"
      rows={1}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        event.target.style.height = 'auto';
        event.target.style.height = `${event.target.scrollHeight}px`;
      }}
      onBlur={() => { const next = draft.trim(); next && next !== value ? onCommit(next) : setDraft(value); }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') { setDraft(value); event.currentTarget.blur(); }
      }}
    />
  );
}

export function ItemSheet(
  { item, card, onClose, onPatch, onDelete }:
  { item: Item; card: Card; onClose: () => void; onPatch: (patch: Partial<Item>) => void; onDelete: () => void },
) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.detail);
  useEffect(() => { setDraft(item.detail); setEditing(false); }, [item.id, item.detail]);

  const save = () => { if (draft !== item.detail) onPatch({ detail: draft }); setEditing(false); };

  return (
    <Shell
      crumb={`${card.title} · ${cardStatus(card.status).label}`}
      onClose={onClose}
      footer={
        <>
          {editing ? (
            <>
              <button type="button" className="btn primary" onClick={save}>保存</button>
              <button type="button" className="btn" onClick={() => { setDraft(item.detail); setEditing(false); }}>取消</button>
            </>
          ) : (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              {item.detail ? '编辑详情' : '写点什么'}
            </button>
          )}
          <span className="grow" />
          <span className="stamp">{stamp(item.updated_at)}</span>
          <button type="button" className="icon-btn" aria-label="删除条目"
                  onClick={() => { if (confirm(`删除「${item.title}」？`)) { onDelete(); onClose(); } }}>
            <Trash />
          </button>
        </>
      }
    >
      <TitleField aria-label="条目标题" value={item.title} onCommit={(title) => onPatch({ title })} />
      <StatusPicker label="条目状态" options={ITEM_STATUSES} value={item.status}
                    onPick={(status) => onPatch({ status })} />
      {editing ? (
        <textarea className="editor" value={draft} autoFocus
                  placeholder="支持 # 标题、- 列表、**粗体**、`代码`、```代码块```、> 引用"
                  onChange={(event) => setDraft(event.target.value)} />
      ) : item.detail ? (
        <div className="prose"><Markdown text={item.detail} /></div>
      ) : (
        <p style={{ color: 'var(--ink-low)', fontSize: 13.5 }}>还没有详情。</p>
      )}
    </Shell>
  );
}

export function CardSheet(
  { card, onClose, onPatch, onDelete }:
  { card: Card; onClose: () => void; onPatch: (patch: Partial<Card>) => void; onDelete: () => void },
) {
  const [subtitle, setSubtitle] = useState(card.subtitle);
  useEffect(() => setSubtitle(card.subtitle), [card.id, card.subtitle]);
  const done = card.items.filter((i) => i.status === 'done').length;

  return (
    <Shell
      crumb={`项目 · ${card.items.length ? `${done}/${card.items.length} 完成` : '还没有条目'}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onPatch({ archived: card.archived ? 0 : 1 })}>
            {card.archived ? '取消归档' : '归档'}
          </button>
          <span className="grow" />
          <span className="stamp">{stamp(card.updated_at)}</span>
          <button type="button" className="icon-btn" aria-label="删除项目"
                  onClick={() => {
                    if (confirm(`删除项目「${card.title}」及其 ${card.items.length} 个条目？`)) { onDelete(); onClose(); }
                  }}>
            <Trash />
          </button>
        </>
      }
    >
      <TitleField aria-label="项目标题" value={card.title} onCommit={(title) => onPatch({ title })} />
      <StatusPicker label="项目状态" options={CARD_STATUSES} value={card.status}
                    onPick={(status) => onPatch({ status })} />
      <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-low)', marginBottom: 6 }}>一句话说明</label>
      <textarea
        className="editor" style={{ minHeight: 76, fontFamily: 'inherit', fontSize: 13.5 }}
        value={subtitle} placeholder="这个项目是干嘛的"
        onChange={(event) => setSubtitle(event.target.value)}
        onBlur={() => { if (subtitle !== card.subtitle) onPatch({ subtitle }); }}
      />
      <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-low)', margin: '16px 0 6px' }}>链接</label>
      <input
        className="editor" style={{ minHeight: 0, height: 40, fontSize: 13 }}
        defaultValue={card.link} placeholder="https://…" inputMode="url"
        onBlur={(event) => { if (event.target.value !== card.link) onPatch({ link: event.target.value }); }}
      />
    </Shell>
  );
}
