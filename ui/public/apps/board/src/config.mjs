import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 数据目录:按平台惯例放。宿主给的 APP_DATA_DIR 优先,其次 BOARD_DATA_DIR(测试就靠它隔离)。 */
export function dataDir() {
  if (process.env.APP_DATA_DIR) return resolve(process.env.APP_DATA_DIR);
  if (process.env.BOARD_DATA_DIR) return resolve(process.env.BOARD_DATA_DIR);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Board');
  if (process.platform === 'win32') return join(process.env.APPDATA || homedir(), 'Board');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'board');
}

export const dbFile = () => join(dataDir(), 'board.db');
export const runtimeFile = () => join(dataDir(), 'runtime.json');
export const uiDir = () => join(ROOT, 'ui', 'dist');

/** 端口:宿主给的 PORT 优先,其次 BOARD_PORT,都没有就用默认端口。 */
export const PORT = Number(process.env.PORT) || Number(process.env.BOARD_PORT) || 7420;
/** 绑定地址:宿主给的 HOST 优先,否则只听回环 —— 要给手机看请在外面套隧道,别自己改成 0.0.0.0。 */
export const HOST = process.env.HOST || '127.0.0.1';
