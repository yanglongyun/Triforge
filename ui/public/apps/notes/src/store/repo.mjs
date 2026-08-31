import { db, now, tx } from './db.mjs';

export class NotesError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code; }
}

const one = (sql, params = []) => db().prepare(sql).get(...params) ?? null;
const all = (sql, params = []) => db().prepare(sql).all(...params);
const run = (sql, params = []) => db().prepare(sql).run(...params);

const asTitle = (value) => String(value ?? '').trim() || '无标题';

/* ---------------- 位置 ---------------- */
// 浮点位置,插队取相邻两个的中点 —— 移动一页只写一行,不重排整层。

function positionAt(siblings, index) {
  const at = Math.max(0, Math.min(index ?? siblings.length, siblings.length));
  const before = at === 0 ? null : siblings[at - 1];
  const after = at >= siblings.length ? null : siblings[at];
  if (!before && !after) return 1;
  if (!before) return after.position - 1;
  if (!after) return before.position + 1;
  return (before.position + after.position) / 2;
}

/* ---------------- 页面 ---------------- */

export const childrenOf = (parentId) => all(
  `SELECT * FROM pages WHERE parent_id IS ${parentId == null ? 'NULL' : '?'} ORDER BY position, id`,
  parentId == null ? [] : [parentId],
);

export function getPage(id) {
  const page = one('SELECT * FROM pages WHERE id = ?', [id]);
  if (!page) throw new NotesError(`页面 ${id} 不存在`, 'not_found');
  return page;
}

export function createPage({ parentId = null, title, icon = '', index } = {}) {
  const parent = parentId == null ? null : getPage(parentId);
  const position = positionAt(childrenOf(parent?.id ?? null), index);
  const t = now();
  const page = one(
    `INSERT INTO pages (parent_id, title, icon, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    [parent?.id ?? null, asTitle(title), String(icon ?? ''), position, t, t],
  );
  // 新页要展开父级,否则建完根本看不见
  if (parent?.collapsed) run('UPDATE pages SET collapsed = 0 WHERE id = ?', [parent.id]);
  return page;
}

const FIELDS = {
  title: (v) => asTitle(v),
  icon: (v) => String(v ?? '').slice(0, 8),
  cover: (v) => String(v ?? '').slice(0, 400),
  collapsed: (v) => (v ? 1 : 0),
};

export function updatePage(id, patch) {
  getPage(id);
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    const coerce = FIELDS[key];
    if (!coerce) throw new NotesError(`页面没有 "${key}" 这个字段`);
    sets.push(`${key} = ?`);
    values.push(coerce(value));
  }
  if (sets.length) run(`UPDATE pages SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...values, now(), id]);
  return getPage(id);
}

/** 含自身的整棵子树。移动时靠它挡住「拖到自己的子孙下」这种成环。 */
export function subtreeIds(id) {
  const ids = new Set([id]);
  const rows = all('SELECT id, parent_id FROM pages');
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parent_id && ids.has(row.parent_id) && !ids.has(row.id)) { ids.add(row.id); changed = true; }
    }
  }
  return ids;
}

/** 换父 + 换位置。整棵子树跟着走 —— 只改这一行的指针。 */
export function movePage(id, { parentId, index } = {}) {
  const page = getPage(id);
  const target = parentId === undefined ? page.parent_id : (parentId == null ? null : getPage(parentId).id);
  if (target != null && subtreeIds(id).has(target)) {
    throw new NotesError('不能把一页移到它自己的子孙下面');
  }
  return tx(() => {
    const siblings = childrenOf(target).filter((p) => p.id !== id);
    run('UPDATE pages SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?',
      [target, positionAt(siblings, index), now(), id]);
    return getPage(id);
  });
}

export function deletePage(id) {
  getPage(id);
  run('DELETE FROM pages WHERE id = ?', [id]); // 子树与正文靠外键级联
}

/** 整棵树。一次查询装配,不做 N+1。 */
export function tree() {
  const rows = all('SELECT id, parent_id, title, icon, cover, position, collapsed, updated_at FROM pages ORDER BY position, id');
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    const parent = row.parent_id == null ? null : byId.get(row.parent_id);
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/* ---------------- 正文 ---------------- */

export const loadBody = (pageId) => one('SELECT body FROM docs WHERE page_id = ?', [pageId])?.body ?? '';

export function saveBody(pageId, body) {
  getPage(pageId);
  run(`INSERT INTO docs (page_id, body, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    [pageId, String(body ?? ''), now()]);
  run('UPDATE pages SET updated_at = ? WHERE id = ?', [now(), pageId]);
  return { pageId, length: String(body ?? '').length };
}

/** 标题和正文一起搜。正文本身就是 Markdown 文本,直接搜它,不另存镜像。 */
export function search(query) {
  const needle = String(query ?? '').trim();
  if (!needle) return [];
  const q = `%${needle}%`;
  return all(
    `SELECT p.id, p.title, p.icon, substr(COALESCE(d.body, ''), 1, 160) AS snippet
       FROM pages p LEFT JOIN docs d ON d.page_id = p.id
      WHERE p.title LIKE ? OR d.body LIKE ?
      ORDER BY p.updated_at DESC LIMIT 40`,
    [q, q],
  );
}
