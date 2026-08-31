// SSE 广播。界面只需要知道「有东西变了」,然后自己重取一次整棵树 ——
// 不推增量,就没有增量合并的一整类同步 bug,代价是一次很小的 GET。

const clients = new Set();

export function subscribe(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no', // 前面套代理/隧道时别缓冲
  });
  res.write('retry: 2000\n\n');
  clients.add(res);
  const beat = setInterval(() => res.write(': beat\n\n'), 25_000); // 隧道会掐掉闲置连接
  const drop = () => { clearInterval(beat); clients.delete(res); };
  res.on('close', drop);
  res.on('error', drop);
}

export function broadcast(reason = 'changed') {
  const frame = `event: changed\ndata: ${JSON.stringify({ reason, at: Date.now() })}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

export const clientCount = () => clients.size;
export function closeAll() {
  for (const res of clients) { try { res.end(); } catch { /* 已经断了 */ } }
  clients.clear();
}
