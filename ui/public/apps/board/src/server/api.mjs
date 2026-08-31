import * as repo from '../store/repo.mjs';
import { BoardError } from '../store/repo.mjs';
import { broadcast, subscribe } from './events.mjs';
import { CARD_STATUSES, ITEM_STATUSES } from '../shared/status.mjs';

const MAX_BODY = 512 * 1024;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new BoardError('请求体过大', 'too_large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BoardError('请求体不是合法 JSON');
  }
}

const STATUS_FOR = { not_found: 404, too_large: 413, invalid: 400 };

/** 路由表:[方法, 路径正则, 处理函数]。参数从正则捕获组来。 */
const routes = [
  ['GET', /^\/api\/meta$/, () => ({ cardStatuses: CARD_STATUSES, itemStatuses: ITEM_STATUSES })],

  ['GET', /^\/api\/board$/, (_p, _b, url) => repo.boardTree(
    url.searchParams.get('board') ? Number(url.searchParams.get('board')) : undefined,
    { includeArchived: url.searchParams.get('archived') === '1' },
  )],
  ['PATCH', /^\/api\/board$/, async (_p, body) => repo.renameBoard(repo.defaultBoard().id, body.name)],

  ['POST', /^\/api\/cards$/, (_p, body) => repo.createCard(body)],
  ['PATCH', /^\/api\/cards\/(\d+)$/, ([id], body) => repo.updateCard(Number(id), body)],
  ['POST', /^\/api\/cards\/(\d+)\/move$/, ([id], body) => repo.moveCard(Number(id), Number(body.index))],
  ['DELETE', /^\/api\/cards\/(\d+)$/, ([id]) => { repo.deleteCard(Number(id)); return { ok: true }; }],

  ['POST', /^\/api\/items$/, (_p, body) => repo.createItem(body)],
  ['PATCH', /^\/api\/items\/(\d+)$/, ([id], body) => repo.updateItem(Number(id), body)],
  ['POST', /^\/api\/items\/(\d+)\/move$/, ([id], body) => repo.moveItem(Number(id), body)],
  ['DELETE', /^\/api\/items\/(\d+)$/, ([id]) => { repo.deleteItem(Number(id)); return { ok: true }; }],

  // CLI 写完库之后敲这一下,开着的页面就自己刷新了
  ['POST', /^\/api\/ping$/, () => ({ ok: true })],
];

const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

/** 处理一个 /api 请求。返回 false 表示这不是 API 的活,交给静态文件。 */
export async function handleApi(req, res, url) {
  if (!url.pathname.startsWith('/api/')) return false;

  if (url.pathname === '/api/events' && req.method === 'GET') {
    subscribe(res);
    return true;
  }

  const route = routes.find(([method, pattern]) => method === req.method && pattern.test(url.pathname));
  if (!route) {
    send(res, 404, { error: `没有这个接口:${req.method} ${url.pathname}` });
    return true;
  }

  const [method, pattern, handler] = route;
  try {
    const params = url.pathname.match(pattern).slice(1);
    const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(req);
    const result = await handler(params, body, url);
    if (method !== 'GET') broadcast(url.pathname);
    send(res, 200, result);
  } catch (error) {
    if (error instanceof BoardError) send(res, STATUS_FOR[error.code] ?? 400, { error: error.message, code: error.code });
    else {
      console.error('[board] 未预期的错误', error);
      send(res, 500, { error: '服务端错误', code: 'internal' });
    }
  }
  return true;
}
