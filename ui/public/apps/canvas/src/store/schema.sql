-- 结构真相在这里。不变量下沉到 schema,应用层不重复校验。

-- 一个场景 = 一张无限画布。
CREATE TABLE IF NOT EXISTS scenes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL DEFAULT '无标题画布' CHECK (length(trim(name)) > 0),
  position   REAL    NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scenes_order ON scenes(position, id);

-- 场景内容。elements 是 Excalidraw 的元素数组,原样存 —— 它的格式由 Excalidraw 定,
-- 我们不去解释它,只负责存取。appState 只留视图相关的少数几个键(见 repo.mjs)。
CREATE TABLE IF NOT EXISTS scene_data (
  scene_id   INTEGER PRIMARY KEY REFERENCES scenes(id) ON DELETE CASCADE,
  elements   TEXT    NOT NULL DEFAULT '[]',
  app_state  TEXT    NOT NULL DEFAULT '{}',
  version    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- 画布里贴的图。Excalidraw 把它们放在 files 里,按 fileId 索引;
-- 单独一张表是因为它们比元素大得多,列表页不该顺带把图也读出来。
CREATE TABLE IF NOT EXISTS scene_files (
  scene_id   INTEGER NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  file_id    TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scene_id, file_id)
);
