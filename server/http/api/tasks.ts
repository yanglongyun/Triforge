// 任务:应用触发的 agent 轮次(见 apps/tasks.ts)。
import type { IncomingMessage, ServerResponse } from "node:http";
import { listTasks } from "../../apps/taskStore.js";
import { json } from "./helpers.js";

export const handleTaskRoutes = async (_req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  if (url.pathname === "/api/tasks" && method === "GET") {
    json(res, 200, { ok: true, tasks: listTasks(Number(url.searchParams.get("limit")) || 50) }); return true;
  }
  return false;
};
