import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { Tree } from '../types';

type Connection = 'connecting' | 'live' | 'offline';

/**
 * 整棵树 + SSE。服务端只说「有东西变了」，这边重取一次 ——
 * 不做增量合并，就没有增量合并那一类同步 bug，代价是一次很小的 GET。
 */
export function useBoard() {
  const [tree, setTree] = useState<Tree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [pulse, setPulse] = useState(0);
  const inFlight = useRef(false);

  const refresh = useCallback(async (announce = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setTree(await api.tree());
      setError(null);
      if (announce) setPulse((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setConnection('live');
    source.onerror = () => setConnection('offline'); // EventSource 自己会重连
    source.addEventListener('changed', () => { void refresh(true); });
    return () => source.close();
  }, [refresh]);

  // 页面从后台回来时补一次 —— 手机锁屏期间 SSE 多半已经断了
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  /** 乐观更新：先动本地，再发请求；失败就重取，把真相拉回来。 */
  const mutate = useCallback(async <T,>(optimistic: (current: Tree) => Tree, send: () => Promise<T>) => {
    setTree((current) => (current ? optimistic(current) : current));
    try {
      await send();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      void refresh();
    }
  }, [refresh]);

  return { tree, error, connection, pulse, refresh, mutate, dismissError: () => setError(null) };
}
