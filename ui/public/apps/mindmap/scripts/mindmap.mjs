#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(skillDir, 'assets', 'client', 'apps', 'mindmap', 'dist');
const version = '1.0.0';
// HOST/PORT/APP_DATA_DIR：一个 agent-app 宿主会注入这三个环境变量，存在时优先；
// 不存在（独立技能用法）时落回原有默认值，行为不变。
const host = () => process.env.HOST || '127.0.0.1';

function dataDir() {
  if (process.env.APP_DATA_DIR) return resolve(process.env.APP_DATA_DIR);
  if (process.env.MINDMAP_DATA_DIR) return resolve(process.env.MINDMAP_DATA_DIR);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Mindmap Skill');
  if (process.platform === 'win32') return join(process.env.APPDATA || homedir(), 'Mindmap Skill');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'mindmap-skill');
}
const dataFile = () => join(dataDir(), 'mindmaps.json');
const runtimeFile = () => join(dataDir(), 'runtime.json');
const port = () => Number(process.env.PORT) || Number(process.env.MINDMAP_PORT) || 9521;
const url = () => `http://${host()}:${port()}`;

function readJson(path, fallback) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } }
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}
function load() { return readJson(dataFile(), { nextMapId: 1, nextTopicId: 1, maps: [], topics: [] }); }
function save(db) { writeJson(dataFile(), db); }
function now() { return Date.now(); }
function normalize(query) { return query.replace(/\s+/g, ' ').trim().toLowerCase(); }

function removeTopicTree(db, id) {
  const children = db.topics.filter((topic) => topic.parent_id === id).map((topic) => topic.id);
  for (const child of children) removeTopicTree(db, child);
  db.topics = db.topics.filter((topic) => topic.id !== id);
}

function execute(query, params = []) {
  const db = load();
  const q = normalize(query);
  let rows = [];
  let changed = false;
  if (q.includes('from app_mindmap_maps m order by')) {
    rows = [...db.maps].sort((a, b) => b.updated_at - a.updated_at).slice(0, 300).map((map) => ({ ...map, topics: db.topics.filter((topic) => topic.map_id === map.id).length }));
  } else if (q.includes('from app_mindmap_topics where map_id = ?')) {
    rows = db.topics.filter((topic) => topic.map_id === Number(params[0])).sort((a, b) => a.sort_order - b.sort_order || a.created_at - b.created_at);
  } else if (q.startsWith('select id, name from app_mindmap_maps')) {
    rows = db.maps.filter((map) => map.id === Number(params[0])).map(({ id, name }) => ({ id, name }));
  } else if (q.startsWith('insert into app_mindmap_maps')) {
    const map = { id: db.nextMapId++, name: String(params[0]), created_at: Number(params[1]), updated_at: Number(params[2]) };
    db.maps.push(map); rows = [map]; changed = true;
  } else if (q.startsWith('insert into app_mindmap_topics')) {
    const hasReturning = q.includes('returning');
    const topic = q.includes('values (?, null')
      ? { id: db.nextTopicId++, map_id: Number(params[0]), parent_id: null, text: String(params[1]), side: 'right', sort_order: 0, collapsed: 0, created_at: Number(params[2]), updated_at: Number(params[3]) }
      : { id: db.nextTopicId++, map_id: Number(params[0]), parent_id: Number(params[1]), text: String(params[2]), side: params[3] === 'left' ? 'left' : 'right', sort_order: Number(params[4]), collapsed: 0, created_at: Number(params[5]), updated_at: Number(params[6]) };
    db.topics.push(topic); rows = hasReturning ? [topic] : []; changed = true;
  } else if (q.startsWith('update app_mindmap_maps set name')) {
    const map = db.maps.find((item) => item.id === Number(params[2]));
    if (map) { map.name = String(params[0]); map.updated_at = Number(params[1]); changed = true; }
  } else if (q.startsWith('update app_mindmap_maps set updated_at')) {
    const map = db.maps.find((item) => item.id === Number(params[1]));
    if (map) { map.updated_at = Number(params[0]); changed = true; }
  } else if (q.startsWith('delete from app_mindmap_maps')) {
    const id = Number(params[0]); db.maps = db.maps.filter((map) => map.id !== id); db.topics = db.topics.filter((topic) => topic.map_id !== id); changed = true;
  } else if (q.startsWith('update app_mindmap_topics set')) {
    const id = Number(params.at(-1)); const topic = db.topics.find((item) => item.id === id);
    if (topic) {
      const clauses = q.slice(q.indexOf(' set ') + 5, q.indexOf(' where ')).split(',').map((part) => part.trim());
      let index = 0;
      for (const clause of clauses) {
        const field = clause.split('=')[0].trim();
        if (field === 'text') topic.text = String(params[index]);
        else if (field === 'collapsed') topic.collapsed = Number(params[index]);
        else if (field === 'side') topic.side = params[index] === 'left' ? 'left' : 'right';
        else if (field === 'sort_order') topic.sort_order = Number(params[index]);
        else if (field === 'updated_at') topic.updated_at = Number(params[index]);
        else if (field === 'parent_id') topic.parent_id = params[index] === null ? null : Number(params[index]);
        // 认不出来的列必须响 —— 静默忽略会让调用方以为存上了,数据却没动
        else throw new Error(`Unsupported column in UPDATE: ${field}`);
        index++;
      }
      changed = true;
    }
  } else if (q.startsWith('delete from app_mindmap_topics')) {
    removeTopicTree(db, Number(params[0])); changed = true;
  } else throw new Error(`Unsupported query: ${query}`);
  if (changed) save(db);
  return { rows, rowCount: rows.length };
}

const sdk = `export const APP='mindmap';async function call(query,params=[]){const r=await fetch('/api/sql',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query,params})});const b=await r.json();if(!r.ok)throw new Error(b.error||r.status);return b}function openRequestedMap(index,attempt=0){const card=document.querySelectorAll('.map-card')[index];if(card)return card.click();if(attempt<30)requestAnimationFrame(()=>openRequestedMap(index,attempt+1))}export const sql=call;export const rows=async(q,p=[])=>{const result=(await call(q,p)).rows||[];const requested=Number(new URLSearchParams(location.search).get('map'));if(requested&&q.includes('FROM app_mindmap_maps m')){const index=result.findIndex(row=>row.id===requested);if(index>=0)requestAnimationFrame(()=>openRequestedMap(index))}return result};export const one=async(q,p=[])=>(await rows(q,p))[0]||null;`;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
function send(res, status, body, type = 'application/json; charset=utf-8') { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); }
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }

function serve() {
  const instanceId = process.env.MINDMAP_INSTANCE_ID || randomUUID();
  createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, url()).pathname;
      if (pathname === '/health' || pathname === '/api/health') return send(res, 200, JSON.stringify({ service: 'mindmap', version, pid: process.pid, instanceId }));
      if (pathname === '/api/sql' && req.method === 'POST') { const input = await body(req); return send(res, 200, JSON.stringify(execute(input.query, input.params))); }
      if (pathname === '/sdk/chatnext.js') return send(res, 200, sdk, 'text/javascript; charset=utf-8');
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      const path = resolve(publicDir, name);
      if (!path.startsWith(`${publicDir}/`) && path !== join(publicDir, 'index.html')) return send(res, 403, 'forbidden', 'text/plain');
      if (!existsSync(path)) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, readFileSync(path), mime[extname(path)] || 'application/octet-stream');
    } catch (error) { return send(res, 400, JSON.stringify({ error: error.message })); }
  }).listen(port(), host());
}

async function health() { try { const r = await fetch(`${url()}/api/health`); return r.ok ? await r.json() : null; } catch { return null; } }
async function start() {
  if (await health()) return console.log(url());
  if (!existsSync(join(publicDir, 'index.html'))) throw new Error('Bundled Mindmap UI is missing.');
  mkdirSync(dataDir(), { recursive: true });
  const log = openSync(join(dataDir(), 'mindmap.log'), 'a');
  const instanceId = randomUUID();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '_serve'], { detached: true, env: { ...process.env, MINDMAP_INSTANCE_ID: instanceId }, stdio: ['ignore', log, log] });
  child.unref(); closeSync(log);
  for (let attempt = 0; attempt < 20; attempt++) { const ready = await health(); if (ready?.instanceId === instanceId) { writeJson(runtimeFile(), { url: url(), pid: child.pid, instanceId }); console.log(url()); return; } await delay(200); }
  throw new Error(`Mindmap failed to start. See ${join(dataDir(), 'mindmap.log')}`);
}
async function stop() { const runtime = readJson(runtimeFile(), null); if (runtime?.pid) try { process.kill(runtime.pid, 'SIGTERM'); } catch {} writeJson(runtimeFile(), { stoppedAt: new Date().toISOString() }); console.log('Mindmap stopped.'); }

function parse(values) { const positional = []; const options = {}; for (let i = 0; i < values.length; i++) { const value = values[i]; if (!value.startsWith('--')) positional.push(value); else { const key = value.slice(2); const next = values[i + 1]; if (!next || next.startsWith('--')) options[key] = true; else { options[key] = next; i++; } } } return { positional, options }; }
function input(options) { if (options.file) return readFileSync(resolve(options.file), 'utf8'); if (options.stdin) return readFileSync(0, 'utf8'); throw new Error('Use --file or --stdin.'); }
function mapTree(db, mapId) {
  const topics = db.topics.filter((topic) => topic.map_id === mapId); const byParent = new Map();
  for (const topic of topics) { const key = topic.parent_id ?? 0; if (!byParent.has(key)) byParent.set(key, []); byParent.get(key).push(topic); }
  for (const values of byParent.values()) values.sort((a, b) => a.sort_order - b.sort_order);
  const root = (byParent.get(0) || [])[0];
  const build = (topic) => ({ id: topic.id, text: topic.text, side: topic.side, collapsed: Boolean(topic.collapsed), children: (byParent.get(topic.id) || []).map(build) });
  return root ? build(root) : null;
}
function printTree(node, prefix = '', branch = '') {
  console.log(`${prefix}${branch}${node.text} [${node.id}]`);
  node.children.forEach((child, index) => {
    const last = index === node.children.length - 1;
    printTree(child, `${prefix}${branch ? (branch === '└─ ' ? '   ' : '│  ') : ''}`, last ? '└─ ' : '├─ ');
  });
}

async function cli() {
  const [group, action, idArg, ...rest] = process.argv.slice(2); const { options } = parse([idArg, ...rest].filter(Boolean));
  if (group === '_serve') return serve();
  if (group === 'start') return start();
  if (group === 'stop') return stop();
  if (group === 'doctor') { console.log(`Skill: ${skillDir}\nUI: ${existsSync(join(publicDir, 'index.html')) ? 'ready' : 'missing'}\nData: ${dataDir()}\nServer: ${(await health()) ? url() : 'stopped'}`); return; }
  const db = load();
  if (group === 'map' && action === 'list') return console.log(JSON.stringify(db.maps, null, 2));
  if (group === 'map' && action === 'create') { const stamp = now(); const map = { id: db.nextMapId++, name: options.name || '无标题导图', created_at: stamp, updated_at: stamp }; db.maps.push(map); const root = { id: db.nextTopicId++, map_id: map.id, parent_id: null, text: options.root || '中心主题', side: 'right', sort_order: 0, collapsed: 0, created_at: stamp, updated_at: stamp }; db.topics.push(root); save(db); return console.log(JSON.stringify({ ...map, rootId: root.id })); }
  if (group === 'map' && action === 'import') {
    const spec = JSON.parse(input(options)); const stamp = now(); const map = { id: db.nextMapId++, name: spec.name || '无标题导图', created_at: stamp, updated_at: stamp }; db.maps.push(map);
    const root = { id: db.nextTopicId++, map_id: map.id, parent_id: null, text: spec.root || spec.name || '中心主题', side: 'right', sort_order: 0, collapsed: 0, created_at: stamp, updated_at: stamp }; db.topics.push(root);
    const keys = new Map([['root', root.id]]); const pending = [...(spec.topics || [])];
    while (pending.length) { const index = pending.findIndex((topic) => keys.has(topic.parentKey)); if (index < 0) throw new Error('Import contains an unknown or cyclic parentKey.'); const item = pending.splice(index, 1)[0]; if (!item.key || keys.has(item.key) || !item.text) throw new Error('Every topic needs a unique key and non-empty text.'); const topic = { id: db.nextTopicId++, map_id: map.id, parent_id: keys.get(item.parentKey), text: item.text, side: item.side === 'left' ? 'left' : 'right', sort_order: Number(item.position) || 0, collapsed: 0, created_at: stamp, updated_at: stamp }; db.topics.push(topic); keys.set(item.key, topic.id); }
    save(db); return console.log(JSON.stringify({ id: map.id, rootId: root.id, url: `${url()}/?map=${map.id}` }));
  }
  const id = Number(idArg);
  if (group === 'map' && action === 'tree') { const tree = mapTree(db, id); if (!tree) throw new Error('Map not found.'); if (options.compact) printTree(tree); else console.log(JSON.stringify(tree, null, 2)); return; }
  if (group === 'map' && action === 'rename') { const map = db.maps.find((item) => item.id === id); if (!map) throw new Error('Map not found.'); map.name = options.name; map.updated_at = now(); save(db); return; }
  if (group === 'map' && action === 'delete') { db.maps = db.maps.filter((item) => item.id !== id); db.topics = db.topics.filter((topic) => topic.map_id !== id); save(db); return; }
  if (group === 'topic' && action === 'add') { const parent = db.topics.find((topic) => topic.id === Number(options.parent) && topic.map_id === Number(options.map)); if (!parent) throw new Error('Parent topic not found.'); const stamp = now(); const topic = { id: db.nextTopicId++, map_id: parent.map_id, parent_id: parent.id, text: options.text, side: options.side === 'left' ? 'left' : 'right', sort_order: Number(options.position) || 0, collapsed: 0, created_at: stamp, updated_at: stamp }; db.topics.push(topic); save(db); return console.log(JSON.stringify(topic)); }
  if (group === 'topic' && action === 'update') { const topic = db.topics.find((item) => item.id === id); if (!topic) throw new Error('Topic not found.'); if (options.parent !== undefined) { if (!topic.parent_id) throw new Error('The root topic cannot be reparented.'); const parent = db.topics.find((item) => item.id === Number(options.parent) && item.map_id === topic.map_id); if (!parent) throw new Error('Parent topic not found in this map.'); for (let walk = parent; walk; walk = db.topics.find((item) => item.id === walk.parent_id)) if (walk.id === topic.id) throw new Error('A topic cannot be moved under its own descendant.'); topic.parent_id = parent.id; topic.side = parent.parent_id ? parent.side : (options.side === 'left' ? 'left' : 'right'); const siblings = db.topics.filter((item) => item.parent_id === parent.id && item.id !== topic.id && (parent.parent_id || item.side === topic.side)); topic.sort_order = siblings.length ? Math.max(...siblings.map((item) => item.sort_order)) + 1 : 0; } if (options.text !== undefined) topic.text = options.text; if (options.collapsed !== undefined) topic.collapsed = options.collapsed === 'true' ? 1 : 0; if (options.side) topic.side = options.side === 'left' ? 'left' : 'right'; if (options.position !== undefined) topic.sort_order = Number(options.position); topic.updated_at = now(); save(db); return; }
  if (group === 'topic' && action === 'delete') { const topic = db.topics.find((item) => item.id === id); if (!topic || topic.parent_id === null) throw new Error('Topic not found or is the root.'); removeTopicTree(db, id); save(db); return; }
  console.log('Usage: mindmap.mjs start|stop|doctor | map list|create|import|tree|rename|delete | topic add|update|delete');
}

cli().catch((error) => { console.error(error.message); process.exitCode = 1; });
