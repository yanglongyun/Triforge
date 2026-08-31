import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { PageNode } from '../types';

type Connection = 'connecting' | 'live' | 'offline';

/** 树是唯一真相。SSE 只说「有东西变了」，这边重取一次 —— 不做增量合并。 */
export function useTree() {
  const [tree, setTree] = useState<PageNode[] | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try { setTree(await api.tree()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
    finally { inFlight.current = false; }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setConnection('live');
    source.onerror = () => setConnection('offline');
    source.addEventListener('changed', () => { void refresh(); });
    return () => source.close();
  }, [refresh]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  return { tree, connection, error, refresh, dismissError: () => setError(null) };
}

/** 深度优先摊平，只走展开的分支 —— 键盘上下键要用它。 */
export function flatten(nodes: PageNode[], depth = 0): { node: PageNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(node.collapsed ? [] : flatten(node.children, depth + 1)),
  ]);
}

export function findPage(nodes: PageNode[], id: number): PageNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findPage(node.children, id);
    if (hit) return hit;
  }
  return null;
}

/** 从根到该页的路径 —— 面包屑用。 */
export function trailTo(nodes: PageNode[], id: number, trail: PageNode[] = []): PageNode[] | null {
  for (const node of nodes) {
    const next = [...trail, node];
    if (node.id === id) return next;
    const hit = trailTo(node.children, id, next);
    if (hit) return hit;
  }
  return null;
}
