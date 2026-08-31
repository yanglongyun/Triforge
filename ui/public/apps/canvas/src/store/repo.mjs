import { db, now, tx } from './db.mjs';

export class CanvasError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code; }
}

const one = (sql, params = []) => db().prepare(sql).get(...params) ?? null;
const all = (sql, params = []) => db().prepare(sql).all(...params);
const run = (sql, params = []) => db().prepare(sql).run(...params);

const asName = (value) => String(value ?? '').trim() || '无标题画布';

/** appState 大部分是本机 UI 状态(当前工具、选中项、菜单开合),不该跟着同步。
 *  只留下这几个:换台设备打开时,视图落在同一个位置、同一套配色。 */
const VIEW_KEYS = ['viewBackgroundColor', 'gridSize', 'gridModeEnabled', 'scrollX', 'scrollY', 'zoom', 'theme'];
const viewOnly = (appState) => Object.fromEntries(
  VIEW_KEYS.filter((k) => appState?.[k] !== undefined).map((k) => [k, appState[k]]),
);

/* ---------------- 场景 ---------------- */

export const listScenes = () => all(
  `SELECT s.*, (SELECT json_array_length(d.elements) FROM scene_data d WHERE d.scene_id = s.id) AS element_count
     FROM scenes s ORDER BY s.position, s.id`,
);

export function getScene(id) {
  const scene = one('SELECT * FROM scenes WHERE id = ?', [id]);
  if (!scene) throw new CanvasError(`画布 ${id} 不存在`, 'not_found');
  return scene;
}

export function createScene({ name, index } = {}) {
  const siblings = listScenes();
  const at = Math.max(0, Math.min(index ?? siblings.length, siblings.length));
  const before = at === 0 ? null : siblings[at - 1];
  const after = at >= siblings.length ? null : siblings[at];
  const position = !before && !after ? 1
    : !before ? after.position - 1
    : !after ? before.position + 1
    : (before.position + after.position) / 2;

  const t = now();
  const scene = one(
    'INSERT INTO scenes (name, position, created_at, updated_at) VALUES (?, ?, ?, ?) RETURNING *',
    [asName(name), position, t, t],
  );
  run('INSERT INTO scene_data (scene_id, elements, app_state, version, updated_at) VALUES (?, ?, ?, 0, ?)',
    [scene.id, '[]', '{}', t]);
  return scene;
}

export function renameScene(id, name) {
  getScene(id);
  run('UPDATE scenes SET name = ?, updated_at = ? WHERE id = ?', [asName(name), now(), id]);
  return getScene(id);
}

export function deleteScene(id) {
  getScene(id);
  run('DELETE FROM scenes WHERE id = ?', [id]); // 内容与图片靠外键级联
}

/* ---------------- 内容 ---------------- */

export function loadScene(id) {
  const scene = getScene(id);
  const data = one('SELECT * FROM scene_data WHERE scene_id = ?', [id]);
  const files = all('SELECT file_id, payload FROM scene_files WHERE scene_id = ?', [id]);
  return {
    scene,
    version: data?.version ?? 0,
    elements: JSON.parse(data?.elements ?? '[]'),
    appState: JSON.parse(data?.app_state ?? '{}'),
    files: Object.fromEntries(files.map((f) => [f.file_id, JSON.parse(f.payload)])),
  };
}

/**
 * 存一次。**乐观并发**:调用方带上它读到的 version,对不上就拒绝 ——
 * 两台设备同时改同一张画布时,后到的那次不会把先到的整块盖掉。
 * 冲突交给界面处理(重新读一次,把自己的改动叠上去)。
 */
export function saveScene(id, { elements, appState, files, version }) {
  getScene(id);
  if (!Array.isArray(elements)) throw new CanvasError('elements 必须是数组');
  return tx(() => {
    const current = one('SELECT version FROM scene_data WHERE scene_id = ?', [id])?.version ?? 0;
    if (version !== undefined && Number(version) !== current) {
      throw new CanvasError(`画布已被别处改过（你的版本 ${version}，当前 ${current}）`, 'conflict');
    }
    const t = now();
    const next = current + 1;
    run(`UPDATE scene_data SET elements = ?, app_state = ?, version = ?, updated_at = ? WHERE scene_id = ?`,
      [JSON.stringify(elements), JSON.stringify(viewOnly(appState)), next, t, id]);
    run('UPDATE scenes SET updated_at = ? WHERE id = ?', [t, id]);

    // 图片只增不改:同一个 fileId 的内容按定义是不变的
    for (const [fileId, payload] of Object.entries(files ?? {})) {
      run(`INSERT INTO scene_files (scene_id, file_id, payload, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(scene_id, file_id) DO NOTHING`, [id, fileId, JSON.stringify(payload), t]);
    }
    return { version: next, updated_at: t };
  });
}

/** 场景里已经没人引用的图片。删元素不会自动清图 —— 这里回收。 */
export function pruneFiles(id) {
  const { elements } = loadScene(id);
  const used = new Set(elements.map((el) => el.fileId).filter(Boolean));
  const stored = all('SELECT file_id FROM scene_files WHERE scene_id = ?', [id]).map((r) => r.file_id);
  const orphans = stored.filter((fileId) => !used.has(fileId));
  for (const fileId of orphans) run('DELETE FROM scene_files WHERE scene_id = ? AND file_id = ?', [id, fileId]);
  return orphans.length;
}
