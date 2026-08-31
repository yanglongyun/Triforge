#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const skillDirectory = resolve(scriptsDirectory, '..');
const appDirectory = join(skillDirectory, 'app');
const serverEntry = join(appDirectory, 'dist', 'server.mjs');
const uiEntry = join(appDirectory, 'dist', 'public', 'index.html');
const version = JSON.parse(readFileSync(join(appDirectory, 'package.json'), 'utf8')).version;
const HELP = `Ramify ${version}

Usage:
  ramify.mjs start|stop|doctor|setup
  ramify.mjs theme [light|dark|system]
  ramify.mjs language [zh-CN|en|ja|es|de]
  ramify.mjs project list
  ramify.mjs project create (--prompt <text>|--file <path>|--stdin) [--title <text>]
  ramify.mjs project tree <project-id> [--compact]
  ramify.mjs project rename <project-id> --title <text> [--expected-updated-at <timestamp>]
  ramify.mjs project delete <project-id>
  ramify.mjs node add --project <id> --parent <id> --title <text> [--content <text>] [--artifact-type <type>] [--file <path>|--stdin]
  ramify.mjs node batch --project <id> (--file <path>|--stdin)
  ramify.mjs node complete <node-id> --artifact-type <type> (--file <path>|--stdin|--artifact <text>)
  ramify.mjs node update <node-id> [--title <text>] [--content <text>] [--parent <id>] [--position <n>]
  ramify.mjs node error <node-id> (--message <text>|--file <path>|--stdin)
  ramify.mjs node clear-artifact <node-id>
  ramify.mjs node delete <node-id>

Environment:
  RAMIFY_PORT, RAMIFY_HOST, RAMIFY_DATA_DIR
`;

function dataDirectory() {
  if (process.env.RAMIFY_DATA_DIR) return process.env.RAMIFY_DATA_DIR;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Ramify');
  if (process.platform === 'win32') return join(process.env.APPDATA || homedir(), 'Ramify');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'ramify');
}

const runtimeFile = () => join(dataDirectory(), 'runtime.json');

function readRuntime() {
  try { return JSON.parse(readFileSync(runtimeFile(), 'utf8')); } catch { return null; }
}

function writeRuntime(runtime) {
  mkdirSync(dataDirectory(), { recursive: true });
  writeFileSync(runtimeFile(), `${JSON.stringify(runtime, null, 2)}\n`);
}

function resolvePort() {
  return Number(process.env.RAMIFY_PORT) || Number(readRuntime()?.port) || 9519;
}

function resolveHost() {
  return process.env.RAMIFY_HOST || '0.0.0.0';
}

function stoppedRuntime(runtime) {
  return {
    url: runtime.url,
    host: runtime.host,
    port: runtime.port,
    pid: null,
    instanceId: null,
    stoppedAt: new Date().toISOString(),
    version,
  };
}

function ensureRuntime() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    throw new Error(`Ramify requires Node.js 22.5 or newer; found ${process.versions.node}.`);
  }
  if (!existsSync(serverEntry) || !existsSync(uiEntry)) {
    throw new Error('Ramify runtime is incomplete. Reinstall or update the skill.');
  }
}

async function health(url) {
  try {
    const response = await fetch(`${url}/api/health`);
    const body = await response.json();
    return response.ok && body.service === 'ramify' ? body : null;
  } catch {
    return null;
  }
}

async function start({ quiet = false } = {}) {
  ensureRuntime();
  const stored = readRuntime();
  const hasAddressOverride = Boolean(process.env.RAMIFY_PORT || process.env.RAMIFY_HOST);
  const overrideMatches = !hasAddressOverride || (
    (!process.env.RAMIFY_PORT || Number(process.env.RAMIFY_PORT) === stored?.port)
    && (!process.env.RAMIFY_HOST || process.env.RAMIFY_HOST === stored?.host)
  );
  if (stored?.url && !overrideMatches) {
    const previous = await health(stored.url);
    if (previous && previous.instanceId !== stored.instanceId) {
      throw new Error(`Refusing to replace runtime state: ${stored.url} belongs to a different Ramify instance.`);
    }
    if (previous?.instanceId && previous.instanceId === stored.instanceId && previous.pid === stored.pid) {
      try { process.kill(stored.pid, 'SIGTERM'); } catch {}
    }
  }
  if (stored?.url && overrideMatches) {
    const current = await health(stored.url);
    if (current && (!stored.instanceId || stored.instanceId === current.instanceId)) {
      if (!stored.instanceId) {
        writeRuntime({
          ...stored,
          pid: current.pid,
          instanceId: current.instanceId,
          startedAt: new Date().toISOString(),
          stoppedAt: undefined,
          version: current.version,
        });
      }
      if (!quiet) console.log(stored.url);
      return stored.url;
    }
  }

  const port = resolvePort();
  const host = resolveHost();
  const clientHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const url = `http://${clientHost}:${port}`;
  const occupied = await health(url);
  if (occupied) {
    writeRuntime({ url, host, port, pid: occupied.pid, instanceId: occupied.instanceId, startedAt: new Date().toISOString(), version: occupied.version });
    if (!quiet) console.log(url);
    return url;
  }

  const data = dataDirectory();
  const instanceId = randomUUID();
  mkdirSync(data, { recursive: true });
  const log = openSync(join(data, 'ramify.log'), 'a');
  const child = spawn(process.execPath, [serverEntry], {
    cwd: appDirectory,
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: host,
      RAMIFY_APP_DIR: appDirectory,
      RAMIFY_DATA_DIR: data,
      RAMIFY_INSTANCE_ID: instanceId,
      RAMIFY_VERSION: version,
    },
    stdio: ['ignore', log, log],
  });
  child.unref();
  closeSync(log);

  for (let attempt = 0; attempt < 20; attempt++) {
    const ready = await health(url);
    if (ready?.instanceId === instanceId) {
      writeRuntime({ url, host, port, pid: child.pid, instanceId, startedAt: new Date().toISOString(), version });
      if (!quiet) console.log(url);
      return url;
    }
    await delay(250);
  }

  try { process.kill(child.pid, 'SIGTERM'); } catch {}
  throw new Error(`Ramify failed to start. See ${join(data, 'ramify.log')}`);
}

async function stop() {
  const runtime = readRuntime();
  if (!runtime) {
    console.log('Ramify is not running.');
    return;
  }
  const current = await health(runtime.url);
  if (current && current.instanceId && current.instanceId === runtime.instanceId && current.pid === runtime.pid) {
    try { process.kill(runtime.pid, 'SIGTERM'); } catch {}
    writeRuntime(stoppedRuntime(runtime));
    console.log('Ramify stopped.');
    return;
  }
  writeRuntime(stoppedRuntime(runtime));
  console.log('Cleared stale Ramify process state; saved network settings were kept and no process was killed.');
}

async function doctor() {
  const runtime = readRuntime();
  const host = resolveHost();
  const clientHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const url = process.env.RAMIFY_PORT || process.env.RAMIFY_HOST
    ? `http://${clientHost}:${resolvePort()}`
    : runtime?.url || `http://${clientHost}:${resolvePort()}`;
  const current = await health(url);
  console.log(`Skill:  ${skillDirectory}`);
  console.log(`Node:   v${process.versions.node}`);
  console.log(`Ramify: v${version}`);
  console.log(`UI:     ${existsSync(uiEntry) ? 'ready' : 'missing'}`);
  console.log(`API:    ${existsSync(serverEntry) ? 'ready' : 'missing'}`);
  console.log(`Data:   ${dataDirectory()}`);
  console.log(`Server: ${current ? `running at ${url} (${current.instanceId || 'untracked'})` : 'stopped'}`);
}

function parseArgs(values) {
  const options = {};
  const positional = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const name = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith('--')) options[name] = true;
    else { options[name] = next; index++; }
  }
  return { options, positional };
}

function textOption(options, name, { required = false } = {}) {
  const value = options[name];
  if (required && typeof value !== 'string') throw new Error(`--${name} is required`);
  return typeof value === 'string' ? value : undefined;
}

function inputText(options, directName = 'content') {
  const sources = [typeof options.file === 'string', options.stdin === true, typeof options[directName] === 'string'].filter(Boolean).length;
  if (sources > 1) throw new Error(`Use only one of --file, --stdin, or --${directName}.`);
  if (typeof options.file === 'string') return readFileSync(resolve(options.file), 'utf8');
  if (options.stdin === true) return readFileSync(0, 'utf8');
  return typeof options[directName] === 'string' ? options[directName] : undefined;
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  const baseUrl = await start({ quiet: true });
  const attempts = method === 'GET' ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('application/json') ? await response.json() : await response.text();
      if (!response.ok) {
        const message = typeof result === 'object' && result ? `${result.code || 'REQUEST_FAILED'}: ${result.error}` : `HTTP ${response.status}`;
        const error = new Error(message);
        error.retryable = response.status >= 500;
        throw error;
      }
      return result;
    } catch (error) {
      if (attempt + 1 < attempts && (error.retryable || error instanceof TypeError)) { await delay(200); continue; }
      throw error;
    }
  }
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function projectCommand(action, values) {
  const { options, positional } = parseArgs(values);
  if (action === 'list') return print(await apiRequest('/api/projects'));
  if (action === 'create') {
    const prompt = inputText(options, 'prompt');
    if (!prompt?.trim()) throw new Error('Provide --prompt, --file, or --stdin.');
    return print(await apiRequest('/api/projects', { method: 'POST', body: { prompt, title: textOption(options, 'title') } }));
  }
  const projectId = positional[0];
  if (!projectId) throw new Error(`project ${action} requires a project id`);
  if (action === 'tree') {
    const tree = await apiRequest(`/api/projects/${projectId}/tree`);
    if (!options.compact) return print(tree);
    const depth = new Map();
    for (const node of tree.nodes) {
      depth.set(node.id, node.parent_id ? (depth.get(node.parent_id) || 0) + 1 : 0);
      const state = ['html', 'markdown', 'svg', 'image', 'video', 'audio'].includes(node.type)
        ? node.content ? 'ready' : 'generating'
        : node.type === 'error' ? 'failed' : node.content ? 'content' : 'title';
      console.log(`${'  '.repeat(depth.get(node.id))}#${node.seq} ${node.id} [${node.type}/${state}] ${node.title}`);
    }
    return;
  }
  if (action === 'rename') {
    return print(await apiRequest(`/api/projects/${projectId}`, { method: 'PUT', body: {
      title: textOption(options, 'title', { required: true }),
      expectedUpdatedAt: textOption(options, 'expected-updated-at'),
    } }));
  }
  if (action === 'delete') return print(await apiRequest(`/api/projects/${projectId}`, { method: 'DELETE' }));
  throw new Error('Usage: project <list|create|tree|rename|delete>');
}

async function nodeCommand(action, values) {
  const { options, positional } = parseArgs(values);
  if (action === 'add') {
    const projectId = textOption(options, 'project', { required: true });
    const artifactType = textOption(options, 'artifact-type');
    const artifact = inputText(options, 'artifact');
    const body = {
      parentId: textOption(options, 'parent', { required: true }),
      title: textOption(options, 'title', { required: true }),
      content: textOption(options, 'content'),
      position: options.position === undefined ? undefined : Number(options.position),
      artifactType, artifact,
    };
    return print(await apiRequest(`/api/projects/${projectId}/nodes`, { method: 'POST', body }));
  }
  if (action === 'batch') {
    const projectId = textOption(options, 'project', { required: true });
    const source = inputText(options);
    if (!source) throw new Error('Provide --file, --stdin, or --content with batch JSON.');
    const body = JSON.parse(source);
    return print(await apiRequest(`/api/projects/${projectId}/nodes/batch`, { method: 'POST', body }));
  }
  const nodeId = positional[0];
  if (!nodeId) throw new Error(`node ${action} requires a node id`);
  const expectedUpdatedAt = textOption(options, 'expected-updated-at');
  if (action === 'complete') {
    const artifact = inputText(options, 'artifact');
    if (!artifact?.trim()) throw new Error('Provide --file, --stdin, or --artifact.');
    return print(await apiRequest(`/api/nodes/${nodeId}/artifact`, { method: 'PUT', body: {
      artifact, artifactType: textOption(options, 'artifact-type', { required: true }), expectedUpdatedAt,
    } }));
  }
  if (action === 'error') {
    const error = inputText(options, 'message');
    if (!error?.trim()) throw new Error('Provide --message, --file, or --stdin.');
    return print(await apiRequest(`/api/nodes/${nodeId}/artifact/error`, { method: 'PUT', body: { error, expectedUpdatedAt } }));
  }
  if (action === 'update') {
    return print(await apiRequest(`/api/nodes/${nodeId}`, { method: 'PUT', body: {
      title: textOption(options, 'title'), content: textOption(options, 'content'),
      parentId: textOption(options, 'parent'),
      position: options.position === undefined ? undefined : Number(options.position), expectedUpdatedAt,
    } }));
  }
  if (action === 'clear-artifact') return print(await apiRequest(`/api/nodes/${nodeId}/artifact`, { method: 'DELETE' }));
  if (action === 'delete') return print(await apiRequest(`/api/nodes/${nodeId}`, { method: 'DELETE' }));
  throw new Error('Usage: node <add|batch|complete|error|update|clear-artifact|delete>');
}

async function themeCommand(theme) {
  if (theme === undefined) return print(await apiRequest('/api/settings'));
  if (!['light', 'dark', 'system'].includes(theme)) throw new Error('Usage: theme <light|dark|system>');
  return print(await apiRequest('/api/settings/theme', { method: 'PUT', body: { theme } }));
}

async function languageCommand(locale) {
  if (locale === undefined) return print(await apiRequest('/api/settings'));
  if (!['zh-CN', 'en', 'ja', 'es', 'de'].includes(locale)) throw new Error('Usage: language <zh-CN|en|ja|es|de>');
  return print(await apiRequest('/api/settings/locale', { method: 'PUT', body: { locale } }));
}

const [command = 'start', action, ...values] = process.argv.slice(2);
try {
  if (command === 'help' || command === '--help' || command === '-h') console.log(HELP);
  else if (command === 'version' || command === '--version' || command === '-v') console.log(version);
  else if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'doctor') await doctor();
  else if (command === 'setup') { ensureRuntime(); console.log('Ramify runtime is ready.'); }
  else if (command === 'theme') await themeCommand(action);
  else if (command === 'language') await languageCommand(action);
  else if (command === 'project') await projectCommand(action, values);
  else if (command === 'node') await nodeCommand(action, values);
  else throw new Error('Usage: ramify.mjs <start|stop|doctor|setup|theme|language|project|node>');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
