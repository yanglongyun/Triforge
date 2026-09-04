import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let bundle;

before(() => {
  // 走真实的构建链路(只把格式换成 IIFE,见 fixtures/vite.smoke.config.ts)——
  // 测的是真正的组件,不是一份手写的替身
  execFileSync('node_modules/.bin/vite',
    ['build', '--config', 'test/fixtures/vite.smoke.config.ts', '--logLevel', 'error'],
    { cwd: root, stdio: 'pipe' });
  bundle = readFileSync(join(root, 'ui/.smoke/smoke.js'), 'utf8');
});

/** 一个够用的浏览器环境。网络一律哑掉 —— 这里测的是「能不能挂起来」。 */
function makeWindow() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://127.0.0.1:7430/', runScripts: 'dangerously', pretendToBeVisual: true,
  });
  const { window } = dom;
  class Dummy {
    addEventListener() {} removeEventListener() {} close() {} send() {}
    readyState = 0;
  }
  window.EventSource = Dummy;
  // 给一棵真实形状的树,好让 App 真的走到编辑器那条路径 ——
  // 否则「没有打开的页面」会绕开它,bug 就漏过去了
  // 一棵真实形状的树:首页是笔记本,里面一篇笔记 —— 两种视图都要走到
  const canned = {
    '/api/tree': [
      { id: 1, parent_id: null, kind: 'folder', title: '首页', icon: '📚', cover: '', position: 1, collapsed: 0, updated_at: 1,
        children: [{ id: 2, parent_id: 1, kind: 'note', title: '一篇笔记', icon: '', cover: '', position: 1, collapsed: 0, updated_at: 1, children: [] }] },
    ],
    '/api/pages/2/body': { body: '# 待办\n\n- 第一条' },
  };
  window.fetch = (input) => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(canned[path] ?? []) });
  };
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.scrollTo = () => {};
  window.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  return { dom, window };
}

const settle = async (window, times = 12) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 25));
  return window.document.getElementById('app').innerHTML;
};

const mount = async () => {
  const { dom, window } = makeWindow();
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.error?.message ?? e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));
  const script = window.document.createElement('script');
  script.textContent = bundle;
  window.document.body.appendChild(script);
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 25));
  const html = await settle(window);
  const errors = Array.from(window.__errors).map(String);
  return { errors, html, window, close: () => dom.window.close() };
};

test('整个 App 挂载不抛错，落在首页(笔记本)上', async () => {
  const { errors, html, close } = await mount();
  assert.equal(errors.length, 0, `挂载时抛错了：${errors.join(' | ')}`);
  assert.ok(html.length > 0, '#app 是空的 —— 白屏');
  assert.match(html, /首页/, '标题应该渲染出来');
  assert.match(html, /一篇笔记/, '笔记本里的东西应该列出来');
  assert.match(html, /新建笔记本/, '两个创建入口:笔记本');
  assert.match(html, /新建笔记/, '两个创建入口:笔记');
  close();
});

test('笔记本没有正文编辑器 —— 它是容器,不是内容', async () => {
  const { html, close } = await mount();
  assert.doesNotMatch(html, /contenteditable/,
    '笔记本上不该挂编辑器,否则「笔记本装东西、笔记装内容」这条就名存实亡');
  close();
});

test('点进一篇笔记,编辑器才挂起来', async () => {
  const { window, close } = await mount();
  const row = Array.from(window.document.querySelectorAll('button'))
    .find((b) => b.textContent.includes('一篇笔记'));
  assert.ok(row, '笔记本里那一行应该是可点的');
  row.click();
  const html = await settle(window);
  assert.match(html, /contenteditable/, '笔记视图应该挂出正文编辑器');
  assert.match(html, /待办/, '正文应该被载入并渲染成 HTML');
  close();
});
