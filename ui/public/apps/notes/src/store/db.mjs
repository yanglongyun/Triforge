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
  seedHome(handle);
  return handle;
}

/**
 * 空库种一个「首页」笔记本,所有东西住在它下面。
 *
 * 根层不能是一堆没有归属的平级页 —— 那样「首页」就没有图标、没有封面、
 * 也没有一个能点回去的地方。这一条种下去就是用户自己的,可以改名换图标,
 * 只是删不掉(删了就没有根了)。
 */
export function seedHome(d = db()) {
  const { n } = d.prepare('SELECT COUNT(*) AS n FROM pages').get();
  if (n > 0) return;
  const t = Date.now();
  d.prepare(`INSERT INTO pages (parent_id, kind, title, icon, position, created_at, updated_at)
             VALUES (NULL, 'folder', '首页', '📚', 0, ?, ?)`).run(t, t);
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
