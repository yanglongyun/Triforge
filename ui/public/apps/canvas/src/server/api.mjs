import * as repo from '../store/repo.mjs';
import { CanvasError } from '../store/repo.mjs';
import { broadcast, subscribe } from './events.mjs';

const MAX_BODY = 24 * 1024 * 1024; // 画布里能贴图,给足

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new CanvasError('画布内容过大', 'too_large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new CanvasError('请求体不是合法 JSON'); }
}

const STATUS_FOR = { not_found: 404, too_large: 413, conflict: 409, invalid: 400 };

const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

const routes = [
  ['GET', /^\/api\/scenes$/, () => repo.listScenes()],
  ['POST', /^\/api\/scenes$/, (_p, body) => repo.createScene(body)],
  ['GET', /^\/api\/scenes\/(\d+)$/, ([id]) => repo.loadScene(Number(id))],
  ['PATCH', /^\/api\/scenes\/(\d+)$/, ([id], body) => repo.renameScene(Number(id), body.name)],
  ['PUT', /^\/api\/scenes\/(\d+)$/, ([id], body) => repo.saveScene(Number(id), body)],
  ['DELETE', /^\/api\/scenes\/(\d+)$/, ([id]) => { repo.deleteScene(Number(id)); return { ok: true }; }],
  ['POST', /^\/api\/scenes\/(\d+)\/prune$/, ([id]) => ({ removed: repo.pruneFiles(Number(id)) })],
  ['POST', /^\/api\/ping$/, () => ({ ok: true })],
];

export async function handleApi(req, res, url) {
  if (!url.pathname.startsWith('/api/')) return false;
  if (url.pathname === '/api/events' && req.method === 'GET') { subscribe(res); return true; }

  const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
  if (!route) { send(res, 404, { error: `没有这个接口:${req.method} ${url.pathname}` }); return true; }

  const [method, pattern, handler] = route;
  try {
    const params = url.pathname.match(pattern).slice(1);
    const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(req);
    const result = await handler(params, body, url);
    // 存内容时把写入者的标识一起广播 —— 它自己就不用再重取一次
    if (method !== 'GET') broadcast(body?.origin ? `${url.pathname}#${body.origin}` : url.pathname);
    send(res, 200, result);
  } catch (error) {
    if (error instanceof CanvasError) send(res, STATUS_FOR[error.code] ?? 400, { error: error.message, code: error.code });
    else { console.error('[canvas] 未预期的错误', error); send(res, 500, { error: '服务端错误', code: 'internal' }); }
  }
  return true;
}
