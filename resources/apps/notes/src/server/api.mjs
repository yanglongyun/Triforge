import * as repo from '../store/repo.mjs';
import { NotesError } from '../store/repo.mjs';
import { broadcast, subscribe } from './events.mjs';

const MAX_BODY = 256 * 1024;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new NotesError('请求体过大', 'too_large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new NotesError('请求体不是合法 JSON'); }
}

const STATUS_FOR = { not_found: 404, too_large: 413, invalid: 400 };

const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

export function makeApi() {
  const routes = [
    ['GET', /^\/api\/tree$/, () => repo.tree()],
    ['GET', /^\/api\/search$/, (_p, _b, url) => repo.search(url.searchParams.get('q'))],
    ['GET', /^\/api\/pages\/(\d+)$/, ([id]) => repo.getPage(Number(id))],
    // 正文是 Markdown 文本 —— 人、AI、grep 都能直接用
    ['GET', /^\/api\/pages\/(\d+)\/body$/, ([id]) => ({ body: repo.loadBody(Number(id)) })],
    ['PUT', /^\/api\/pages\/(\d+)\/body$/, ([id], body) => repo.saveBody(Number(id), body?.body)],
    ['POST', /^\/api\/pages$/, (_p, body) => repo.createPage(body)],
    ['PATCH', /^\/api\/pages\/(\d+)$/, ([id], body) => repo.updatePage(Number(id), body)],
    ['POST', /^\/api\/pages\/(\d+)\/move$/, ([id], body) => repo.movePage(Number(id), body)],
    ['DELETE', /^\/api\/pages\/(\d+)$/, ([id]) => {
      const pageId = Number(id);
      repo.deletePage(pageId);
      return { ok: true };
    }],
    ['POST', /^\/api\/ping$/, () => ({ ok: true })],
  ];

  return async function handleApi(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;

    if (url.pathname === '/api/events' && req.method === 'GET') { subscribe(res); return true; }

    const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
    if (!route) { send(res, 404, { error: `没有这个接口:${req.method} ${url.pathname}` }); return true; }

    const [method, pattern, handler] = route;
    try {
      const params = url.pathname.match(pattern).slice(1);
      const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(req);
      const result = await handler(params, body, url);
      if (method !== 'GET') broadcast(url.pathname);
      send(res, 200, result);
    } catch (error) {
      if (error instanceof NotesError) send(res, STATUS_FOR[error.code] ?? 400, { error: error.message, code: error.code });
      else { console.error('[notes] 未预期的错误', error); send(res, 500, { error: '服务端错误', code: 'internal' }); }
    }
    return true;
  };
}
