// 规则的存取。业务判定在 server/permission/rules.ts,这里只管进出库。
import { randomUUID } from "node:crypto";
import { getDb } from "../db.js";
import { ASK_ALL_ID, ASK_ALL_TEXT, normalizeRule, type Rule } from "../permission/rules.js";

type Row = {
  id: string; text: string; prompt: string; match_json: string;
  enabled: number; origin: string; position: number;
};

const toRule = (row: Row): Rule => normalizeRule({
  id: row.id, text: row.text, prompt: row.prompt,
  match: JSON.parse(row.match_json || "{}"),
  enabled: row.enabled, origin: row.origin,
});

export const listRules = (): Rule[] =>
  (getDb().prepare("SELECT * FROM rules ORDER BY position, created_at").all() as Row[]).map(toRule);

export const createRule = (input: { text: string; prompt?: string; match?: Rule["match"]; origin?: string }) => {
  const rule = normalizeRule({ ...input, id: randomUUID() });
  const next = (getDb().prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM rules").get() as { p: number }).p;
  getDb().prepare(`
    INSERT INTO rules (id, text, prompt, match_json, enabled, origin, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(rule.id, rule.text, rule.prompt, JSON.stringify(rule.match), rule.enabled ? 1 : 0, rule.origin, next);
  return rule;
};

export const updateRule = (id: string, patch: Partial<Rule>) => {
  const db = getDb();
  const row = db.prepare("SELECT * FROM rules WHERE id = ?").get(String(id)) as Row | undefined;
  if (!row) return null;
  const merged = normalizeRule({
    ...toRule(row), ...patch, id: row.id,
    match: patch.match ?? JSON.parse(row.match_json || "{}"),
  });
  db.prepare("UPDATE rules SET text = ?, prompt = ?, match_json = ?, enabled = ? WHERE id = ?")
    .run(merged.text, merged.prompt, JSON.stringify(merged.match), merged.enabled ? 1 : 0, merged.id);
  return merged;
};

export const deleteRule = (id: string) =>
  getDb().prepare("DELETE FROM rules WHERE id = ?").run(String(id)).changes > 0;

/** 内置规则落库(缺了才建):position -1 让它永远排在用户规则前面,默认不勾。 */
export const seedAskAllRule = () => {
  getDb().prepare(`
    INSERT OR IGNORE INTO rules (id, text, prompt, match_json, enabled, origin, position)
    VALUES (?, ?, ?, '{}', 0, 'factory', -1)
  `).run(ASK_ALL_ID, ASK_ALL_TEXT, ASK_ALL_TEXT);
};
