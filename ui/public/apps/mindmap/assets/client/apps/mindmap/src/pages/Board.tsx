import { useCallback, useEffect, useRef, useState } from 'react';

import { Toolbar } from '../components/Toolbar';
import { Outline } from '../components/Outline';
import { useMindmapEngine } from '../hooks/useMindmapEngine';
import { openMapRow, renameMap, saveAdapter, topicsOf } from '../lib/maps';
import type { Topic } from '../lib/types';

export function Board({ mapId, onBack }: { mapId: number; onBack: () => void }) {
    const [name, setName] = useState('');
    const [draftName, setDraftName] = useState('');
    const [topics, setTopics] = useState<Topic[] | null>(null);
    const [mode, setMode] = useState<'canvas' | 'outline'>('canvas');
    const [toast, setToast] = useState('');
    const toastTimer = useRef(0);

    const notify = useCallback((message: string) => {
        setToast(message);
        clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(''), 3000);
    }, []);

    useEffect(() => {
        let alive = true;
        void (async () => {
            const map = await openMapRow(mapId);
            if (!map) { onBack(); return; }
            const list = await topicsOf(mapId);
            if (!alive) return;
            if (!list.length) { notify('这张导图没有根主题,已回到列表'); onBack(); return; }
            setName(map.name);
            setDraftName(map.name);
            setTopics(list);
        })();
        return () => { alive = false; };
    }, [mapId, onBack, notify]);

    const { refs, engine, zoom, count, selected, canRemove } = useMindmapEngine(mapId, topics, notify, mode === 'canvas');

    async function commitName() {
        const next = draftName.trim();
        if (!next) { setDraftName(name); return; }
        if (next === name) return;
        await renameMap(mapId, next);
        setName(next);
    }

    async function switchMode(next: 'canvas' | 'outline') {
        if (next === mode) return;
        // 画布引擎乐观更新自己的数据。切视图前从持久层重读，确保大纲和画布一致。
        setTopics(await topicsOf(mapId));
        setMode(next);
    }

    async function patchTopic(id: number, patch: Partial<{ text: string; collapsed: boolean }>) {
        await saveAdapter(mapId).patch(id, patch);
        setTopics((current) => current?.map((topic) => topic.id === id
            ? { ...topic, ...patch, collapsed: patch.collapsed === undefined ? topic.collapsed : (patch.collapsed ? 1 : 0) }
            : topic) ?? null);
    }

    return (
        <div className="board">
            <div className="board-bar">
                <button type="button" className="icon-btn" title="回到列表" onClick={onBack}>‹</button>
                <input
                    className="board-title"
                    maxLength={120}
                    title="改名"
                    value={draftName}
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => { void commitName(); }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                        if (event.key === 'Escape') { setDraftName(name); event.currentTarget.blur(); }
                    }}
                />
                <span className="grow" />
                <span className="meta muted">{count ? `${count} 个主题` : ''}</span>
                <div className="view-switch" role="group" aria-label="查看方式">
                    <button type="button" className={mode === 'canvas' ? 'active' : ''} onClick={() => { void switchMode('canvas'); }}>画布</button>
                    <button type="button" className={mode === 'outline' ? 'active' : ''} onClick={() => { void switchMode('outline'); }}>大纲</button>
                </div>
            </div>

            <div className={`mind-grid${mode === 'canvas' ? '' : ' view-hidden'}`} ref={refs.viewport} tabIndex={mode === 'canvas' ? 0 : -1} aria-hidden={mode !== 'canvas'}>
                <div className="mind-world" ref={refs.world}>
                    <svg xmlns="http://www.w3.org/2000/svg" ref={refs.svg} />
                </div>

                <Toolbar
                    zoom={zoom}
                    canEdit={selected !== null}
                    canRemove={canRemove}
                    on={{
                        addChild: () => engine.current?.addChild(),
                        addSibling: () => engine.current?.addSibling(),
                        remove: () => engine.current?.removeSelected(),
                        zoomOut: () => engine.current?.zoomBy(1 / 1.18),
                        zoomIn: () => engine.current?.zoomBy(1.18),
                        reset: () => engine.current?.reset(),
                        fit: () => engine.current?.fit(),
                    }}
                />

                {toast ? <div className="toast">{toast}</div> : null}
            </div>
            {mode === 'outline' && topics ? <Outline topics={topics} onPatch={patchTopic} /> : null}
        </div>
    );
}
