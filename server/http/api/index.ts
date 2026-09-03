// HTTP 层:只管解析请求 / 拼响应,业务都在各领域里。
// 每个资源一个文件,导出 handleXRoutes(req, res, url, method):处理了返回 true。
// 这里按顺序问一遍;/api/* 都不认就 404;不是 /api 的返回 null 交给静态层。
import type { IncomingMessage, ServerResponse } from "node:http";
import { json } from "./helpers.js";
import { handleWidgetRoutes } from "./widget.js";
import { handleAppRoutes } from "./app.js";
import { handleSkillRoutes } from "./skill.js";
import { handlePasswordRoutes } from "./password.js";
import { handlePermissionRoutes } from "./permission.js";
import { handleChatRoutes } from "./chats.js";
import { handleSiteRoutes } from "./sites.js";
import { handleWorkspaceRoutes } from "./workspace.js";
import { handleGitRoutes } from "./git.js";
import { handleSettingRoutes } from "./settings.js";
import { handleFileRoutes } from "./files.js";
import { handleTaskRoutes } from "./tasks.js";
import { handleHostRoutes } from "../../apps/bridge.js";

type Route = (req: IncomingMessage, res: ServerResponse, url: URL, method: string) => Promise<boolean>;

const ROUTES: Route[] = [
  handleWidgetRoutes,
  handleAppRoutes,
  handleSkillRoutes,
  handlePasswordRoutes,
  handlePermissionRoutes,
  handleFileRoutes,
  handleSiteRoutes,
  handleChatRoutes,
  handleWorkspaceRoutes,
  handleTaskRoutes,
  handleGitRoutes,
  handleSettingRoutes,
];

export const handleApi = async (req: IncomingMessage, res: ServerResponse): Promise<true | null> => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = String(req.method || "GET").toUpperCase();

  try {
    if (path === "/health") { json(res, 200, { ok: true }); return true; }
    for (const route of ROUTES) if (await route(req, res, url, method)) return true;
    // 应用自己调的宿主能力面(/host/*,token 即身份)
    if (await handleHostRoutes(req, res, path)) return true;
    if (path.startsWith("/api/")) { json(res, 404, { ok: false, error: "Not found" }); return true; }
    return null;
  } catch (error: any) {
    json(res, 500, { ok: false, error: String(error?.message || error) });
    return true;
  }
};
