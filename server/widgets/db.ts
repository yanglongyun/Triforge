// 组件私有数据库:一组件一个 SQLite 文件,就放在组件目录里(widgets/<id>/data.db)。
//
// 为什么一组件一个文件:物理隔离才让「AI 随便写 SQL」安全。共用一个库靠表前缀约定隔离,
// 等于把安全性建立在"AI 不会写错 SQL"上 —— 永远有绕过,而且宿主得去解析 SQL 判断它碰了
// 哪张表,那条路走不通。一组件一文件,越界在物理上不可能,代价只是拦掉 ATTACH。
//
// 为什么放组件目录里:AI 得能查 schema、改数据、排错。藏进系统数据目录或按哈希命名,
// AI 和用户都摸不到,「AI 能管自己造的组件」当场作废。副产品:复制目录 = 连数据一起带走。
import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { widgetDbPath } from "./registry.js";

const MAX_DB_BYTES = 50 * 1024 * 1024; // 单库上限:失控膨胀保险丝
const MAX_ROWS = 5000;                 // 单次结果行数上限:别把界面噎死
const opened = new Map<string, DatabaseSync>();

const dbFor = (id: string) => {
  const existing = opened.get(id);
  if (existing) return existing;
  const file = widgetDbPath(id);
  if (!file) throw new Error(`组件不存在:${id}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  opened.set(id, db);
  return db;
};

/** 组件被删/改名后句柄要作废,否则还写向已删除的 inode。 */
export const closeWidgetDb = (id: string) => {
  const db = opened.get(id);
  if (!db) return;
  try { db.close(); } catch { /* 已关 */ }
  opened.delete(id);
};

export const closeAllWidgetDbs = () => { for (const id of [...opened.keys()]) closeWidgetDb(id); };

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
  if (isRead(text)) {
    const rows = db.prepare(text).all(...(values as never[]));
    return { rows: rows.length > MAX_ROWS ? rows.slice(0, MAX_ROWS) : rows };
  }
  if (!values.length && /;\s*\S/.test(text)) { db.exec(text); return {}; } // 无参多语句(建表脚本)
  const r = db.prepare(text).run(...(values as never[]));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
};

const assertQuota = (id: string, sql: string) => {
  if (isRead(sql)) return;
  const file = widgetDbPath(id);
  if (!file) return;
  try {
    if (fs.statSync(file).size > MAX_DB_BYTES) {
      throw new Error(`组件数据库已超上限(${Math.round(MAX_DB_BYTES / 1024 / 1024)}MB),仅允许读取`);
    }
  } catch (e: any) {
    if (e?.code !== "ENOENT") throw e;
  }
};

export const execWidgetSql = (id: string, sql: string, params: unknown[] = []): SqlResult => {
  assertQuota(id, sql);
  return runOne(dbFor(id), sql, params);
};

/** batch:一个事务里跑完,任一失败整体回滚。 */
export const batchWidgetSql = (id: string, statements: { sql: string; params?: unknown[] }[]) => {
  const db = dbFor(id);
  const list = Array.isArray(statements) ? statements.slice(0, 200) : [];
  for (const s of list) assertQuota(id, String(s?.sql || ""));
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
