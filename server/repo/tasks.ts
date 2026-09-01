// 任务存取:应用触发的 agent 轮次记录。纯存取,不做业务判断。
import { randomUUID } from "crypto";
import { getDb } from "../db.js";

export type TaskStatus = "running" | "done" | "error" | "aborted";

export const createTask = ({ appId, title, prompt }: { appId: string; title: string; prompt: string }) => {
  const id = randomUUID();
  getDb().prepare(
    "INSERT INTO tasks (id, app_id, title, prompt) VALUES (?, ?, ?, ?)",
  ).run(id, appId, title, prompt);
  return id;
};

export const settleTask = (id: string, status: TaskStatus, fields: { response?: string; error?: string } = {}) => {
  getDb().prepare(
    "UPDATE tasks SET status = ?, response = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(status, fields.response ?? null, fields.error ?? null, id);
};

export const listTasks = (limit = 50) =>
  getDb().prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(limit, 200)));
