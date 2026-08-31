#!/usr/bin/env node
// node:sqlite 目前会打一行实验特性警告 —— 对 CLI 输出是噪音,这里静掉。
process.removeAllListeners('warning');
process.on('warning', (w) => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

const { parseArgs } = await import('../src/cli/args.mjs');
const { COMMANDS, nudge } = await import('../src/cli/commands.mjs');

const { positional, options } = parseArgs(process.argv.slice(2));

function usage() {
  const width = Math.max(...Object.values(COMMANDS).map((c) => c.usage.indexOf(' ')));
  return [
    'canvas —— 本地无限画布。基于 Excalidraw,场景存在你自己机器上,多端实时同步。',
    '',
    '用法: canvas <命令> [参数] [--选项]',
    '',
    ...Object.values(COMMANDS).map((c) => `  canvas ${c.usage}`),
    '',
    '通用选项:',
    '  --json      输出 JSON,给程序读',
    '',
    `数据目录可用 CANVAS_DATA_DIR 覆盖,端口用 CANVAS_PORT(默认 7440)。`,
  ].join('\n');
}

// 两段式命令(card add)优先于一段式(show)
const key = COMMANDS[positional.slice(0, 2).join(' ')] ? positional.slice(0, 2).join(' ') : positional[0];
const command = COMMANDS[key];

if (!command || options.help) {
  console.log(usage());
  process.exit(command ? 0 : positional.length ? 1 : 0);
}

try {
  const rest = positional.slice(key.split(' ').length);
  const result = await command.run(rest, options);
  if (command.mutates) await nudge();
  if (!result?.silent) {
    console.log(options.json ? JSON.stringify(result.json ?? { ok: true }, null, 2) : result.text ?? '');
  }
  if (!result?.keepAlive) process.exit(0);
} catch (error) {
  console.error(`canvas: ${error.message}`);
  process.exit(1);
}
