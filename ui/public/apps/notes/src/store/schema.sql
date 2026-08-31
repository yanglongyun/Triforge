-- 结构真相在这里。不变量下沉到 schema,应用层不重复校验。
-- 级联删依赖 PRAGMA foreign_keys = ON,由 db.mjs 在开库时保证。

-- 页面树。两种东西,和文件夹 / 文件是一个道理:
--   folder(笔记本)—— 可以无限套,**没有正文**
--   note  (笔记)  —— **有正文,不能再套东西**
-- 「谁能当爹」这条不变量下沉到 repo(SQLite 表达不了「父亲必须是 folder」),
-- 但 kind 本身钉在这里,应用层不重复定义。
CREATE TABLE IF NOT EXISTS pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id  INTEGER REFERENCES pages(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL DEFAULT 'note' CHECK (kind IN ('folder', 'note')),
  title      TEXT    NOT NULL DEFAULT '无标题',
  icon       TEXT    NOT NULL DEFAULT '',
  -- 封面。空 = 没有;`preset:N` 用内置那几张图,`http(s)://…` 直接当图片地址。
  -- 不收上传的文件 —— 那要一整套存储与清理,而封面的价值 90% 在「一眼认出这页」。
  cover      TEXT    NOT NULL DEFAULT '',
  position   REAL    NOT NULL DEFAULT 0,
  collapsed  INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pages_parent ON pages(parent_id, position);

-- 正文。只有 note 有;folder 是容器,写不进东西(repo 挡着)。
-- **Markdown 文本,不是 HTML,也不是编辑器的私有结构** ——
-- 正文要能被人读、被 AI 读、被 grep 到,渲染是下游的事。
-- 一页一行,页没了它跟着走。搜索直接搜这一列,不另存镜像。
CREATE TABLE IF NOT EXISTS docs (
  page_id    INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
