import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CANVAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'canvas-api-'));
const { startServer } = await import('../src/server/index.mjs');

let base; let close;

before(async () => {
  const started = await startServer({ port: 0 });
  close = started.close;
  base = started.url.replace(/:\d+$/, `:${started.port}`);
});
after(() => { close?.(); rmSync(process.env.CANVAS_DATA_DIR, { recursive: true, force: true }); });

const call = async (path, init) => {
  const res = await fetch(base + path, { ...init, headers: init?.body ? { 'content-type': 'application/json' } : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const json = (data) => ({ body: JSON.stringify(data) });

test('新建画布自带一份空内容', async () => {
  const scene = (await call('/api/scenes', { method: 'POST', ...json({ name: '第一张' }) })).body;
  const loaded = (await call(`/api/scenes/${scene.id}`)).body;
  assert.equal(loaded.version, 0);
  assert.deepEqual(loaded.elements, []);
});

test('存取一轮，元素原样回来', async () => {
  const scene = (await call('/api/scenes', { method: 'POST', ...json({}) })).body;
  const elements = [{ id: 'a', type: 'rectangle', x: 1, y: 2, version: 3 }];
  const saved = await call(`/api/scenes/${scene.id}`, { method: 'PUT', ...json({ elements, appState: {}, files: {}, version: 0 }) });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, 1);
  assert.deepEqual((await call(`/api/scenes/${scene.id}`)).body.elements, elements);
});

test('版本对不上返回 409，不静默覆盖', async () => {
  const scene = (await call('/api/scenes', { method: 'POST', ...json({}) })).body;
  await call(`/api/scenes/${scene.id}`, { method: 'PUT', ...json({ elements: [{ id: 'a' }], appState: {}, version: 0 }) });
  const stale = await call(`/api/scenes/${scene.id}`, { method: 'PUT', ...json({ elements: [], appState: {}, version: 0 }) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'conflict');
  assert.equal((await call(`/api/scenes/${scene.id}`)).body.elements.length, 1, '先到的那份不该被冲掉');
});

test('appState 只留视图相关的键', async () => {
  const scene = (await call('/api/scenes', { method: 'POST', ...json({}) })).body;
  await call(`/api/scenes/${scene.id}`, { method: 'PUT', ...json({
    elements: [], version: 0, files: {},
    appState: { scrollX: 5, zoom: { value: 2 }, activeTool: '不该存', selectedElementIds: { a: true }, openMenu: 'x' },
  }) });
  const back = (await call(`/api/scenes/${scene.id}`)).body.appState;
  assert.deepEqual(Object.keys(back).sort(), ['scrollX', 'zoom']);
});

test('图片按 fileId 存，重复存不会翻倍', async () => {
  const scene = (await call('/api/scenes', { method: 'POST', ...json({}) })).body;
  const files = { f1: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AA' } };
  await call(`/api/scenes/${scene.id}`, { method: 'PUT', ...json({ elements: [{ id: 'i', fileId: 'f1' }], appState: {}, files, version: 0 }) });
  await call(`/api/scenes/${scene.id}`, { method: 'PUT', ...json({ elements: [{ id: 'i', fileId: 'f1' }], appState: {}, files, version: 1 }) });
  assert.deepEqual(Object.keys((await call(`/api/scenes/${scene.id}`)).body.files), ['f1']);
});

test('prune 回收没人引用的图', async () => {
  const scene = (await call('/api/scenes', { method: 'POST', ...json({}) })).body;
  await call(`/api/scenes/${scene.id}`, { method: 'PUT', ...json({
    elements: [{ id: 'i', fileId: 'keep' }], appState: {}, version: 0,
    files: { keep: { a: 1 }, gone: { b: 2 } },
  }) });
  assert.equal((await call(`/api/scenes/${scene.id}/prune`, { method: 'POST', ...json({}) })).body.removed, 1);
  assert.deepEqual(Object.keys((await call(`/api/scenes/${scene.id}`)).body.files), ['keep']);
});

test('删画布连带删内容和图', async () => {
  const scene = (await call('/api/scenes', { method: 'POST', ...json({}) })).body;
  await call(`/api/scenes/${scene.id}`, { method: 'DELETE' });
  assert.equal((await call(`/api/scenes/${scene.id}`)).status, 404);
});

test('elements 不是数组要拒绝', async () => {
  const scene = (await call('/api/scenes', { method: 'POST', ...json({}) })).body;
  const bad = await call(`/api/scenes/${scene.id}`, { method: 'PUT', ...json({ elements: '不是数组', appState: {}, version: 0 }) });
  assert.equal(bad.status, 400);
});

test('目录穿越拿不到系统文件', async () => {
  const text = await (await fetch(`${base}/../../../../etc/passwd`)).text();
  assert.ok(!text.includes('root:'));
});
