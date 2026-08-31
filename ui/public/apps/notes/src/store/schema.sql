-- 结构真相在这里。不变量下沉到 schema,应用层不重复校验。
-- 级联删依赖 PRAGMA foreign_keys = ON,由 db.mjs 在开库时保证。

-- 页面树。parent_id 自引用,深度不限 —— 这就是「无限树形结构」。
-- 正文不在这张表里:它是一份 Yjs 文档,存在 docs 表。
CREATE TABLE IF NOT EXISTS pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  title      TEXT    NOT NULL DEFAULT '无标题',
  icon       TEXT    NOT NULL DEFAULT '',
  -- 封面。空 = 没有;`gradient:<名>` 用内置渐变,`http(s)://…` 直接当图片地址。
  -- 不收上传的文件 —— 那要一整套存储与清理,而封面的价值 90% 在「一眼认出这页」。
  cover      TEXT    NOT NULL DEFAULT '',
  position   REAL    NOT NULL DEFAULT 0,
  collapsed  INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id, position);

-- 正文:Yjs 文档的合并快照。一页一行,页没了它跟着走。
-- 存的是 Y.encodeStateAsUpdate 的字节,不是 HTML —— HTML 是渲染结果,不是真相。
CREATE TABLE IF NOT EXISTS docs (
  page_id    INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  state      BLOB    NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 纯文本镜像,只为搜索。每次落盘时从 Yjs 文档里抽一遍。
CREATE TABLE IF NOT EXISTS search (
  page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  body    TEXT NOT NULL DEFAULT ''
);
