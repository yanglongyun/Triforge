import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBranchPrompt, buildGeneratePrompt, resolveOrigin } from './prompt.js';

test('resolveOrigin falls back to loopback and defaults port', () => {
  const originalHost = process.env.HOST;
  const originalPort = process.env.PORT;
  try {
    delete process.env.HOST;
    delete process.env.PORT;
    assert.equal(resolveOrigin(), 'http://127.0.0.1:9519');
    process.env.HOST = '0.0.0.0';
    process.env.PORT = '4321';
    assert.equal(resolveOrigin(), 'http://127.0.0.1:4321');
    process.env.HOST = '10.0.0.5';
    assert.equal(resolveOrigin(), 'http://10.0.0.5:4321');
  } finally {
    if (originalHost === undefined) delete process.env.HOST; else process.env.HOST = originalHost;
    if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort;
  }
});

test('buildGeneratePrompt names the project, prompt, placeholders, and write endpoint', () => {
  const text = buildGeneratePrompt({
    origin: 'http://127.0.0.1:9519', projectId: 'proj-1', prompt: '三版落地页',
    count: 2, nodeIds: ['node-a', 'node-b'],
  });
  assert.match(text, /proj-1/);
  assert.match(text, /三版落地页/);
  assert.match(text, /node-a、node-b/);
  assert.match(text, /PUT http:\/\/127\.0\.0\.1:9519\/api\/nodes\/<nodeId>\/artifact/);
  assert.match(text, /artifact\/error/);
  assert.match(text, /不要新建项目/);
});

test('buildBranchPrompt names the parent node and keeps the original untouched', () => {
  const text = buildBranchPrompt({
    origin: 'http://127.0.0.1:9519', projectId: 'proj-1', nodeId: 'node-parent', nodeTitle: '方案 A',
    prompt: '改成暗色主题', count: 1, nodeIds: ['node-child'],
  });
  assert.match(text, /node-parent/);
  assert.match(text, /方案 A/);
  assert.match(text, /改成暗色主题/);
  assert.match(text, /node-child/);
  assert.match(text, /不要动原节点/);
});
