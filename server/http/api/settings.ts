// 设置:模型连接、默认提示词、压缩水位等。
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSettings, saveSettings } from "../../settings.js";
import { json, parseBody } from "./helpers.js";

export const handleSettingRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  if (url.pathname !== "/api/settings") return false;
  if (method === "GET") { json(res, 200, { ok: true, settings: getSettings() }); return true; }
  if (method === "POST") { json(res, 200, { ok: true, settings: saveSettings(await parseBody(req)) }); return true; }
  return false;
};
