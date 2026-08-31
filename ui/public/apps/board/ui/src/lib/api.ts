import type { Card, Item, Tree } from '../types';

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((payload as { error?: string }).error ?? `请求失败 (${res.status})`, res.status);
  return payload as T;
}

const body = (data: unknown) => ({ body: JSON.stringify(data) });

export const api = {
  tree: (archived = false) => call<Tree>(`/api/board${archived ? '?archived=1' : ''}`),
  renameBoard: (name: string) => call<Tree['board']>('/api/board', { method: 'PATCH', ...body({ name }) }),

  createCard: (data: Partial<Card>) => call<Card>('/api/cards', { method: 'POST', ...body(data) }),
  updateCard: (id: number, patch: Partial<Card>) => call<Card>(`/api/cards/${id}`, { method: 'PATCH', ...body(patch) }),
  moveCard: (id: number, index: number) => call<Card>(`/api/cards/${id}/move`, { method: 'POST', ...body({ index }) }),
  deleteCard: (id: number) => call<{ ok: true }>(`/api/cards/${id}`, { method: 'DELETE' }),

  createItem: (data: Partial<Item> & { cardId: number }) => call<Item>('/api/items', { method: 'POST', ...body(data) }),
  updateItem: (id: number, patch: Partial<Item>) => call<Item>(`/api/items/${id}`, { method: 'PATCH', ...body(patch) }),
  moveItem: (id: number, to: { cardId?: number; index?: number }) =>
    call<Item>(`/api/items/${id}/move`, { method: 'POST', ...body(to) }),
  deleteItem: (id: number) => call<{ ok: true }>(`/api/items/${id}`, { method: 'DELETE' }),
};
