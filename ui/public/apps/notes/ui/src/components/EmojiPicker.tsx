import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * 页面图标选择器。
 *
 * 不引 emoji 库 —— 那些包动辄几 MB(带全量元数据和图片精灵),
 * 而这里要的只是「挑一个字符存进 pages.icon」。手写一份常用表,
 * 覆盖面足够,体积是零。
 */
const GROUPS: [string, string[]][] = [
  ['常用', ['📄', '📝', '📌', '⭐', '🔥', '✅', '💡', '🎯', '🚀', '📚', '🗂️', '🔖', '❤️', '⚡', '🌱', '🧩']],
  ['工作', ['💼', '📊', '📈', '📉', '🗓️', '⏰', '🧾', '📋', '🖇️', '🏷️', '🔧', '⚙️', '🛠️', '🧪', '🔍', '📐']],
  ['生活', ['🏠', '🍜', '☕', '🍰', '🛒', '✈️', '🚗', '🏃', '🛏️', '🎵', '🎬', '🎮', '📷', '🌙', '☀️', '🌧️']],
  ['自然', ['🌲', '🌵', '🌻', '🍀', '🍁', '🌊', '⛰️', '🌍', '🐱', '🐶', '🦊', '🐳', '🦋', '🐝', '🍎', '🍇']],
  ['符号', ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '❗', '❓', '💬', '🔒', '🔓', '♾️', '✳️', '🔺']],
];

const ALL = GROUPS.flatMap(([, list]) => list);

export function EmojiPicker({
  value, onPick, onClose,
}: { value: string; onPick: (icon: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  // 点外面、按 Esc 都关掉 —— 弹层最基本的两条,少一条都会被当成 bug
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const groups = useMemo<[string, string[]][]>(() => {
    const needle = q.trim();
    if (!needle) return GROUPS;
    // 没有关键词元数据可搜,就按字符本身过滤 —— 粘一个 emoji 进来能定位到它
    return [['结果', ALL.filter((e) => e.includes(needle))]];
  }, [q]);

  return (
    <div className="emoji-pop" ref={panel} role="dialog" aria-label="选择图标">
      <div className="emoji-head">
        <input
          className="emoji-search" autoFocus placeholder="粘一个 emoji 找它"
          value={q} onChange={(e) => setQ(e.target.value)}
        />
        {value && (
          <button type="button" className="emoji-clear" onClick={() => { onPick(''); onClose(); }}>
            移除
          </button>
        )}
      </div>
      <div className="emoji-body">
        {groups.map(([name, list]) => (
          <div key={name} className="emoji-group">
            <div className="emoji-group-name">{name}</div>
            <div className="emoji-grid">
              {list.map((e) => (
                <button
                  key={e} type="button" className="emoji-cell"
                  aria-pressed={e === value}
                  onClick={() => { onPick(e); onClose(); }}
                >{e}</button>
              ))}
            </div>
          </div>
        ))}
        {!groups.some(([, list]) => list.length) && <div className="emoji-empty">没有匹配的图标</div>}
      </div>
    </div>
  );
}
