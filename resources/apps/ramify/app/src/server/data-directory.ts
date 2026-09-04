import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { platform } from 'node:process';

function resolveDataDirectory() {
  // APP_DATA_DIR 是应用契约(宿主环境变量)里的数据目录，宿主已经建好目录，优先级最高；
  // RAMIFY_DATA_DIR 是本项目作为独立 Skill 运行时自己的覆盖变量，两者不冲突，按此顺序取。
  if (process.env.APP_DATA_DIR) return process.env.APP_DATA_DIR;
  if (process.env.RAMIFY_DATA_DIR) return process.env.RAMIFY_DATA_DIR;
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Ramify');
  if (platform === 'win32') return join(process.env.APPDATA || homedir(), 'Ramify');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'ramify');
}

export const dataDirectory = resolveDataDirectory();
mkdirSync(dataDirectory, { recursive: true });
