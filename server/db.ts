import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// WORKBENCH_HOME:桌面壳/打包产物用它锚定仓库根 —— 打包后 __dirname 不再是 server/
const HOME = process.env.WORKBENCH_HOME || path.join(__dirname, "..");
const DB_PATH = path.join(HOME, "database/workbench.db");

let db: DatabaseSync | undefined;

const initDb = () => {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    -- 结构(空间/文件/智能体)全在文件系统:workspaces/ 下
    --   目录 = 空间,真实文件 = 文件,<uuid>.agent.json = 智能体
    -- SQLite 只存运行时状态:消息流、调用关系、设置。
    --   agent_id / caller_id / callee_id = 智能体的 uuid

    -- 智能体:对话即智能体,绑定(而不是住在)一个真实文件夹。
    --   从前是 <uuid>.agent.json 落在用户目录里 —— 过程数据污染用户资产,已废弃;
    --   workdir 是它的家:shell 在这执行,AGENTS.md / skills 从这发现。
    CREATE TABLE IF NOT EXISTS agents (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      system       TEXT,
      workdir      TEXT NOT NULL,
      pinned       INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 消息:每个智能体的邮箱
    CREATE TABLE IF NOT EXISTS messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id        TEXT NOT NULL,
      body            TEXT NOT NULL,
      meta            TEXT,
      usage           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS compactions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id         TEXT NOT NULL,
      start_message_id INTEGER NOT NULL,
      end_message_id   INTEGER NOT NULL,
      summary          TEXT NOT NULL,
      tokens           INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 调用:智能体之间的异步通信 + 状态机
    CREATE TABLE IF NOT EXISTS calls (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_id       TEXT,
      callee_id       TEXT NOT NULL,
      request_msg_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      response_msg_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','done','error','cancelled')),
      result          TEXT,
      error           TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- 网站:侧栏「网站」页收藏的链接(网页标签在 Electron 壳的 <webview> 里打开)
    CREATE TABLE IF NOT EXISTS sites (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      url        TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      path           TEXT NOT NULL UNIQUE,
      enabled        INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      last_opened_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_calls_caller  ON calls(caller_id, status);
    CREATE INDEX IF NOT EXISTS idx_calls_callee  ON calls(callee_id, status);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id, id);
    CREATE INDEX IF NOT EXISTS idx_compactions_agent ON compactions(agent_id, id);
  `);

  db.exec(`
    -- 应用私有存储(KV):每个应用一份 JSON。应用经宿主桥读写,自己永远不直连 http —— 见 APP.md。
    CREATE TABLE IF NOT EXISTS panel_kv (
      id         TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 应用活动:应用调用 AI(ai.complete)的问责流水;agent.run 走 calls 表(caller = app:<id>)。
    CREATE TABLE IF NOT EXISTS activities (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source       TEXT NOT NULL,                -- app:<id>
      kind         TEXT NOT NULL,                -- 'ai'
      summary      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'running',
      detail       TEXT NOT NULL DEFAULT '',
      tokens       INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activities_id ON activities(id DESC);
  `);

  // 隐藏智能体(应用 agent.run 的执行体):会话面板不显示,活动里可点开审查
  try { db.exec("ALTER TABLE agents ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0"); } catch { /* 已存在 */ }

  return db;
};

const getDb = () => initDb();

export { getDb };
