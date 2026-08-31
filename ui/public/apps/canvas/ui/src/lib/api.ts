import type { Scene, SceneData } from '../types';

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: init?.body ? { 'content-type': 'application/json' } : undefined });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, code } = payload as { error?: string; code?: string };
    throw new ApiError(error ?? `请求失败 (${res.status})`, code ?? 'unknown', res.status);
  }
  return payload as T;
}
const body = (data: unknown) => ({ body: JSON.stringify(data) });

export const api = {
  scenes: () => call<Scene[]>('/api/scenes'),
  create: (name?: string) => call<Scene>('/api/scenes', { method: 'POST', ...body({ name }) }),
  load: (id: number) => call<SceneData>(`/api/scenes/${id}`),
  rename: (id: number, name: string) => call<Scene>(`/api/scenes/${id}`, { method: 'PATCH', ...body({ name }) }),
  remove: (id: number) => call<{ ok: true }>(`/api/scenes/${id}`, { method: 'DELETE' }),
  save: (id: number, data: {
    elements: readonly unknown[]; appState: unknown; files: unknown; version: number; origin: string;
  }) => call<{ version: number }>(`/api/scenes/${id}`, { method: 'PUT', ...body(data) }),
};
