-- 结构真相在这里,没有迁移脚本,全部 IF NOT EXISTS。
-- 不变量下沉到 schema(NOT NULL / CHECK / 外键)—— 应用层不重复校验,靠这里兜底。
-- 级联删依赖 PRAGMA foreign_keys = ON,由 db.mjs 在开库时保证。

CREATE TABLE IF NOT EXISTS boards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 一张卡片 = 一个项目。并排横向排列,position 决定左右顺序。
CREATE TABLE IF NOT EXISTS cards (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id   INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  subtitle   TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'active'
             CHECK (status IN ('idea', 'active', 'blocked', 'paused', 'shipped')),
  link       TEXT    NOT NULL DEFAULT '',
  position   REAL    NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_board ON cards(board_id, archived, position);

-- 卡片内的条目。detail 是点开后看到的正文(Markdown 子集)。
CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id    INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  detail     TEXT    NOT NULL DEFAULT '',
  status     TEXT    NOT NULL DEFAULT 'todo'
             CHECK (status IN ('todo', 'doing', 'blocked', 'done')),
  position   REAL    NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_card ON items(card_id, position);
