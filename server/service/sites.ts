// 网站收藏:侧栏「网站」页的数据。一棵浅树 —— 文件夹 + 站点,同级可拖动排序。
// 打开动作全在界面(<webview> 标签),这里只管数据。
import { randomUUID } from "crypto";
import { getDb } from "../db.js";
import { emit } from "../bus.js";

const changed = () => emit({ type: "sites_changed" });

export type SiteRow = {
  id: string;
  title: string;
  url: string;
  kind: "site" | "folder";
  parent_id: string | null;
  position: number;
  created_at: string;
};

const normalizeUrl = (raw: unknown) => {
  const value = String(raw || "").trim();
  if (!value) throw new Error("url is required");
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withScheme); // 非法直接抛
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("只支持 http(s) 链接");
  return parsed.toString();
};

/** 按层级与次序取全表。界面自己拼树 —— 层级浅,不值得在 SQL 里递归。 */
const list = () =>
  getDb().prepare("SELECT * FROM sites ORDER BY position, created_at, rowid").all() as unknown as SiteRow[];

/** 站点身份键:主机去 www.、小写 + 非默认端口 —— 收藏去重不看协议和路径尾斜杠。 */
const siteKey = (normalized: string) => {
  const u = new URL(normalized);
  return u.hostname.toLowerCase().replace(/^www\./, "") + (u.port ? `:${u.port}` : "");
};

const nextPosition = (parentId: string | null) => {
  const row = getDb()
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sites WHERE parent_id IS ?")
    .get(parentId) as { p: number };
  return row.p;
};

const create = ({ url, title, parentId }: { url?: string; title?: string; parentId?: string | null } = {}) => {
  const normalized = normalizeUrl(url);
  // 同一个站已收藏:直接返回已有条目,不重复插行(去重跨文件夹 —— 一个站只该存在一次)
  const key = siteKey(normalized);
  const existing = list().find((row) => {
    if (row.kind !== "site") return false;
    try { return siteKey(normalizeUrl(row.url)) === key; } catch { return false; }
  });
  if (existing) return existing;

  const id = randomUUID();
  const name = String(title || "").trim() || new URL(normalized).hostname.replace(/^www\./, "");
  const parent = parentId || null;
  getDb()
    .prepare("INSERT INTO sites (id, title, url, kind, parent_id, position) VALUES (?, ?, ?, 'site', ?, ?)")
    .run(id, name, normalized, parent, nextPosition(parent));
  changed();
  return getDb().prepare("SELECT * FROM sites WHERE id = ?").get(id) as unknown as SiteRow;
};

const createFolder = ({ title, parentId }: { title?: string; parentId?: string | null } = {}) => {
  const name = String(title || "").trim() || "新文件夹";
  const id = randomUUID();
  const parent = parentId || null;
  getDb()
    .prepare("INSERT INTO sites (id, title, url, kind, parent_id, position) VALUES (?, ?, '', 'folder', ?, ?)")
    .run(id, name, parent, nextPosition(parent));
  changed();
  return getDb().prepare("SELECT * FROM sites WHERE id = ?").get(id) as unknown as SiteRow;
};

const update = (id: string, { title, url }: { title?: string; url?: string } = {}) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM sites WHERE id = ?").get(String(id)) as unknown as SiteRow | undefined;
  if (!row) throw new Error("没有这一条");
  const nextTitle = title === undefined ? row.title : String(title).trim() || row.title;
  // 文件夹没有 url,改它没有意义 —— 静默忽略比报错好,界面本来也不会给这个入口
  const nextUrl = row.kind === "folder" ? "" : (url === undefined ? row.url : normalizeUrl(url));
  db.prepare("UPDATE sites SET title = ?, url = ? WHERE id = ?").run(nextTitle, nextUrl, row.id);
  changed();
  return db.prepare("SELECT * FROM sites WHERE id = ?").get(row.id) as unknown as SiteRow;
};

/**
 * 重排 / 移动:一次把某个父层下的完整顺序发过来。
 *
 * 顺序与归属一起改 —— 拖进文件夹和拖动次序在界面上是同一个手势,
 * 拆成两个接口的话中间那一刻的状态是错的。
 */
const reorder = ({ parentId, ids }: { parentId?: string | null; ids?: unknown } = {}) => {
  const db = getDb();
  const parent = parentId || null;
  const wanted = (Array.isArray(ids) ? ids : []).map(String);
  const known = new Map(list().map((row) => [row.id, row]));
  const write = db.prepare("UPDATE sites SET parent_id = ?, position = ? WHERE id = ?");

  let index = 0;
  for (const id of wanted) {
    const row = known.get(id);
    if (!row) continue;
    // 文件夹不能塞进文件夹:这棵树只有两层,深了之后侧栏那点宽度根本展示不开
    if (row.kind === "folder" && parent) continue;
    write.run(parent, index, id);
    index += 1;
  }
  changed();
  return list();
};

const remove = (id: string) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM sites WHERE id = ?").get(String(id)) as unknown as SiteRow | undefined;
  if (!row) return false;
  // 删文件夹:里面的站点提回根层,不跟着消失 —— 收藏是用户攒的,不该被一个手势清空
  if (row.kind === "folder") {
    db.prepare("UPDATE sites SET parent_id = NULL WHERE parent_id = ?").run(row.id);
  }
  db.prepare("DELETE FROM sites WHERE id = ?").run(row.id);
  changed();
  return true;
};

export { list, create, createFolder, update, reorder, remove };
