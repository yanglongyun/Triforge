import { useEffect, useRef, useState } from 'react';

/**
 * 页面封面。
 *
 * 存的是一个字符串:`gradient:<名>` 用内置渐变,`http(s)://…` 当图片地址。
 * **不做上传** —— 那要一整套文件存储、配额和清理,而封面的价值几乎全在
 * 「一眼把这页和别的页分开」,渐变已经够了;真要图,粘个网址就行。
 */
export const GRADIENTS: Record<string, string> = {
  dawn: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  dusk: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  moss: 'linear-gradient(135deg, #43cea2 0%, #185a9d 100%)',
  ember: 'linear-gradient(135deg, #f83600 0%, #f9d423 100%)',
  slate: 'linear-gradient(135deg, #4b6cb7 0%, #182848 100%)',
  bloom: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  citrus: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
  deep: 'linear-gradient(135deg, #0f2027 0%, #2c5364 100%)',
};

const NAMES = Object.keys(GRADIENTS);

/** 把存下来的值翻成一个能直接塞进 style 的背景。认不出来就当没有。 */
export const coverStyle = (cover: string) => {
  if (!cover) return null;
  if (cover.startsWith('gradient:')) {
    const bg = GRADIENTS[cover.slice(9)];
    return bg ? { backgroundImage: bg } : null;
  }
  if (/^https?:\/\//i.test(cover)) {
    return { backgroundImage: `url("${cover.replace(/"/g, '%22')}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return null;
};

export function Cover({ cover, onChange }: { cover: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(false);
  const style = coverStyle(cover);
  if (!style) return null;
  return (
    <div className="cover" style={style}>
      <div className="cover-actions">
        <button type="button" onClick={() => setOpen(true)}>更换封面</button>
        <button type="button" onClick={() => onChange('')}>移除</button>
      </div>
      {open && <CoverPicker cover={cover} onPick={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}

export function CoverPicker({
  cover, onPick, onClose,
}: { cover: string; onPick: (next: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState(/^https?:\/\//i.test(cover) ? cover : '');
  const panel = useRef<HTMLDivElement>(null);

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

  const submit = () => {
    const next = url.trim();
    if (!next) return;
    if (!/^https?:\/\//i.test(next)) return;
    onPick(next);
    onClose();
  };

  return (
    <div className="cover-pop" ref={panel} role="dialog" aria-label="选择封面">
      <div className="cover-grid">
        {NAMES.map((name) => (
          <button
            key={name} type="button" className="cover-swatch"
            style={{ backgroundImage: GRADIENTS[name] }}
            aria-label={name} aria-pressed={cover === `gradient:${name}`}
            onClick={() => { onPick(`gradient:${name}`); onClose(); }}
          />
        ))}
      </div>
      <div className="cover-url">
        <input
          placeholder="或粘一个图片网址 https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
        />
        <button type="button" onClick={submit} disabled={!/^https?:\/\//i.test(url.trim())}>用它</button>
      </div>
    </div>
  );
}
