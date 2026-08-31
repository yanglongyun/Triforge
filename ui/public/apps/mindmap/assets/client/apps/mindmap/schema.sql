-- 导图的表。**落在系统库里**,和任务、计划、页面同一个库 ——
-- 助理和页面读同一张表,用户说「把这篇文章整理成导图」时助理直接插行。
-- 表名带 app_mindmap_ 前缀:一眼看出它属于谁。
--
-- 这个文件是结构真相,无迁移脚本,全部 IF NOT EXISTS。
-- 不变量下沉到这里(NOT NULL / CHECK / 外键)—— 应用没有服务端校验层,靠 schema 兜底。
--
-- 级联删依赖 `PRAGMA foreign_keys = ON`,那一条由内核在开库时保证(store/db.js),
-- 不写在这里 —— 一个应用的 schema 不该去改整个库的行为。

CREATE TABLE IF NOT EXISTS app_mindmap_maps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL DEFAULT '无标题导图' CHECK (length(trim(name)) > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_mindmap_maps_list ON app_mindmap_maps(updated_at DESC);

-- 主题树。每张导图有且仅有一个根主题(parent_id IS NULL),建导图时一并创建。
-- side 只对根的直接子主题有意义(决定挂左边还是右边),更深的层跟随祖先。
CREATE TABLE IF NOT EXISTS app_mindmap_topics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id     INTEGER NOT NULL REFERENCES app_mindmap_maps(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES app_mindmap_topics(id) ON DELETE CASCADE,
  text       TEXT NOT NULL DEFAULT '主题' CHECK (length(trim(text)) > 0),
  side       TEXT CHECK (side IN ('left', 'right') OR side IS NULL),
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsed  INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_app_mindmap_topics_map ON app_mindmap_topics(map_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_app_mindmap_topics_parent ON app_mindmap_topics(parent_id);
