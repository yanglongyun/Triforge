// 应用活动:应用调用 AI 的问责流水(每一笔都有名有姓,活动面板可见)。
// agent.run 不在这里 —— 它骑现有 calls 表(caller_id = app:<id>)。
import { getDb } from "../db.js";
import { emit } from "../bus.js";

export type ActivityRow = {
  id: number;
  source: string;
  kind: string;
  summary: string;
  status: "running" | "done" | "error";
  detail: string;
  tokens: number;
  created_at: string;
  completed_at: string | null;
};

const changed = () => emit({ type: "activity_changed" });

export const startActivity = (source: string, kind: string, summary: string) => {
  const result = getDb()
    .prepare("INSERT INTO activities (source, kind, summary) VALUES (?, ?, ?)")
    .run(String(source), String(kind), String(summary));
  changed();
  return Number(result.lastInsertRowid);
};

export const finishActivity = (id: number, { status, detail = "", tokens = 0 }: { status: "done" | "error"; detail?: string; tokens?: number }) => {
  getDb()
    .prepare("UPDATE activities SET status = ?, detail = ?, tokens = ?, completed_at = datetime('now') WHERE id = ?")
    .run(status, String(detail).slice(0, 2000), Number(tokens) || 0, id);
  changed();
};

export const listActivities = (limit = 100) =>
  getDb()
    .prepare("SELECT * FROM activities ORDER BY id DESC LIMIT ?")
    .all(Math.max(1, Math.min(500, limit))) as unknown as ActivityRow[];
