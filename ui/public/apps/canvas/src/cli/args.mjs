/**
 * 参数解析。形如:board card add "标题" --status active --detail-file notes.md
 * --flag=value 和 --flag value 都认;--flag 后面没值就是 true。
 */
export function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const [name, inline] = token.slice(2).split(/=(.*)/s);
    const key = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (inline !== undefined) { options[key] = inline; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) options[key] = true;
    else { options[key] = next; i++; }
  }
  return { positional, options };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** --file <路径> 或 --stdin。给 import 这类「整块内容」的命令用。 */
export async function readInput(options) {
  if (options.file) return (await import('node:fs')).readFileSync(String(options.file), 'utf8');
  if (options.stdin) return readStdin();
  return null;
}

/** 长文本别塞命令行:--detail-file 读文件,--detail-stdin 读管道。 */
export async function longText(options, base) {
  const file = options[`${base}File`];
  const fromStdin = options[`${base}Stdin`];
  if (file) return (await import('node:fs')).readFileSync(String(file), 'utf8');
  if (fromStdin) return readStdin();
  return options[base] === undefined ? undefined : String(options[base]);
}

export const int = (value, field) => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${field} 需要一个整数,收到 "${value}"`);
  return n;
};
