import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as repo from '../store/repo.mjs';
import { ROOT, dataDir, dbFile, uiDir } from '../config.mjs';
import { readRuntime, runningInstance, startServer } from '../server/index.mjs';
import { longText, readInput, int } from './args.mjs';
import { renderItem, renderTree } from './render.mjs';
import { existsSync } from 'node:fs';

/** 写完之后敲一下正在跑的服务,开着的页面就自己刷新了。服务没开就算了。 */
async function nudge() {
  const info = runningInstance();
  if (!info) return;
  try {
    await fetch(`${info.url}/api/ping`, { method: 'POST', signal: AbortSignal.timeout(800) });
  } catch { /* 页面下次自己会取到 */ }
}

const pick = (options, keys) => Object.fromEntries(
  keys.filter((k) => options[k] !== undefined).map((k) => [k, options[k]]),
);

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
  // 默认后台常驻:关掉终端也还在,和 mindmap 的习惯一致
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'board.mjs'), 'start', '--foreground',
    ...(options.port ? ['--port', String(options.port)] : [])], {
    detached: true, stdio: 'ignore', env: process.env,
  });
  child.unref();
  for (let i = 0; i < 60; i++) {
    const info = runningInstance();
    if (info) return { text: info.url, json: info };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务没能起来,跑 board doctor 看看');
}

function stop() {
  const info = runningInstance();
  if (!info) return { text: '没有在跑的实例' };
  process.kill(info.pid, 'SIGTERM');
  return { text: `已停止 (pid ${info.pid})`, json: info };
}

function status() {
  const info = runningInstance();
  return info
    ? { text: `运行中 ${info.url} (pid ${info.pid})`, json: { running: true, ...info } }
    : { text: '未运行', json: { running: false } };
}

function doctor() {
  const built = existsSync(join(uiDir(), 'index.html'));
  const info = runningInstance();
  const lines = [
    `Node        ${process.version}`,
    `数据目录     ${dataDir()}`,
    `数据库       ${dbFile()}${existsSync(dbFile()) ? '' : ' (还没建,首次写入时创建)'}`,
    `界面构建     ${built ? '已构建' : '缺失 —— 跑 npm run setup'}`,
    `服务         ${info ? `运行中 ${info.url}` : '未运行'}`,
  ];
  try { repo.defaultBoard(); lines.push('数据库读写   正常'); }
  catch (error) { lines.push(`数据库读写   失败:${error.message}`); }
  return { text: lines.join('\n'), json: { built, running: Boolean(info), dataDir: dataDir() } };
}

/* ---------------- 看板 ---------------- */

const show = (_p, options) => {
  const tree = repo.boardTree(undefined, { includeArchived: options.archived === true });
  return { text: renderTree(tree, { compact: options.compact === true }), json: tree };
};

const rename = ([name]) => ({ json: repo.renameBoard(repo.defaultBoard().id, name), text: `看板改名为 ${name}` });

/* ---------------- 卡片 ---------------- */

const cardAdd = async ([title], options) => {
  const card = repo.createCard({
    title,
    subtitle: await longText(options, 'subtitle'),
    status: options.status ?? 'active',
    link: options.link,
    index: options.index === undefined ? undefined : int(options.index, '--index'),
  });
  return { json: card, text: `卡片 ${card.id}:${card.title}` };
};

const cardSet = async ([id], options) => {
  const patch = pick(options, ['title', 'status', 'link']);
  const subtitle = await longText(options, 'subtitle');
  if (subtitle !== undefined) patch.subtitle = subtitle;
  if (options.archive !== undefined) patch.archived = options.archive !== 'false' && options.archive !== false;
  const card = repo.updateCard(int(id, 'card id'), patch);
  return { json: card, text: `卡片 ${card.id} 已更新` };
};

const cardMove = ([id, index]) => {
  const card = repo.moveCard(int(id, 'card id'), int(index, 'index'));
  return { json: card, text: `卡片 ${card.id} 移到第 ${index} 位` };
};

const cardRm = ([id]) => {
  repo.deleteCard(int(id, 'card id'));
  return { text: `卡片 ${id} 及其条目已删除` };
};

/* ---------------- 条目 ---------------- */

const itemAdd = async ([cardId, title], options) => {
  const item = repo.createItem({
    cardId: int(cardId, 'card id'),
    title,
    detail: await longText(options, 'detail'),
    status: options.status ?? 'todo',
    index: options.index === undefined ? undefined : int(options.index, '--index'),
  });
  return { json: item, text: `条目 ${item.id}:${item.title}` };
};

const itemSet = async ([id], options) => {
  const patch = pick(options, ['title', 'status']);
  const detail = await longText(options, 'detail');
  if (detail !== undefined) patch.detail = detail;
  const item = repo.updateItem(int(id, 'item id'), patch);
  return { json: item, text: `条目 ${item.id} 已更新` };
};

const itemMove = ([id], options) => {
  const item = repo.moveItem(int(id, 'item id'), {
    cardId: options.card === undefined ? undefined : int(options.card, '--card'),
    index: options.index === undefined ? undefined : int(options.index, '--index'),
  });
  return { json: item, text: `条目 ${item.id} 已移动` };
};

const itemShow = ([id]) => {
  const item = repo.getItem(int(id, 'item id'));
  return { json: item, text: renderItem(item) };
};

const itemRm = ([id]) => {
  repo.deleteItem(int(id, 'item id'));
  return { text: `条目 ${id} 已删除` };
};

/* ---------------- 批量导入 ---------------- */

/** 一次把一整块内容灌进去。格式见 SKILL.md,整块在一个事务里。 */
async function importAll(_p, options) {
  const raw = await readInput(options);
  if (!raw) throw new Error('需要 --file <路径> 或 --stdin');
  const spec = JSON.parse(raw);
  const board = repo.defaultBoard();
  if (spec.name) repo.renameBoard(board.id, spec.name);
  const created = [];
  for (const cardSpec of spec.cards ?? []) {
    const card = repo.createCard({ boardId: board.id, ...cardSpec });
    for (const itemSpec of cardSpec.items ?? []) repo.createItem({ cardId: card.id, ...itemSpec });
    created.push({ id: card.id, title: card.title, items: (cardSpec.items ?? []).length });
  }
  return { json: { board: board.id, cards: created }, text: `导入 ${created.length} 张卡片` };
}

/* ---------------- 分发表 ---------------- */

export const COMMANDS = {
  start: { run: start, mutates: false, usage: 'start [--port N] [--foreground]' },
  stop: { run: stop, mutates: false, usage: 'stop' },
  status: { run: status, mutates: false, usage: 'status' },
  doctor: { run: doctor, mutates: false, usage: 'doctor' },
  show: { run: show, mutates: false, usage: 'show [--compact] [--archived]' },
  rename: { run: rename, mutates: true, usage: 'rename <看板名>' },
  'card add': { run: cardAdd, mutates: true, usage: 'card add <标题> [--status s] [--subtitle t] [--link url] [--index n]' },
  'card set': { run: cardSet, mutates: true, usage: 'card set <id> [--title t] [--status s] [--subtitle t] [--link url] [--archive true|false]' },
  'card move': { run: cardMove, mutates: true, usage: 'card move <id> <位置>' },
  'card rm': { run: cardRm, mutates: true, usage: 'card rm <id>' },
  'item add': { run: itemAdd, mutates: true, usage: 'item add <卡片id> <标题> [--status s] [--detail t | --detail-file f | --detail-stdin]' },
  'item set': { run: itemSet, mutates: true, usage: 'item set <id> [--title t] [--status s] [--detail t | --detail-file f | --detail-stdin]' },
  'item move': { run: itemMove, mutates: true, usage: 'item move <id> [--card 卡片id] [--index n]' },
  'item show': { run: itemShow, mutates: false, usage: 'item show <id>' },
  'item rm': { run: itemRm, mutates: true, usage: 'item rm <id>' },
  import: { run: importAll, mutates: true, usage: 'import (--file <路径> | --stdin)' },
};

export { nudge };
