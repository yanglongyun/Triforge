// 面板私有存储:面板 = 最小应用形态,数据归面板自己(一板一份 JSON)。
// 读写只发生在宿主桥(PanelFrame → /api/panel/storage),iframe 面板永远不直连这里。
import { getDb } from "../db.js";
import * as sites from "./sites.js";

const get = (id: string) => {
  const row = getDb().prepare("SELECT value FROM panel_kv WHERE id = ?").get(String(id));
  if (row) {
    try { return JSON.parse(String(row.value)); } catch { return null; }
  }
  // 一次性迁移:旧「网站」表 → sites 面板的私有存储(面板化后数据随面板走)
  if (String(id) === "sites") {
    const rows = sites.list() as { id: string; title: string; url: string; created_at: string }[];
    const seed = { sites: rows.map((r) => ({ id: r.id, title: r.title, url: r.url, created_at: r.created_at })) };
    set("sites", seed);
    return seed;
  }
  return null;
};

const set = (id: string, value: unknown) => {
  getDb().prepare(
    "INSERT INTO panel_kv (id, value, updated_at) VALUES (?, ?, datetime('now')) " +
    "ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(String(id), JSON.stringify(value ?? null));
};

export { get, set };
