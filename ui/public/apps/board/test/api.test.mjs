import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BOARD_DATA_DIR = mkdtempSync(join(tmpdir(), 'board-api-'));

const { startServer } = await import('../src/server/index.mjs');

let base;
let server;

before(async () => {
  const started = await startServer({ port: 0 }); // 0 = 让内核挑个空端口，测试不抢 7420
  server = started.server;
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  rmSync(process.env.BOARD_DATA_DIR, { recursive: true, force: true });
});

const call = async (path, init) => {
  const res = await fetch(base + path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const json = (data) => ({ body: JSON.stringify(data) });

test('GET /api/board 空看板也给出结构', async () => {
  const { status, body } = await call('/api/board');
  assert.equal(status, 200);
  assert.ok(body.board.id);
  assert.deepEqual(body.cards, []);
});

test('建卡片、建条目、整棵树读回来', async () => {
  const card = (await call('/api/cards', { method: 'POST', ...json({ title: '项目一', status: 'active' }) })).body;
  assert.equal(card.title, '项目一');
  await call('/api/items', { method: 'POST', ...json({ cardId: card.id, title: '条目一' }) });

  const tree = (await call('/api/board')).body;
  assert.equal(tree.cards.length, 1);
  assert.equal(tree.cards[0].items.length, 1);
  assert.equal(tree.cards[0].items[0].title, '条目一');
});

test('非法状态返回 400 且带人话', async () => {
  const { status, body } = await call('/api/cards', { method: 'POST', ...json({ title: 'X', status: '瞎写' }) });
  assert.equal(status, 400);
  assert.match(body.error, /status 只能是/);
});

test('不存在的资源返回 404', async () => {
  assert.equal((await call('/api/cards/99999', { method: 'PATCH', ...json({ title: 'x' }) })).status, 404);
  assert.equal((await call('/api/nope')).status, 404);
});

test('未知字段返回 400，不静默丢弃', async () => {
  const card = (await call('/api/cards', { method: 'POST', ...json({ title: '字段测试' }) })).body;
  const { status, body } = await call(`/api/cards/${card.id}`, { method: 'PATCH', ...json({ evil: 1 }) });
  assert.equal(status, 400);
  assert.match(body.error, /没有 "evil" 这个字段/);
});

test('坏 JSON 返回 400 而不是 500', async () => {
  const res = await fetch(`${base}/api/cards`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ 不是 json',
  });
  assert.equal(res.status, 400);
});

test('SSE 在写操作后推一帧', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: controller.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  await reader.read(); // retry 那一帧

  const pushed = reader.read();
  await call('/api/cards', { method: 'POST', ...json({ title: '触发推送' }) });
  const frame = new TextDecoder().decode((await pushed).value);
  assert.match(frame, /event: changed/);
  controller.abort();
});

test('目录穿越拿不到 /etc/passwd，回落到 index', async () => {
  const res = await fetch(`${base}/../../../../etc/passwd`);
  const text = await res.text();
  assert.ok(!text.includes('root:'), '绝不能把系统文件吐出来');
});

test('未构建时首页给出可操作的提示而不是 404', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});
