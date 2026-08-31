import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dbFile, ROOT } from '../config.mjs';

let handle = null;

/** 开库(单例)。外键必须在这里打开 —— 级联删全靠它。 */
export function db() {
  if (handle) return handle;
  const file = dbFile();
  mkdirSync(dirname(file), { recursive: true });
  handle = new DatabaseSync(file);
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA journal_mode = WAL'); // CLI 写、服务端读,两个进程要并存
  handle.exec(readFileSync(join(ROOT, 'src', 'store', 'schema.sql'), 'utf8'));
  return handle;
}

export function closeDb() {
  handle?.close();
  handle = null;
}

export const now = () => Date.now();

/** 一组写要么全成要么全不成 —— 换位置、批量导入都靠它。 */
export function tx(fn) {
  const d = db();
  d.exec('BEGIN');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (error) {
    d.exec('ROLLBACK');
    throw error;
  }
}
