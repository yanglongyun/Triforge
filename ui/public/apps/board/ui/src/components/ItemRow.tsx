import { itemStatus } from '@shared/status.mjs';
import type { Item } from '../types';
import { Chevron } from './icons';

/** 详情的第一句 —— 比「有详情」三个字有用得多。
 *  围栏代码块整块跳过：``` 后面那个语言名不是正文。 */
function preview(detail: string): string {
  const lines = detail.split('\n');
  let fenced = false;
  for (const raw of lines) {
    if (raw.trimStart().startsWith('```')) { fenced = !fenced; continue; }
    if (fenced) continue;
    const text = raw.replace(/^\s*[#>\-*]+\s*/, '').replace(/[`*]/g, '').trim();
    if (text) return text;
  }
  return '';
}

const GLYPH: Record<string, string> = { doing: 'doing', blocked: 'blocked' };

export function ItemRow(
  { item, active, onOpen, onToggle }:
  { item: Item; active: boolean; onOpen: () => void; onToggle: () => void },
) {
  const tone = itemStatus(item.status);
  const done = item.status === 'done';
  return (
    <li>
      <button
        type="button"
        className="item tone"
        style={{ '--hue': tone.hue } as React.CSSProperties}
        data-done={done ? '1' : '0'}
        aria-current={active}
        onClick={onOpen}
      >
        {/* 打勾是高频动作，单独给一个不进详情的热区 */}
        <span
          className="item-mark"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? '标为未完成' : '标为完成'}
          tabIndex={0}
          data-done={done ? '1' : '0'}
          data-glyph={GLYPH[item.status]}
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
          onKeyDown={(event) => {
            if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); onToggle(); }
          }}
        />
        <span className="item-body">
          <span className="item-title">{item.title}</span>
          {(item.detail || item.status === 'blocked') && (
            <span className="item-note">
              {item.status === 'blocked' && <span className="item-flag">阻塞 · </span>}
              {preview(item.detail)}
            </span>
          )}
        </span>
        <span style={{ color: 'var(--ink-low)', marginTop: 4, flex: 'none' }}><Chevron /></span>
      </button>
    </li>
  );
}
