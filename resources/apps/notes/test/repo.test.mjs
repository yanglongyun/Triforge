import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.NOTES_DATA_DIR = mkdtempSync(join(tmpdir(), 'notes-repo-'));
const { db, seedHome } = await import('../src/store/db.mjs');
const repo = await import('../src/store/repo.mjs');

after(() => rmSync(process.env.NOTES_DATA_DIR, { recursive: true, force: true }));
// 每条测试都从「只有首页」开始 —— starter 示例内容另有专门一条测试管
beforeEach(() => {
  db().exec('DELETE FROM pages;');
  db().prepare(`INSERT INTO pages (parent_id, kind, title, icon, position, created_at, updated_at)
                VALUES (NULL, 'folder', '首页', '📚', 0, 1, 1)`).run();
});
const home = () => repo.tree()[0];

const titles = (nodes) => nodes.map((n) => n.title);
/** 要装东西就得是笔记本。测试里嵌套的那几处统一走它。 */
const folder = (opts) => repo.createPage({ ...opts, kind: 'folder' });

test('层级可以一直嵌下去', () => {
  let parent = null;
  for (let depth = 0; depth < 8; depth++) parent = folder({ parentId: parent?.id ?? null, title: `第${depth}层` });
  let node = repo.tree().find((n) => n.title === '第0层');
  let depth = 0;
  while (node.children.length) { node = node.children[0]; depth++; }
  assert.equal(depth, 7, '八层应该一层套一层');
  assert.equal(node.title, '第7层');
});

test('插到中间只改一行', () => {
  const under = home().id;
  const a = repo.createPage({ parentId: under, title: 'A' });
  const c = repo.createPage({ parentId: under, title: 'C' });
  repo.createPage({ parentId: under, title: 'B', index: 1 });
  assert.deepEqual(titles(home().children), ['A', 'B', 'C']);
  assert.equal(repo.getPage(a.id).position, a.position);
  assert.equal(repo.getPage(c.id).position, c.position);
});

test('换父:整棵子树跟着走', () => {
  const home = folder({ title: '起点' });
  const box = folder({ title: '收纳' });
  const kid = folder({ parentId: home.id, title: '子页' });
  repo.createPage({ parentId: kid.id, title: '孙页' });

  repo.movePage(home.id, { parentId: box.id });
  assert.equal(repo.getPage(home.id).parent_id, box.id);
  const moved = repo.tree().find((n) => n.title === '收纳').children[0];
  assert.equal(moved.title, '起点');
  assert.equal(moved.children[0].children[0].title, '孙页', '孙页应该还在原位置上跟着走');
});

test('不能把一页移到自己的子孙下面', () => {
  const top = folder({ title: '上' });
  const kid = folder({ parentId: top.id, title: '下' });
  assert.throws(() => repo.movePage(top.id, { parentId: kid.id }), /自己的子孙/);
});

test('移到根用 parentId: null', () => {
  const top = folder({ title: '上' });
  const kid = repo.createPage({ parentId: top.id, title: '下' });
  repo.movePage(kid.id, { parentId: null });
  assert.deepEqual(titles(repo.tree()).sort(), ['上', '下', '首页']);
});

test('删父页连带删整棵子树', () => {
  const top = folder({ parentId: home().id, title: '上' });
  const kid = folder({ parentId: top.id, title: '下' });
  const grand = repo.createPage({ parentId: kid.id, title: '孙' });
  repo.deletePage(top.id);
  assert.throws(() => repo.getPage(grand.id), /不存在/);
  assert.equal(home().children.length, 0);
});

test('不认识的字段要抛错', () => {
  const page = repo.createPage({ title: 'X' });
  assert.throws(() => repo.updatePage(page.id, { colour: 'red' }), /没有 "colour" 这个字段/);
});

test('空标题落成「无标题」而不是报错', () => {
  assert.equal(repo.createPage({ title: '   ' }).title, '无标题');
});

test('在收起的父页下新建，父页自动展开', () => {
  const top = folder({ title: '上' });
  repo.createPage({ parentId: top.id, title: '旧' });
  repo.updatePage(top.id, { collapsed: true });
  repo.createPage({ parentId: top.id, title: '新' });
  assert.equal(repo.getPage(top.id).collapsed, 0, '否则建完根本看不见');
});

test('正文存的是原样文本，读回来一字不差', () => {
  const page = repo.createPage({ title: '笔记' });
  assert.equal(repo.loadBody(page.id), '', '还没写过就是空串，不是 null');
  const md = '# 标题\n\n- [x] 做完了\n- [ ] 还没\n\n正文是 **Markdown**。';
  repo.saveBody(page.id, md);
  assert.equal(repo.loadBody(page.id), md);
  repo.saveBody(page.id, '改过了');
  assert.equal(repo.loadBody(page.id), '改过了', '再写是覆盖，不是追加');
});

test('搜索直接搜正文列，不靠另一张镜像表', () => {
  const page = repo.createPage({ title: '无关的标题' });
  repo.saveBody(page.id, '这里面提到了 CRDT 这个词');
  const hit = repo.search('CRDT').find((h) => h.id === page.id);
  assert.ok(hit, '正文命中也要能搜到');
  assert.match(hit.snippet, /CRDT/);
});

test('页面没了，正文跟着走', () => {
  const page = repo.createPage({ title: '要删的' });
  repo.saveBody(page.id, '内容');
  repo.deletePage(page.id);
  assert.equal(repo.loadBody(page.id), '', '外键级联该把 docs 那行带走');
});

test('空库种出开箱内容:首页 + 示例', () => {
  db().exec('DELETE FROM pages;');
  seedHome(db());
  const roots = repo.tree();
  assert.equal(roots.length, 1, '根上只有首页一个');
  const home = roots[0];
  assert.equal(home.kind, 'folder');
  assert.equal(home.title, '首页');
  assert.ok(home.cover, '首页有封面');
  const welcome = home.children.find((c) => c.title === '从这里开始');
  assert.equal(welcome.kind, 'note');
  assert.match(repo.loadBody(welcome.id), /Markdown/, '欢迎页有正文');
  for (const child of home.children) assert.ok(child.icon, '示例都有 emoji');
});

test('笔记里放不了东西 —— 这套模型的全部意义', () => {
  const note = repo.createPage({ title: '一篇笔记', kind: 'note' });
  assert.throws(() => repo.createPage({ parentId: note.id, title: '塞进去' }), /放不了东西/);
  const folder = repo.createPage({ title: '本子', kind: 'folder' });
  const inside = repo.createPage({ parentId: folder.id, title: '里面的' });
  assert.equal(inside.parent_id, folder.id);
  assert.throws(() => repo.movePage(folder.id, { parentId: note.id }), /放不了东西/);
});

test('笔记本没有正文', () => {
  const folder = repo.createPage({ title: '本子', kind: 'folder' });
  assert.throws(() => repo.saveBody(folder.id, '写点东西'), /没有正文/);
});

test('首页删不掉 —— 删完东西就无处可放', () => {
  assert.throws(() => repo.deletePage(home().id), /删不了/);
});
