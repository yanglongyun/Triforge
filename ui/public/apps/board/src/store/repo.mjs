import { db, now, tx } from './db.mjs';
import { CARD_STATUS_IDS, ITEM_STATUS_IDS } from '../shared/status.mjs';

/** 领域错误。服务端映射成 4xx,CLI 打成一行人话,不带堆栈。 */
export class BoardError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.code = code;
  }
}

const one = (sql, params = []) => db().prepare(sql).get(...params) ?? null;
const all = (sql, params = []) => db().prepare(sql).all(...params);
const run = (sql, params = []) => db().prepare(sql).run(...params);

const text = (value, field) => {
  const s = String(value ?? '').trim();
  if (!s) throw new BoardError(`${field} 不能为空`);
  return s;
};
const enumOf = (value, allowed, field) => {
  if (!allowed.includes(value)) {
    throw new BoardError(`${field} 只能是 ${allowed.join(' / ')},收到 "${value}"`);
  }
  return value;
};

/* ---------------- 看板 ---------------- */

export const listBoards = () => all('SELECT * FROM boards ORDER BY id');

export function getBoard(id) {
  const board = one('SELECT * FROM boards WHERE id = ?', [id]);
  if (!board) throw new BoardError(`看板 ${id} 不存在`, 'not_found');
  return board;
}

export function createBoard(name = '我的看板') {
  const t = now();
  return one(
    'INSERT INTO boards (name, created_at, updated_at) VALUES (?, ?, ?) RETURNING *',
    [text(name, 'name'), t, t],
  );
}

/** 第一次用的时候自动有一个看板 —— 不让用户先建容器再建内容。 */
export function defaultBoard() {
  return listBoards()[0] ?? createBoard();
}

export function renameBoard(id, name) {
  getBoard(id);
  run('UPDATE boards SET name = ?, updated_at = ? WHERE id = ?', [text(name, 'name'), now(), id]);
  return getBoard(id);
}

/* ---------------- 位置 ---------------- */
// 位置是浮点数,插队取相邻两个的中点,所以移动一张卡只写一行,不重排全表。

const nextPosition = (sql, params) => (one(sql, params)?.max_position ?? 0) + 1;

function positionAt(siblings, index) {
  const at = Math.max(0, Math.min(index, siblings.length));
  const before = at === 0 ? null : siblings[at - 1];
  const after = at >= siblings.length ? null : siblings[at];
  if (!before && !after) return 1;
  if (!before) return after.position - 1;
  if (!after) return before.position + 1;
  return (before.position + after.position) / 2;
}

/* ---------------- 卡片(= 项目) ---------------- */

export const listCards = (boardId, { includeArchived = false } = {}) => all(
  `SELECT * FROM cards WHERE board_id = ?${includeArchived ? '' : ' AND archived = 0'}
   ORDER BY position, id`,
  [boardId],
);

export function getCard(id) {
  const card = one('SELECT * FROM cards WHERE id = ?', [id]);
  if (!card) throw new BoardError(`卡片 ${id} 不存在`, 'not_found');
  return card;
}

export function createCard({ boardId, title, subtitle = '', status = 'active', link = '', index }) {
  const board = boardId ? getBoard(boardId) : defaultBoard();
  enumOf(status, CARD_STATUS_IDS, 'status');
  const position = index === undefined
    ? nextPosition('SELECT MAX(position) AS max_position FROM cards WHERE board_id = ?', [board.id])
    : positionAt(listCards(board.id), index);
  const t = now();
  return one(
    `INSERT INTO cards (board_id, title, subtitle, status, link, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [board.id, text(title, 'title'), String(subtitle ?? ''), status, String(link ?? ''), position, t, t],
  );
}

const CARD_FIELDS = {
  title: (v) => text(v, 'title'),
  subtitle: (v) => String(v ?? ''),
  status: (v) => enumOf(v, CARD_STATUS_IDS, 'status'),
  link: (v) => String(v ?? ''),
  archived: (v) => (v ? 1 : 0),
};

/** 只认识 CARD_FIELDS 里的键。不认识的直接抛 —— 静默忽略会让调用方以为存上了。 */
export function updateCard(id, patch) {
  getCard(id);
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    const coerce = CARD_FIELDS[key];
    if (!coerce) throw new BoardError(`卡片没有 "${key}" 这个字段`);
    sets.push(`${key} = ?`);
    values.push(coerce(value));
  }
  if (sets.length) {
    run(`UPDATE cards SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...values, now(), id]);
  }
  return getCard(id);
}

export function moveCard(id, index) {
  const card = getCard(id);
  return tx(() => {
    const siblings = listCards(card.board_id, { includeArchived: true }).filter((c) => c.id !== id);
    run('UPDATE cards SET position = ?, updated_at = ? WHERE id = ?', [positionAt(siblings, index), now(), id]);
    return getCard(id);
  });
}

export function deleteCard(id) {
  getCard(id);
  run('DELETE FROM cards WHERE id = ?', [id]); // 条目靠外键级联走
}

/* ---------------- 条目 ---------------- */

export const listItems = (cardId) => all('SELECT * FROM items WHERE card_id = ? ORDER BY position, id', [cardId]);

export function getItem(id) {
  const item = one('SELECT * FROM items WHERE id = ?', [id]);
  if (!item) throw new BoardError(`条目 ${id} 不存在`, 'not_found');
  return item;
}

export function createItem({ cardId, title, detail = '', status = 'todo', index }) {
  getCard(cardId);
  enumOf(status, ITEM_STATUS_IDS, 'status');
  const position = index === undefined
    ? nextPosition('SELECT MAX(position) AS max_position FROM items WHERE card_id = ?', [cardId])
    : positionAt(listItems(cardId), index);
  const t = now();
  return one(
    `INSERT INTO items (card_id, title, detail, status, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    [cardId, text(title, 'title'), String(detail ?? ''), status, position, t, t],
  );
}

const ITEM_FIELDS = {
  title: (v) => text(v, 'title'),
  detail: (v) => String(v ?? ''),
  status: (v) => enumOf(v, ITEM_STATUS_IDS, 'status'),
};

export function updateItem(id, patch) {
  getItem(id);
  const sets = [];
  const values = [];
  for (const [key, value] of Object.entries(patch)) {
    const coerce = ITEM_FIELDS[key];
    if (!coerce) throw new BoardError(`条目没有 "${key}" 这个字段`);
    sets.push(`${key} = ?`);
    values.push(coerce(value));
  }
  if (sets.length) {
    run(`UPDATE items SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...values, now(), id]);
  }
  return getItem(id);
}

/** 移动条目。给了 cardId 就是跨卡片搬家,位置在新卡片里重算。 */
export function moveItem(id, { cardId, index } = {}) {
  const item = getItem(id);
  const target = cardId === undefined ? item.card_id : getCard(cardId).id;
  return tx(() => {
    const siblings = listItems(target).filter((i) => i.id !== id);
    run('UPDATE items SET card_id = ?, position = ?, updated_at = ? WHERE id = ?',
      [target, positionAt(siblings, index ?? siblings.length), now(), id]);
    return getItem(id);
  });
}

export function deleteItem(id) {
  getItem(id);
  run('DELETE FROM items WHERE id = ?', [id]);
}

/* ---------------- 整块读取 ---------------- */

/** 界面一次要的全部。两条查询装配,不做 N+1。 */
export function boardTree(boardId, { includeArchived = false } = {}) {
  const board = boardId ? getBoard(boardId) : defaultBoard();
  const cards = listCards(board.id, { includeArchived });
  if (!cards.length) return { board, cards: [] };
  const placeholders = cards.map(() => '?').join(', ');
  const items = all(
    `SELECT * FROM items WHERE card_id IN (${placeholders}) ORDER BY position, id`,
    cards.map((c) => c.id),
  );
  const byCard = new Map(cards.map((c) => [c.id, []]));
  for (const item of items) byCard.get(item.card_id).push(item);
  return { board, cards: cards.map((c) => ({ ...c, items: byCard.get(c.id) })) };
}
