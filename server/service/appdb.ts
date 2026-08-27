// 应用私有数据库:一应用一个 SQLite 文件(<HOME>/database/apps/<id>.db)。
// 让「AI 随便写 SQL」安全的不是过滤,而是物理隔离 —— SQL 再野,天花板是砸自己的数据。
// 见 APP.md「db 能力」。
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.WORKBENCH_HOME || path.join(__dirname, "../..");
const APPS_DB_DIR = path.join(HOME, "database/apps");

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DB_BYTES = 50 * 1024 * 1024; // 单库上限:失控膨胀保险丝

const opened = new Map<string, DatabaseSync>();

const dbFor = (appId: string) => {
  const existing = opened.get(appId);
  if (existing) return existing;
  fs.mkdirSync(APPS_DB_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(APPS_DB_DIR, `${appId}.db`));
  db.exec("PRAGMA journal_mode = WAL");
  opened.set(appId, db);
  return db;
};

/** 越狱语法拦截:ATTACH 能打开任意路径的库文件,load_extension 能加载任意代码。 */
const FORBIDDEN = /\b(attach|load_extension)\b/i;
const isReadStatement = (sql: string) => /^\s*(select|with|pragma|explain)\b/i.test(sql);

export type AppDbResult = {
  rows?: unknown[];
  changes?: number;
  lastInsertRowid?: number;
};

export const execAppSql = (appId: string, sql: string, params: unknown[] = []): AppDbResult => {
  if (!APP_ID.test(appId)) throw new Error("bad app id");
  const text = String(sql || "").trim();
  if (!text) throw new Error("sql 不能为空");
  if (FORBIDDEN.test(text)) throw new Error("不允许的语句:ATTACH / load_extension");

  const db = dbFor(appId);
  const values = (Array.isArray(params) ? params : []).map((v) =>
    v === null || v === undefined ? null : typeof v === "number" || typeof v === "bigint" ? v : String(v),
  );

  if (!isReadStatement(text)) {
    try {
      const size = fs.statSync(path.join(APPS_DB_DIR, `${appId}.db`)).size;
      if (size > MAX_DB_BYTES) throw new Error(`应用数据库已超上限(${Math.round(MAX_DB_BYTES / 1024 / 1024)}MB),仅允许读取`);
    } catch (e: any) {
      if (e?.code !== "ENOENT") throw e;
    }
    // 无参数的多语句(建表脚本等)整体执行
    if (!values.length && /;\s*\S/.test(text)) {
      db.exec(text);
      return {};
    }
    const result = db.prepare(text).run(...(values as never[]));
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }

  const rows = db.prepare(text).all(...(values as never[]));
  return { rows };
};
