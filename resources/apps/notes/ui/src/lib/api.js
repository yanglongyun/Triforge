const call = async (path, init) => {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error ?? `请求失败 (${res.status})`);
  return payload;
};
const json = (data) => ({ body: JSON.stringify(data) });

export const api = {
  tree:   ()        => call('/api/tree'),
  create: (data)    => call('/api/pages', { method: 'POST', ...json(data) }),
  update: (id, p)   => call(`/api/pages/${id}`, { method: 'PATCH', ...json(p) }),
  remove: (id)      => call(`/api/pages/${id}`, { method: 'DELETE' }),
  body:   (id)      => call(`/api/pages/${id}/body`).then((r) => r.body),
  saveBody: (id, b) => call(`/api/pages/${id}/body`, { method: 'PUT', ...json({ body: b }) }),
};
