import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as repo from '../store/repo.mjs';
import { ROOT, dataDir, dbFile, uiDir } from '../config.mjs';
import { runningInstance, startServer } from '../server/index.mjs';
import { readInput, longText, int } from './args.mjs';

async function nudge() {
  const info = runningInstance();
  if (!info) return;
  try { await fetch(`${info.url}/api/ping`, { method: 'POST', signal: AbortSignal.timeout(800) }); } catch { /* 页面下次自己取 */ }
}

/* ---------------- 进程 ---------------- */

async function start(_p, options) {
  const existing = runningInstance();
  if (existing) return { text: existing.url, json: existing };
  if (options.foreground) {
    const { url } = await startServer({ port: options.port ? int(options.port, '--port') : undefined });
    console.log(url);
    return { silent: true, keepAlive: true };
  }
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'notes.mjs'), 'start', '--foreground',
    ...(options.port ? ['--port', String(options.port)] : [])], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (let i = 0; i < 60; i++) {
    const info = runningInstance();
    if (info) return { text: info.url, json: info };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务没能起来,跑 notes doctor 看看');
}

function stop() {
  const info = runningInstance();
  if (!info) return { text: '没有在跑的实例' };
  process.kill(info.pid, 'SIGTERM');
  return { text: `已停止 (pid ${info.pid})`, json: info };
}

const status = () => {
  const info = runningInstance();
  return info ? { text: `运行中 ${info.url} (pid ${info.pid})`, json: { running: true, ...info } }
              : { text: '未运行', json: { running: false } };
};

function doctor() {
  const built = existsSync(join(uiDir(), 'index.html'));
  const info = runningInstance();
  const lines = [
    `Node        ${process.version}`,
    `数据目录     ${dataDir()}`,
    `数据库       ${dbFile()}${existsSync(dbFile()) ? '' : ' (还没建)'}`,
    `界面构建     ${built ? '已构建' : '缺失 —— 跑 npm run setup'}`,
    `服务         ${info ? `运行中 ${info.url}` : '未运行'}`,
  ];
  try { repo.tree(); lines.push('数据库读写   正常'); }
  catch (error) { lines.push(`数据库读写   失败:${error.message}`); }
  return { text: lines.join('\n'), json: { built, running: Boolean(info) } };
}

/* ---------------- 页面 ---------------- */

const INDENT = '  ';
function renderTree(nodes, depth = 0) {
  const lines = [];
  for (const node of nodes) {
    const mark = node.children.length ? (node.collapsed ? '▸' : '▾') : '·';
    lines.push(`${INDENT.repeat(depth)}${mark} ${node.icon ? node.icon + ' ' : ''}${node.title} [${node.id}]`);
    if (node.children.length) lines.push(...renderTree(node.children, depth + 1));
  }
  return lines;
}

const tree = () => {
  const roots = repo.tree();
  return { json: roots, text: roots.length ? renderTree(roots).join('\n') : '(还没有页面,用 notes page add "标题")' };
};

const pageAdd = ([title], options) => {
  const page = repo.createPage({
    title,
    parentId: options.parent === undefined ? null : int(options.parent, '--parent'),
    icon: options.icon,
    index: options.index === undefined ? undefined : int(options.index, '--index'),
  });
  return { json: page, text: `页面 ${page.id}:${page.title}` };
};

const pageSet = ([id], options) => {
  const patch = {};
  if (options.title !== undefined) patch.title = options.title;
  if (options.icon !== undefined) patch.icon = options.icon;
  if (options.collapse !== undefined) patch.collapsed = options.collapse !== 'false' && options.collapse !== false;
  const page = repo.updatePage(int(id, 'page id'), patch);
  return { json: page, text: `页面 ${page.id} 已更新` };
};

const pageMove = ([id], options) => {
  const page = repo.movePage(int(id, 'page id'), {
    parentId: options.parent === undefined ? undefined : (options.parent === 'root' ? null : int(options.parent, '--parent')),
    index: options.index === undefined ? undefined : int(options.index, '--index'),
  });
  return { json: page, text: `页面 ${page.id} 已移动` };
};

const pageRm = ([id]) => {
  const pageId = int(id, 'page id');
  const count = repo.subtreeIds(pageId).size;
  repo.deletePage(pageId);
  return { text: `页面 ${id} 已删除${count > 1 ? `（连同 ${count - 1} 个子页）` : ''}` };
};

const find = ([query]) => {
  const hits = repo.search(query);
  return {
    json: hits,
    text: hits.length
      ? hits.map((h) => `${h.icon ? h.icon + ' ' : ''}${h.title} [${h.id}]${h.snippet ? `\n  ${h.snippet.replace(/\n/g, ' ')}` : ''}`).join('\n')
      : '没有命中',
  };
};

/* ---------------- 正文 ---------------- */
// 正文是 Yjs 文档,CLI 不直接改它 —— 那要在服务端跑一遍 ProseMirror schema。
// 想灌内容就把 Markdown 交给编辑器:CLI 负责建页,内容你在界面里写。
// 但读是安全的:落盘时抽好的纯文本镜像就在库里。

const pageShow = ([id]) => {
  const page = repo.getPage(int(id, 'page id'));
  const hit = repo.search(page.title).find((h) => h.id === page.id);
  return { json: page, text: `${page.icon ? page.icon + ' ' : ''}${page.title} [${page.id}]\n\n${hit?.snippet || '(正文为空,或还没落盘)'}` };
};

export const COMMANDS = {
  start: { run: start, mutates: false, usage: 'start [--port N] [--foreground]' },
  stop: { run: stop, mutates: false, usage: 'stop' },
  status: { run: status, mutates: false, usage: 'status' },
  doctor: { run: doctor, mutates: false, usage: 'doctor' },
  tree: { run: tree, mutates: false, usage: 'tree' },
  find: { run: find, mutates: false, usage: 'find <关键词>' },
  'page add': { run: pageAdd, mutates: true, usage: 'page add <标题> [--parent id] [--icon emoji] [--index n]' },
  'page set': { run: pageSet, mutates: true, usage: 'page set <id> [--title t] [--icon emoji] [--collapse true|false]' },
  'page move': { run: pageMove, mutates: true, usage: 'page move <id> [--parent id|root] [--index n]' },
  'page show': { run: pageShow, mutates: false, usage: 'page show <id>' },
  'page rm': { run: pageRm, mutates: true, usage: 'page rm <id>' },
};

export { nudge };
