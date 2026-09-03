// 规则的存取。规则就是一句话 + 开关 + 顺序。
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import type { Rule } from "../permission/rules.js";

type Row = { id: string; text: string; enabled: number; position: number };
const toRule = (row: Row): Rule => ({ id: row.id, text: row.text, enabled: !!row.enabled, position: row.position });

export const listRules = (): Rule[] =>
  (getDb().prepare("SELECT id, text, enabled, position FROM rules ORDER BY position, created_at").all() as Row[]).map(toRule);

export const createRule = (text: string): Rule => {
  const db = getDb();
  const id = randomUUID();
  const position = (db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM rules").get() as { p: number }).p;
  db.prepare("INSERT INTO rules (id, text, enabled, position) VALUES (?, ?, 1, ?)").run(id, text, position);
  return { id, text, enabled: true, position };
};

export const updateRule = (id: string, patch: { text?: string; enabled?: boolean }): Rule | null => {
  const db = getDb();
  const row = db.prepare("SELECT id, text, enabled, position FROM rules WHERE id = ?").get(String(id)) as Row | undefined;
  if (!row) return null;
  const next = { ...toRule(row), ...patch };
  db.prepare("UPDATE rules SET text = ?, enabled = ? WHERE id = ?").run(next.text, next.enabled ? 1 : 0, next.id);
  return next;
};

export const deleteRule = (id: string) =>
  getDb().prepare("DELETE FROM rules WHERE id = ?").run(String(id)).changes > 0;

/**
 * 重排:按给定的 id 顺序重写 position。
 * 没被提到的规则排在后面、相对次序不变 —— 界面发来的可能是一份稍旧的快照。
 */
export const reorderRules = (ids: unknown) => {
  const db = getDb();
  const current = listRules().map((r) => r.id);
  const wanted = (Array.isArray(ids) ? ids : []).map(String);
  const seen = new Set<string>();
  const ordered = wanted.filter((id) => current.includes(id) && !seen.has(id) && seen.add(id) !== undefined);
  const final = [...ordered, ...current.filter((id) => !seen.has(id))];
  const write = db.prepare("UPDATE rules SET position = ? WHERE id = ?");
  final.forEach((id, index) => write.run(index, id));
  return listRules();
};
