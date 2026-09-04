import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dbFile, ROOT } from '../config.mjs';

let handle = null;

/** 开库(单例)。外键必须在这里打开 —— 级联删全靠它。 */
export function db() {
  if (handle) return handle;
  const file = dbFile();
  mkdirSync(dirname(file), { recursive: true });
  handle = new DatabaseSync(file);
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA journal_mode = WAL'); // CLI 写、服务端读,两个进程要并存
  handle.exec(readFileSync(join(ROOT, 'src', 'store', 'schema.sql'), 'utf8'));
  seedHome(handle);
  return handle;
}

/**
 * 空库种一套开箱内容:「首页」笔记本 + 几篇带封面和 emoji 的示例。
 *
 * 根层不能是一堆没有归属的平级页 —— 所以一切都住在「首页」下面。
 * 种下去就是用户自己的:随便改、随便删,只有首页本身删不掉(删了就没有根了)。
 * 示例的用意是让人第一眼看到这个东西用起来是什么样子,而不是一片空白。
 */
const STARTER = {
  kind: 'folder', title: '首页', icon: '📚', cover: 'preset:5',
  children: [
    {
      kind: 'note', title: '从这里开始', icon: '✨', cover: 'preset:2',
      body: [
        '把想留住的东西放在这里。',
        '',
        '- 左边是页面树:**笔记本**装东西,**笔记**写内容',
        '- 点标题旁的图标换 emoji,标题上方可以加封面',
        '- 正文就是 Markdown,AI 也能直接读写这里的每一篇',
        '',
        '示例都可以删,从你的第一篇开始。',
      ].join('\n'),
    },
    {
      kind: 'folder', title: '读书', icon: '📖', cover: 'preset:3',
      children: [{
        kind: 'note', title: '摘抄', icon: '🕯️',
        body: [
          '> 采菊东篱下,悠然见南山。',
          '>',
          '> —— 陶渊明《饮酒·其五》',
          '',
          '> 人间有味是清欢。',
          '>',
          '> —— 苏轼《浣溪沙》',
          '',
          '> 春水碧于天,画船听雨眠。',
          '>',
          '> —— 韦庄《菩萨蛮》',
        ].join('\n'),
      }],
    },
    {
      kind: 'folder', title: '随笔', icon: '✍️', cover: 'preset:4',
      children: [{
        kind: 'note', title: '夜记', icon: '🌙',
        body: [
          '十一点,雨停了。',
          '',
          '窗外的路灯在湿漉漉的地面上拉出一道长长的光。白天想不明白的事,此刻忽然不重要了。',
          '',
          '记下来的意义大概就在这里 —— 让一天在纸上有个落点。',
        ].join('\n'),
      }],
    },
  ],
};

export function seedHome(d = db()) {
  const { n } = d.prepare('SELECT COUNT(*) AS n FROM pages').get();
  if (n > 0) return;
  const t = Date.now();
  const insertPage = d.prepare(`INSERT INTO pages (parent_id, kind, title, icon, cover, position, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertBody = d.prepare('INSERT INTO docs (page_id, body, updated_at) VALUES (?, ?, ?)');
  const plant = (node, parentId, position) => {
    const { lastInsertRowid: id } = insertPage.run(
      parentId, node.kind, node.title, node.icon, node.cover || '', position, t, t);
    if (node.body) insertBody.run(id, node.body, t);
    (node.children || []).forEach((child, index) => plant(child, id, index));
  };
  plant(STARTER, null, 0);
}

export function closeDb() {
  handle?.close();
  handle = null;
}

export const now = () => Date.now();

/** 一组写要么全成要么全不成 —— 换位置、批量导入都靠它。 */
export function tx(fn) {
  const d = db();
  d.exec('BEGIN');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (error) {
    d.exec('ROLLBACK');
    throw error;
  }
}
