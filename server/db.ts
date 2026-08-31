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
    -- 结构(空间/文件/对话)全在文件系统:workspaces/ 下
    --   目录 = 空间,真实文件 = 文件;对话绑定(而不是住在)一个真实文件夹。
    -- SQLite 只存:消息流、设置、收藏。**运行状态不落库** ——
    --   跑到一半的轮次重启后本就恢复不了,而发生过什么已经逐条记在 messages 里。

    CREATE TABLE IF NOT EXISTS chats (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      system       TEXT,
      workdir      TEXT NOT NULL,
      pinned       INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 消息:一行一个 Responses item(思考 / 正文 / 工具调用 / 结果),逐条落库
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      meta       TEXT,
      usage      TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 压缩:上下文超水位时的摘要,记住它替换了哪一段消息
    CREATE TABLE IF NOT EXISTS compactions (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id          TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      start_message_id INTEGER NOT NULL,
      end_message_id   INTEGER NOT NULL,
      summary          TEXT NOT NULL,
      tokens           INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      path           TEXT NOT NULL UNIQUE,
      enabled        INTEGER NOT NULL DEFAULT 1,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      last_opened_at TEXT
    );

    -- 网站:活动栏「网站」面板的收藏(在网页标签里打开)
    -- 权限规则:一条规则 = 一个「命中就停下来问」的触发条件。
    -- text 是用户原话(真相),prompt 和 match_json 都是它的派生物。
    -- match_json 为 '{}' 表示编译不出条件,这条只剩提示词一个出口(界面要如实标出)。
    CREATE TABLE IF NOT EXISTS rules (
      id         TEXT PRIMARY KEY,
      text       TEXT NOT NULL,
      prompt     TEXT NOT NULL DEFAULT '',
      match_json TEXT NOT NULL DEFAULT '{}',
      enabled    INTEGER NOT NULL DEFAULT 1,
      origin     TEXT NOT NULL DEFAULT 'user',
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 网站收藏:一棵浅树。kind='folder' 的行没有 url,别的行 parent_id 指向它。
    -- position 决定同级次序(拖拽排序),不靠 created_at —— 用户排的顺序和创建顺序无关。
    CREATE TABLE IF NOT EXISTS sites (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      url        TEXT NOT NULL,
      kind       TEXT NOT NULL DEFAULT 'site',   -- site | folder
      parent_id  TEXT,                            -- NULL = 根层
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 浏览记录。一个 url 一行,重复访问只更新时间与次数 ——
    -- 逐次追加会让「最近」被同一个站刷屏,而用户想看的是「去过哪些地方」。
    CREATE TABLE IF NOT EXISTS history (
      url        TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      visits     INTEGER NOT NULL DEFAULT 1,
      visited_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_history_time ON history(visited_at DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_chat    ON messages(chat_id, id);
    CREATE INDEX IF NOT EXISTS idx_compactions_chat ON compactions(chat_id, id);
  `);

  return db;
};

const getDb = () => initDb();

export { getDb };
