// 应用私有数据库:一应用一个 SQLite 文件,就放在应用目录里(apps/<id>/data.db)。
//
// 为什么不放系统数据目录:那样 AI 和用户都摸不到。放在应用旁边,`sqlite3 apps/xx/data.db`
// 一句话就能查 schema、改数据、修迁移 —— "AI 能管自己造的应用"这件事才成立。
// 为什么不用 workerd 的 DO 存储:它的文件按 DO id 哈希命名,同样摸不到(见 APP.md)。
//
// 应用侧看到的是 D1 接口(env.DB.prepare(...).bind(...).all()),这里是它的执行端。
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { appDbPath } from "./apps.js";

const MAX_DB_BYTES = 200 * 1024 * 1024; // 单库上限:失控膨胀保险丝
const opened = new Map<string, DatabaseSync>();

const dbFor = (appId: string) => {
  const existing = opened.get(appId);
  if (existing) return existing;
  const file = appDbPath(appId);
  if (!file) throw new Error(`应用不存在:${appId}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  opened.set(appId, db);
  return db;
};

/** 应用目录被删/改名后,句柄要作废,否则还写向已删除的 inode。 */
export const closeAppDb = (appId: string) => {
  const db = opened.get(appId);
  if (!db) return;
  try { db.close(); } catch { /* 已关 */ }
  opened.delete(appId);
};

/** 越狱语法:ATTACH 能打开任意路径的库,load_extension 能加载任意代码。 */
const FORBIDDEN = /\b(attach|load_extension)\b/i;
const isRead = (sql: string) => /^\s*(select|with|pragma|explain)\b/i.test(sql);

export type SqlResult = { rows?: unknown[]; changes?: number; lastInsertRowid?: number };

const toValues = (params: unknown[]) =>
  (Array.isArray(params) ? params : []).map((v) =>
    v === null || v === undefined ? null : typeof v === "number" || typeof v === "bigint" ? v : String(v),
  );

const runOne = (db: DatabaseSync, sql: string, params: unknown[]): SqlResult => {
  const text = String(sql || "").trim();
  if (!text) throw new Error("sql 不能为空");
  if (FORBIDDEN.test(text)) throw new Error("不允许的语句:ATTACH / load_extension");
  const values = toValues(params);
  if (isRead(text)) return { rows: db.prepare(text).all(...(values as never[])) };
  // 无参多语句(建表脚本)整体执行
  if (!values.length && /;\s*\S/.test(text)) { db.exec(text); return {}; }
  const r = db.prepare(text).run(...(values as never[]));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
};

const assertQuota = (appId: string, sql: string) => {
  if (isRead(sql)) return;
  const file = appDbPath(appId);
  if (!file) return;
  try {
    if (fs.statSync(file).size > MAX_DB_BYTES) {
      throw new Error(`应用数据库已超上限(${Math.round(MAX_DB_BYTES / 1024 / 1024)}MB),仅允许读取`);
    }
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
  }
};

export const execAppSql = (appId: string, sql: string, params: unknown[] = []): SqlResult => {
  assertQuota(appId, sql);
  return runOne(dbFor(appId), sql, params);
};

/** D1 的 batch:一个事务里跑完,任一失败整体回滚。 */
export const batchAppSql = (appId: string, statements: { sql: string; params?: unknown[] }[]) => {
  const db = dbFor(appId);
  const list = Array.isArray(statements) ? statements.slice(0, 200) : [];
  for (const s of list) assertQuota(appId, String(s?.sql || ""));
  db.exec("BEGIN");
  try {
    const results = list.map((s) => runOne(db, String(s?.sql || ""), s?.params || []));
    db.exec("COMMIT");
    return { results };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
    throw e;
  }
};
