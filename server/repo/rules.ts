// 规则的存取。业务判定在 server/permission/rules.ts,这里只管进出库。
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { normalizeRule, type Rule } from "../permission/rules.js";

type Row = {
  id: string; text: string; prompt: string; match_json: string;
  enabled: number; origin: string; position: number;
};

// gate 跟着 match 一起存在 match_json 里 —— 一个布尔值不值得改表结构
const toRule = (row: Row): Rule => {
  const parsed = JSON.parse(row.match_json || "{}");
  return normalizeRule({
    id: row.id, text: row.text, prompt: row.prompt,
    match: parsed, gate: parsed.gate,
    enabled: row.enabled, origin: row.origin,
  });
};
const packMatch = (rule: Rule) => JSON.stringify({ ...rule.match, gate: rule.gate });

export const listRules = (): Rule[] =>
  (getDb().prepare("SELECT * FROM rules ORDER BY position, created_at").all() as Row[]).map(toRule);

export const createRule = (input: { text: string; prompt?: string; match?: Rule["match"]; gate?: boolean; origin?: string }) => {
  const rule = normalizeRule({ ...input, id: randomUUID() });
  const next = (getDb().prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM rules").get() as { p: number }).p;
  getDb().prepare(`
    INSERT INTO rules (id, text, prompt, match_json, enabled, origin, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(rule.id, rule.text, rule.prompt, packMatch(rule), rule.enabled ? 1 : 0, rule.origin, next);
  return rule;
};

export const updateRule = (id: string, patch: Partial<Rule>) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM rules WHERE id = ?").get(String(id)) as Row | undefined;
  if (!row) return null;
  const current = toRule(row);
  const merged = normalizeRule({
    ...current, ...patch, id: row.id,
    match: patch.match ?? current.match,
    gate: patch.gate ?? current.gate,
  });
  db.prepare("UPDATE rules SET text = ?, prompt = ?, match_json = ?, enabled = ? WHERE id = ?")
    .run(merged.text, merged.prompt, packMatch(merged), merged.enabled ? 1 : 0, merged.id);
  return merged;
};

export const deleteRule = (id: string) =>
  getDb().prepare("DELETE FROM rules WHERE id = ?").run(String(id)).changes > 0;

/**
 * 重排:按给定的 id 顺序重写 position。
 *
 * 没被提到的规则排在后面、相对次序不变 —— 界面发来的可能是一份稍旧的快照
 * (另一处刚加了一条),那条不该因为不在列表里就被挤掉或丢了位置。
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
