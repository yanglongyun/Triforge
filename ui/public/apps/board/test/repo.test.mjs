import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BOARD_DATA_DIR = mkdtempSync(join(tmpdir(), 'board-test-'));

const { closeDb, db } = await import('../src/store/db.mjs');
const repo = await import('../src/store/repo.mjs');

before(() => { process.on('exit', () => rmSync(process.env.BOARD_DATA_DIR, { recursive: true, force: true })); });

beforeEach(() => {
  const d = db();
  d.exec('DELETE FROM items; DELETE FROM cards; DELETE FROM boards;');
});

test('第一次使用自动有一个看板，不用先建容器', () => {
  const board = repo.defaultBoard();
  assert.ok(board.id);
  assert.equal(repo.defaultBoard().id, board.id, '再叫一次应该拿到同一个，而不是又建一个');
});

test('卡片按 position 并排，追加落在最右', () => {
  const b = repo.defaultBoard();
  const a = repo.createCard({ boardId: b.id, title: '项目 A' });
  const c = repo.createCard({ boardId: b.id, title: '项目 B' });
  assert.deepEqual(repo.listCards(b.id).map((x) => x.id), [a.id, c.id]);
  assert.ok(c.position > a.position);
});

test('插到中间只改一行，不重排全表', () => {
  const b = repo.defaultBoard();
  const a = repo.createCard({ boardId: b.id, title: 'A' });
  const c = repo.createCard({ boardId: b.id, title: 'C' });
  const mid = repo.createCard({ boardId: b.id, title: 'B', index: 1 });
  assert.deepEqual(repo.listCards(b.id).map((x) => x.title), ['A', 'B', 'C']);
  assert.equal(repo.getCard(a.id).position, a.position, 'A 的位置不该被动过');
  assert.equal(repo.getCard(c.id).position, c.position, 'C 的位置不该被动过');
  assert.ok(mid.position > a.position && mid.position < c.position);
});

test('移动卡片到最左和最右', () => {
  const b = repo.defaultBoard();
  const ids = ['A', 'B', 'C'].map((t) => repo.createCard({ boardId: b.id, title: t }).id);
  repo.moveCard(ids[2], 0);
  assert.deepEqual(repo.listCards(b.id).map((x) => x.title), ['C', 'A', 'B']);
  repo.moveCard(ids[2], 2);
  assert.deepEqual(repo.listCards(b.id).map((x) => x.title), ['A', 'B', 'C']);
});

test('状态只认词表里的值', () => {
  const b = repo.defaultBoard();
  assert.throws(() => repo.createCard({ boardId: b.id, title: 'X', status: '瞎写' }), /status 只能是/);
  const card = repo.createCard({ boardId: b.id, title: 'X' });
  assert.equal(card.status, 'active');
  assert.equal(repo.updateCard(card.id, { status: 'shipped' }).status, 'shipped');
});

test('不认识的字段要抛错，不能静默丢掉', () => {
  const b = repo.defaultBoard();
  const card = repo.createCard({ boardId: b.id, title: 'X' });
  assert.throws(() => repo.updateCard(card.id, { colour: 'red' }), /没有 "colour" 这个字段/);
  assert.throws(() => repo.updateItem(repo.createItem({ cardId: card.id, title: 'i' }).id, { owner: 'me' }),
    /没有 "owner" 这个字段/);
});

test('空标题进不来', () => {
  const b = repo.defaultBoard();
  assert.throws(() => repo.createCard({ boardId: b.id, title: '   ' }), /title 不能为空/);
});

test('删卡片连带删掉它的条目（外键级联）', () => {
  const b = repo.defaultBoard();
  const card = repo.createCard({ boardId: b.id, title: 'X' });
  const item = repo.createItem({ cardId: card.id, title: '条目' });
  repo.deleteCard(card.id);
  assert.throws(() => repo.getItem(item.id), /不存在/);
});

test('条目可以搬到别的卡片下', () => {
  const b = repo.defaultBoard();
  const from = repo.createCard({ boardId: b.id, title: 'From' });
  const to = repo.createCard({ boardId: b.id, title: 'To' });
  const item = repo.createItem({ cardId: from.id, title: '搬我' });
  repo.createItem({ cardId: to.id, title: '已在那边' });
  const moved = repo.moveItem(item.id, { cardId: to.id, index: 0 });
  assert.equal(moved.card_id, to.id);
  assert.deepEqual(repo.listItems(to.id).map((i) => i.title), ['搬我', '已在那边']);
  assert.equal(repo.listItems(from.id).length, 0);
});

test('boardTree 一次给出界面要的全部，且不含归档卡片', () => {
  const b = repo.defaultBoard();
  const card = repo.createCard({ boardId: b.id, title: '活的' });
  repo.createItem({ cardId: card.id, title: '条目 1' });
  repo.createItem({ cardId: card.id, title: '条目 2' });
  const gone = repo.createCard({ boardId: b.id, title: '归档的' });
  repo.updateCard(gone.id, { archived: true });

  const tree = repo.boardTree(b.id);
  assert.equal(tree.cards.length, 1);
  assert.equal(tree.cards[0].title, '活的');
  assert.deepEqual(tree.cards[0].items.map((i) => i.title), ['条目 1', '条目 2']);
  assert.equal(repo.boardTree(b.id, { includeArchived: true }).cards.length, 2);
});

test('boardTree 在空看板上不炸', () => {
  assert.deepEqual(repo.boardTree(repo.defaultBoard().id).cards, []);
});

test('找不到的 id 报 not_found，不是崩', () => {
  const err = (fn) => { try { fn(); } catch (e) { return e; } };
  assert.equal(err(() => repo.getCard(9999)).code, 'not_found');
  assert.equal(err(() => repo.getItem(9999)).code, 'not_found');
  assert.equal(err(() => repo.getBoard(9999)).code, 'not_found');
});

test('关库不留句柄', () => { closeDb(); assert.ok(db()); });
