import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as repo from '../store/repo.mjs';
import { NotesError } from '../store/repo.mjs';
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
  // --foreground 是宿主托管:宿主指定了 PORT,要的就是这个进程 —— 不能因为别处还有个实例在跑就借它的地址退出
  if (options.foreground) {
    const { url } = await startServer({ port: options.port ? int(options.port, '--port') : undefined });
    console.log(url);
    return { silent: true, keepAlive: true };
  }
  const existing = runningInstance();
  if (existing) return { text: existing.url, json: existing };
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
    kind: options.folder ? 'folder' : 'note',
    parentId: options.parent === undefined ? null : int(options.parent, '--parent'),
    icon: options.icon,
    index: options.index === undefined ? undefined : int(options.index, '--index'),
  });
  return { json: page, text: `${page.kind === 'folder' ? '笔记本' : '笔记'} ${page.id}:${page.title}` };
};

const pageSet = ([id], options) => {
  const patch = {};
  if (options.title !== undefined) patch.title = options.title;
  if (options.icon !== undefined) patch.icon = options.icon;
  if (options.cover !== undefined) patch.cover = options.cover;
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
// 正文就是 Markdown 文本,CLI 读写它没有任何中间层。

const pageShow = ([id]) => {
  const page = repo.getPage(int(id, 'page id'));
  if (page.kind === 'folder') {
    return { json: page, text: `${page.icon ? page.icon + ' ' : ''}${page.title} [${page.id}] —— 笔记本,没有正文` };
  }
  const body = repo.loadBody(page.id);
  return {
    json: { ...page, body },
    text: `${page.icon ? page.icon + ' ' : ''}${page.title} [${page.id}]\n\n${body || '(正文为空)'}`,
  };
};

/** 整篇覆盖。`--append` 追加,写日志类的页面用得上。 */
const pageWrite = ([id, ...rest], options) => {
  const pageId = int(id, 'page id');
  const text = options.text ?? rest.join(' ');
  if (text === undefined) throw new NotesError('要写什么?给一段文本,或用 --text');
  const next = options.append ? `${repo.loadBody(pageId)}${text}` : text;
  repo.saveBody(pageId, next);
  return { json: { id: pageId, length: next.length }, text: `页面 ${pageId} 正文已写入(${next.length} 字)` };
};

export const COMMANDS = {
  start: { run: start, mutates: false, usage: 'start [--port N] [--foreground]' },
  stop: { run: stop, mutates: false, usage: 'stop' },
  status: { run: status, mutates: false, usage: 'status' },
  doctor: { run: doctor, mutates: false, usage: 'doctor' },
  tree: { run: tree, mutates: false, usage: 'tree' },
  find: { run: find, mutates: false, usage: 'find <关键词>' },
  'page add': { run: pageAdd, mutates: true, usage: 'page add <标题> [--parent id] [--folder] [--icon emoji] [--index n]' },
  'page set': { run: pageSet, mutates: true, usage: 'page set <id> [--title t] [--icon emoji] [--cover preset:2|https://…] [--collapse true|false]' },
  'page move': { run: pageMove, mutates: true, usage: 'page move <id> [--parent id|root] [--index n]' },
  'page show': { run: pageShow, mutates: false, usage: 'page show <id>' },
  'page write': { run: pageWrite, mutates: true, usage: 'page write <id> <markdown…> [--append]' },
  'page rm': { run: pageRm, mutates: true, usage: 'page rm <id>' },
};

export { nudge };
