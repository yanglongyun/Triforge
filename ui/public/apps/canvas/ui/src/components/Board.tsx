import { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { api, ApiError } from '../lib/api';
import type { SceneData } from '../types';

const SAVE_DEBOUNCE = 700;

type Save = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

/**
 * 一张画布。存盘策略:
 *  - 防抖 700ms。Excalidraw 每一次指针移动都会回调,直写会把库打爆。
 *  - 乐观并发:带上读到的 version,对不上服务端拒绝。两台设备同时画时,
 *    后到的那次不会把先到的整块盖掉 —— 冲突时把对方的内容合进来再存。
 *  - 自己存的那次会广播回自己,靠 origin 认出来并忽略,否则会自己刷自己。
 */
export function Board({ id, origin, onDirty }: { id: number; origin: string; onDirty: (state: Save) => void }) {
  const [initial, setInitial] = useState<SceneData | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const version = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef(false);

  useEffect(() => {
    let alive = true;
    void api.load(id).then((data) => {
      if (!alive) return;
      version.current = data.version;
      setInitial(data);
    });
    return () => { alive = false; window.clearTimeout(timer.current); };
  }, [id]);

  const flush = useCallback(async () => {
    const excalidraw = apiRef.current;
    if (!excalidraw || !pending.current) return;
    pending.current = false;
    onDirty('saving');
    const elements = excalidraw.getSceneElements();
    const appState = excalidraw.getAppState();
    const files = excalidraw.getFiles();
    try {
      const { version: next } = await api.save(id, { elements, appState, files, version: version.current, origin });
      version.current = next;
      onDirty('saved');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conflict') {
        // 别处先存了。把服务端那份读回来,和自己手上的按 id 合并 ——
        // 同一个元素取 version 更高的那个,这是 Excalidraw 自己的调和规则。
        const remote = await api.load(id);
        const merged = new Map<string, Record<string, unknown>>();
        for (const el of remote.elements as Record<string, unknown>[]) merged.set(String(el.id), el);
        for (const el of elements as unknown as Record<string, unknown>[]) {
          const mine = el;
          const theirs = merged.get(String(mine.id));
          if (!theirs || Number(mine.version ?? 0) >= Number(theirs.version ?? 0)) merged.set(String(mine.id), mine);
        }
        version.current = remote.version;
        excalidraw.updateScene({ elements: [...merged.values()] as never });
        pending.current = true;
        onDirty('conflict');
        window.setTimeout(() => void flush(), 120);
        return;
      }
      onDirty('error');
    }
  }, [id, origin, onDirty]);

  const onChange = useCallback(() => {
    pending.current = true;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE);
  }, [flush]);

  // 离开页面前把没存的存掉 —— 手机上切走就回不来了
  useEffect(() => {
    const bail = () => { window.clearTimeout(timer.current); void flush(); };
    window.addEventListener('pagehide', bail);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bail(); });
    return () => { window.removeEventListener('pagehide', bail); bail(); };
  }, [flush]);

  /** 别处改了:把远端读回来盖上。本地有没存的改动时不盖,免得吃掉用户正在画的。 */
  const adopt = useCallback(async () => {
    if (pending.current) return;
    const data = await api.load(id);
    version.current = data.version;
    apiRef.current?.updateScene({ elements: data.elements as never });
  }, [id]);

  useEffect(() => {
    const handler = () => { void adopt(); };
    window.addEventListener('canvas:remote', handler);
    return () => window.removeEventListener('canvas:remote', handler);
  }, [adopt]);

  if (!initial) return <div className="board-wait">载入中…</div>;

  return (
    <div className="board">
      <Excalidraw
        excalidrawAPI={(instance) => { apiRef.current = instance; }}
        initialData={{
          elements: initial.elements as never,
          appState: { ...initial.appState, name: initial.scene.name } as never,
          files: initial.files as never,
          scrollToContent: true,
        }}
        onChange={onChange}
        UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
        langCode="zh-CN"
      />
    </div>
  );
}

export type { Save };
