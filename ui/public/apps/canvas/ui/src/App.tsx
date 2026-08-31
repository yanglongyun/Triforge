import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api';
import { Board, type Save } from './components/Board';
import type { Scene } from './types';

const LAST = 'canvas:last-scene';
/** 本页签的身份。自己存的那次会广播回自己，靠它认出来并忽略。 */
const ORIGIN = Math.random().toString(36).slice(2, 10);

const SAVE_LABEL: Record<Save, string> = {
  idle: '', saving: '保存中…', saved: '已保存', conflict: '正在合并别处的改动…', error: '保存失败',
};

export function App() {
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(LAST));
    return Number.isInteger(saved) && saved > 0 ? saved : null;
  });
  const [save, setSave] = useState<Save>('idle');
  const [live, setLive] = useState(false);
  const [panel, setPanel] = useState(false);

  const refresh = useCallback(async () => { setScenes(await api.scenes().catch(() => [])); }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.addEventListener('changed', (event) => {
      const reason = (JSON.parse((event as MessageEvent).data) as { reason?: string }).reason ?? '';
      void refresh();
      // 自己刚存的那次不用理会，否则会自己刷自己
      if (!reason.endsWith(`#${ORIGIN}`)) window.dispatchEvent(new Event('canvas:remote'));
    });
    return () => source.close();
  }, [refresh]);

  // 打开的画布没了（可能在别处删的），退回第一张
  useEffect(() => {
    if (!scenes) return;
    if (activeId != null && scenes.some((s) => s.id === activeId)) return;
    setActiveId(scenes[0]?.id ?? null);
  }, [scenes, activeId]);

  useEffect(() => { if (activeId != null) localStorage.setItem(LAST, String(activeId)); }, [activeId]);

  // 存盘状态提示两秒后淡出，不要一直占着
  useEffect(() => {
    if (save !== 'saved') return;
    const timer = setTimeout(() => setSave('idle'), 1800);
    return () => clearTimeout(timer);
  }, [save]);

  const active = useMemo(() => scenes?.find((s) => s.id === activeId) ?? null, [scenes, activeId]);

  const create = async () => {
    const scene = await api.create();
    await refresh();
    setActiveId(scene.id);
    setPanel(false);
  };

  return (
    <div className="app">
      <header className="bar">
        <button type="button" className="picker" onClick={() => setPanel((v) => !v)} aria-expanded={panel}>
          <span className="picker-name">{active?.name ?? 'Canvas'}</span>
          <span className="picker-caret" data-open={panel}>▾</span>
        </button>

        <span className="grow" />
        <span className={`save-state${save === 'error' ? ' bad' : ''}`}>{SAVE_LABEL[save]}</span>
        <span className="wire" data-state={live ? 'live' : 'offline'}
              title={live ? '实时同步中' : '连接断开，正在重连'}><i /></span>
      </header>

      {panel && (
        <>
          <div className="scrim" onClick={() => setPanel(false)} />
          <div className="sheet" role="dialog" aria-label="画布列表">
            <ul>
              {scenes?.map((scene) => (
                <li key={scene.id}>
                  <button type="button" data-active={scene.id === activeId}
                          onClick={() => { setActiveId(scene.id); setPanel(false); }}>
                    <span className="sheet-name">{scene.name}</span>
                    <span className="sheet-meta">{scene.element_count ?? 0} 个元素</span>
                  </button>
                  <button type="button" className="sheet-tool" aria-label="重命名"
                          onClick={async () => {
                            const next = prompt('画布名字', scene.name);
                            if (next?.trim()) { await api.rename(scene.id, next.trim()); void refresh(); }
                          }}>✎</button>
                  <button type="button" className="sheet-tool" aria-label="删除"
                          onClick={async () => {
                            if (!confirm(`删除画布「${scene.name}」？`)) return;
                            await api.remove(scene.id); void refresh();
                          }}>🗑</button>
                </li>
              ))}
            </ul>
            <button type="button" className="sheet-new" onClick={() => void create()}>＋ 新建画布</button>
          </div>
        </>
      )}

      {activeId != null ? (
        <Board key={activeId} id={activeId} origin={ORIGIN} onDirty={setSave} />
      ) : scenes ? (
        <div className="blank">
          <h2>还没有画布</h2>
          <p>建一张开始画。也可以用命令行：<code>canvas add "名字"</code></p>
          <button type="button" className="btn" onClick={() => void create()}>新建画布</button>
        </div>
      ) : <div className="board-wait">载入中…</div>}
    </div>
  );
}
