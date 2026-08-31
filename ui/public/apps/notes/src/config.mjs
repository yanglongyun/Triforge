import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const APP = 'Notes';

export function dataDir() {
  // APP_DATA_DIR 是宿主(见 /apps 契约)注入的数据目录,优先于独立产品自己的 NOTES_DATA_DIR。
  if (process.env.APP_DATA_DIR) return resolve(process.env.APP_DATA_DIR);
  if (process.env.NOTES_DATA_DIR) return resolve(process.env.NOTES_DATA_DIR);
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', APP);
  if (process.platform === 'win32') return join(process.env.APPDATA || homedir(), APP);
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'notes');
}

export const dbFile = () => join(dataDir(), 'notes.db');
export const runtimeFile = () => join(dataDir(), 'runtime.json');
export const uiDir = () => join(ROOT, 'ui', 'dist');

// PORT / HOST 是宿主注入的现问变量,优先于独立产品自己的 NOTES_PORT 和写死的回环默认值。
export const PORT = Number(process.env.PORT) || Number(process.env.NOTES_PORT) || 7430;
/** 独立跑时只听回环,要给手机看请自己套隧道;被宿主拉起时听宿主指定的地址。 */
export const HOST = process.env.HOST || '127.0.0.1';
