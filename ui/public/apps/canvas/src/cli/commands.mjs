import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as repo from '../store/repo.mjs';
import { ROOT, dataDir, dbFile, uiDir } from '../config.mjs';
import { runningInstance, startServer } from '../server/index.mjs';
import { int } from './args.mjs';

async function nudge() {
  const info = runningInstance();
  if (!info) return;
  try { await fetch(`${info.url}/api/ping`, { method: 'POST', signal: AbortSignal.timeout(800) }); } catch { /* 下次自己取 */ }
}

async function start(_p, options) {
  const existing = runningInstance();
  if (existing) return { text: existing.url, json: existing };
  if (options.foreground) {
    const { url } = await startServer({ port: options.port ? int(options.port, '--port') : undefined });
    console.log(url);
    return { silent: true, keepAlive: true };
  }
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'canvas.mjs'), 'start', '--foreground',
    ...(options.port ? ['--port', String(options.port)] : [])], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  for (let i = 0; i < 60; i++) {
    const info = runningInstance();
    if (info) return { text: info.url, json: info };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务没能起来,跑 canvas doctor 看看');
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
  try { repo.listScenes(); lines.push('数据库读写   正常'); }
  catch (error) { lines.push(`数据库读写   失败:${error.message}`); }
  return { text: lines.join('\n'), json: { built, running: Boolean(info) } };
}

const when = (ms) => {
  const days = Math.round((Date.now() - ms) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  return `${days} 天前`;
};

const list = () => {
  const scenes = repo.listScenes();
  return {
    json: scenes,
    text: scenes.length
      ? scenes.map((s) => `${s.name} [${s.id}] · ${s.element_count ?? 0} 个元素 · ${when(s.updated_at)}`).join('\n')
      : '(还没有画布,用 canvas add "名字")',
  };
};

const add = ([name], options) => {
  const scene = repo.createScene({ name, index: options.index === undefined ? undefined : int(options.index, '--index') });
  return { json: scene, text: `画布 ${scene.id}:${scene.name}` };
};

const rename = ([id, name]) => {
  const scene = repo.renameScene(int(id, 'scene id'), name);
  return { json: scene, text: `画布 ${scene.id} 改名为 ${scene.name}` };
};

const rm = ([id]) => { repo.deleteScene(int(id, 'scene id')); return { text: `画布 ${id} 已删除` }; };

const show = ([id]) => {
  const data = repo.loadScene(int(id, 'scene id'));
  const kinds = new Map();
  for (const el of data.elements) kinds.set(el.type, (kinds.get(el.type) ?? 0) + 1);
  const texts = data.elements.filter((el) => el.type === 'text' && el.text).map((el) => el.text.trim()).slice(0, 12);
  return {
    json: data,
    text: [
      `${data.scene.name} [画布 ${data.scene.id}] · 版本 ${data.version}`,
      `元素:${data.elements.length ? [...kinds].map(([k, n]) => `${k} ×${n}`).join('、') : '空'}`,
      texts.length ? `\n里面的文字:\n${texts.map((t) => `  · ${t.replace(/\n/g, ' ')}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
  };
};

const prune = ([id]) => ({ text: `清理了 ${repo.pruneFiles(int(id, 'scene id'))} 张没人引用的图片` });

export const COMMANDS = {
  start: { run: start, mutates: false, usage: 'start [--port N] [--foreground]' },
  stop: { run: stop, mutates: false, usage: 'stop' },
  status: { run: status, mutates: false, usage: 'status' },
  doctor: { run: doctor, mutates: false, usage: 'doctor' },
  list: { run: list, mutates: false, usage: 'list' },
  add: { run: add, mutates: true, usage: 'add <名字> [--index n]' },
  rename: { run: rename, mutates: true, usage: 'rename <id> <新名字>' },
  show: { run: show, mutates: false, usage: 'show <id>' },
  rm: { run: rm, mutates: true, usage: 'rm <id>' },
  prune: { run: prune, mutates: true, usage: 'prune <id>' },
};

export { nudge };
