import type { Hit, PageNode } from '../types';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: init?.body ? { 'content-type': 'application/json' } : undefined });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((payload as { error?: string }).error ?? `请求失败 (${res.status})`);
  return payload as T;
}
const body = (data: unknown) => ({ body: JSON.stringify(data) });

export const api = {
  tree: () => call<PageNode[]>('/api/tree'),
  search: (q: string) => call<Hit[]>(`/api/search?q=${encodeURIComponent(q)}`),
  create: (data: { parentId?: number | null; title?: string; index?: number }) =>
    call<PageNode>('/api/pages', { method: 'POST', ...body(data) }),
  update: (id: number, patch: { title?: string; icon?: string; cover?: string; collapsed?: boolean }) =>
    call<PageNode>(`/api/pages/${id}`, { method: 'PATCH', ...body(patch) }),
  move: (id: number, to: { parentId?: number | null; index?: number }) =>
    call<PageNode>(`/api/pages/${id}/move`, { method: 'POST', ...body(to) }),
  remove: (id: number) => call<{ ok: true }>(`/api/pages/${id}`, { method: 'DELETE' }),
};
