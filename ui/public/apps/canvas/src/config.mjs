import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const APP = 'Canvas';

export function dataDir() {
  // APP_DATA_DIR 是宿主(agent-app 契约)注入的数据目录,优先于独立产品自己的 CANVAS_DATA_DIR。
  if (process.env.APP_DATA_DIR) return resolve(process.env.APP_DATA_DIR);
  if (process.env.CANVAS_DATA_DIR) return resolve(process.env.CANVAS_DATA_DIR);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', APP);
  if (process.platform === 'win32') return join(process.env.APPDATA || homedir(), APP);
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'canvas');
}

export const dbFile = () => join(dataDir(), 'canvas.db');
export const runtimeFile = () => join(dataDir(), 'runtime.json');
export const uiDir = () => join(ROOT, 'ui', 'dist');

// PORT / HOST 同理:宿主给的优先,没有宿主时退回独立产品原来的行为(CANVAS_PORT、只听回环)。
export const PORT = Number(process.env.PORT) || Number(process.env.CANVAS_PORT) || 7440;
/** 绑定地址由宿主决定;独立运行时没人指定,默认只听回环。要给手机看请在外面套隧道。 */
export const HOST = process.env.HOST || '127.0.0.1';
