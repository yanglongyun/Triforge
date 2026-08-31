import { useState } from 'react';
import { cardStatus, ITEM_STATUS_WEIGHT } from '@shared/status.mjs';
import type { Card, Item } from '../types';
import { ItemRow } from './ItemRow';
import { Link, Plus } from './icons';

/** 未完成的浮上来，完成的沉底 —— 卡片里最该看见的是「还欠什么」。 */
const byUrgency = (a: Item, b: Item) =>
  ITEM_STATUS_WEIGHT[a.status] - ITEM_STATUS_WEIGHT[b.status] || a.position - b.position;

export function ProjectCard(
  { card, activeItemId, onOpenItem, onToggleItem, onAddItem, onOpenCard }:
  {
    card: Card;
    activeItemId: number | null;
    onOpenItem: (item: Item) => void;
    onToggleItem: (item: Item) => void;
    onAddItem: (title: string) => void;
    onOpenCard: () => void;
  },
) {
  const [drafting, setDrafting] = useState(false);
  const tone = cardStatus(card.status);
  const done = card.items.filter((i) => i.status === 'done').length;
  const percent = card.items.length ? (done / card.items.length) * 100 : 0;

  function submit(form: HTMLFormElement) {
    const input = form.elements.namedItem('title') as HTMLInputElement;
    const title = input.value.trim();
    if (title) onAddItem(title);
    input.value = '';
  }

  return (
    <section
      className="card tone"
      style={{ '--hue': tone.hue } as React.CSSProperties}
      data-archived={card.archived}
      aria-label={`${card.title}，${tone.label}`}
    >
      <header className="card-head">
        <div className="card-title-row">
          <h2 className="card-title">
            <button type="button" onClick={onOpenCard} style={{ textAlign: 'left', font: 'inherit', color: 'inherit' }}>
              {card.title}
            </button>
          </h2>
          <button type="button" className="pill" onClick={onOpenCard}>{tone.label}</button>
        </div>
        {card.subtitle && <p className="card-sub">{card.subtitle}</p>}
        {card.link && (
          <a className="card-sub" href={card.link} target="_blank" rel="noreferrer noopener"
             style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Link />{card.link.replace(/^https?:\/\//, '')}
          </a>
        )}
        {card.items.length > 0 && (
          <div className="meter">
            <span className="meter-rail"><span className="meter-fill" style={{ width: `${percent}%` }} /></span>
            <span className="meter-num">{done}/{card.items.length}</span>
          </div>
        )}
      </header>

      <ul className="items">
        {[...card.items].sort(byUrgency).map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            active={item.id === activeItemId}
            onOpen={() => onOpenItem(item)}
            onToggle={() => onToggleItem(item)}
          />
        ))}
      </ul>

      <footer className="card-foot">
        {drafting ? (
          <form
            onSubmit={(event) => { event.preventDefault(); submit(event.currentTarget); }}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDrafting(false); }}
          >
            <input
              name="title"
              autoFocus
              placeholder="条目标题，回车添加"
              className="ghost"
              style={{ border: '1px solid var(--line-hi)', background: 'var(--bg-sunken)', color: 'var(--ink)' }}
              onKeyDown={(event) => { if (event.key === 'Escape') setDrafting(false); }}
            />
          </form>
        ) : (
          <button type="button" className="ghost" onClick={() => setDrafting(true)}>
            <Plus /> 添加条目
          </button>
        )}
      </footer>
    </section>
  );
}
