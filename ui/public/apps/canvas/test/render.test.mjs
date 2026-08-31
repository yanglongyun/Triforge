import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const workdir = mkdtempSync(join(tmpdir(), 'canvas-render-'));
const bundlePath = join(workdir, 'smoke.js');
let bundle;

before(() => {
  execFileSync('node_modules/.bin/esbuild', [
    'test/fixtures/smoke.tsx', '--bundle', '--format=iife', '--jsx=automatic',
    '--define:process.env.NODE_ENV="production"', '--define:process.env.IS_PREACT="false"',
    '--alias:@excalidraw/excalidraw=./test/fixtures/excalidraw-stub.tsx',
    `--outfile=${bundlePath}`,
  ], { stdio: 'pipe' });
  bundle = readFileSync(bundlePath, 'utf8');
});
after(() => rmSync(workdir, { recursive: true, force: true }));

function makeWindow() {
  const virtualConsole = new VirtualConsole();
  const fatal = [];
  virtualConsole.on('jsdomError', (error) => fatal.push(error.message.split('\n')[0]));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:7440/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  dom.fatal = fatal;
  class Dummy { addEventListener() {} removeEventListener() {} close() {} }
  window.EventSource = Dummy;
  const canned = {
    '/api/scenes': [{ id: 1, name: '一张画布', position: 1, element_count: 3, created_at: 1, updated_at: 1 }],
    '/api/scenes/1': { scene: { id: 1, name: '一张画布' }, version: 0, elements: [], appState: {}, files: {} },
  };
  window.fetch = (input) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(canned[path] ?? []) });
  };
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  return { dom, window };
}

/** React 19 的 render 是并发的，DOM 不会同步更新 —— 等几拍再看。 */
const render = async () => {
  const { dom, window } = makeWindow();
  const script = window.document.createElement('script');
  script.textContent = `${bundle}\n;window.__smoke();`;
  window.document.body.appendChild(script);
  for (let i = 0; i < 16; i++) await new Promise((r) => setTimeout(r, 25));
  // bundle 在模块初始化阶段就炸的话,__errors 根本来不及建 —— 那种致命错误走 jsdomError
  const errors = [...dom.fatal, ...Array.from(window.__errors ?? []).map(String)];
  const html = window.document.getElementById('root').innerHTML;
  dom.window.close();
  return { errors, html };
};

// 覆盖范围说明:Excalidraw 本体被替身换掉了(见 fixtures/excalidraw-stub.tsx),
// 所以这条测试保证的是「外面那一圈接线正确」,不保证画布本身画得对。
// 画布是成熟的第三方组件,风险在我的接线上。

test('App 挂载不抛错，顶栏认出当前画布，画布区被挂起来', async () => {
  const { errors, html } = await render();
  assert.equal(errors.length, 0, `挂载时抛错了：${errors.join(' | ')}`);
  assert.ok(html.length > 0, '#root 是空的 —— 白屏');
  assert.match(html, /一张画布/, '顶栏应该显示当前画布的名字');
  assert.match(html, /excalidraw-stub/, '画布区应该被挂起来 —— 否则这条测试绕开了 Board');
});
