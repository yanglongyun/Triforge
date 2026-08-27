// 应用契约的路由面(APP.md):registry / 静态文件 / db / ai / agent / fs / activities。
// 按 AGENTS.md 规则二独立成模块;index.ts 只负责分发。
import type http from "http";
import fs from "fs";
import path from "path";
import { execAppSql } from "../service/appdb.js";
import { runAppAi } from "../service/appai.js";
import { runAppAgent } from "../service/appagent.js";
import { listActivities } from "../service/activities.js";
import { listWorkspaceApps, appFileAbs, appServerCode } from "../service/apps.js";
import { gadgetEndpoint } from "../gadgets.js";
import { emit } from "../bus.js";
import * as tree from "../repo/tree.js";

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const json = (res: http.ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};

const readBody = async (req: http.IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 10 * 1024 * 1024) throw new Error("body too large");
    chunks.push(Buffer.from(chunk as Buffer));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
};

const appIdOf = (body: any) => {
  const id = String(body?.appId || "").toLowerCase();
  if (!APP_ID.test(id)) throw new Error("bad app id");
  return id;
};

/** 已处理返回 true;未命中返回 false 让 index 继续。 */
export const handleAppRoutes = async (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> => {
  // ── 工作区应用的静态文件(iframe 入口与相对资源)──
  const fileMatch = /^\/workspace-apps\/([a-z0-9][a-z0-9-]{0,63})\/(.+)$/.exec(url.pathname);
  if (fileMatch && method === "GET") {
    const abs = appFileAbs(fileMatch[1], decodeURIComponent(fileMatch[2]));
    if (!abs) { res.writeHead(404); res.end("not found"); return true; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(abs).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(fs.readFileSync(abs));
    return true;
  }

  // ── 应用后端(workerd)──
  if (url.pathname === "/api/apps/server-code" && method === "GET") {
    const result = appServerCode(String(url.searchParams.get("id") || ""));
    if (!result) { json(res, 404, { ok: false, error: "no server code" }); return true; }
    json(res, 200, result);
    return true;
  }
  if (url.pathname === "/api/apps/gadget-endpoint" && method === "GET") {
    json(res, 200, { ok: true, endpoint: gadgetEndpoint() });
    return true;
  }
  if (url.pathname === "/api/app/server-log" && method === "POST") {
    try {
      const body = await readBody(req);
      const appId = appIdOf(body);
      const message = String(body?.message || "").slice(0, 4000);
      console.log(`[app:${appId}] ${message}`);
      emit({ type: "app_server_log", appId, message });
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/api/apps/registry" && method === "GET") {
    json(res, 200, { ok: true, apps: listWorkspaceApps().map(({ dir: _dir, ...rest }) => rest) });
    return true;
  }

  if (url.pathname === "/api/activities" && method === "GET") {
    json(res, 200, { ok: true, activities: listActivities() });
    return true;
  }

  if (url.pathname === "/api/app/db" && method === "POST") {
    try {
      const body = await readBody(req);
      json(res, 200, { ok: true, ...execAppSql(appIdOf(body), String(body?.sql || ""), body?.params) });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/api/app/ai" && method === "POST") {
    try {
      const body = await readBody(req);
      const result = await runAppAi({
        appId: appIdOf(body),
        summary: String(body?.summary || ""),
        system: String(body?.system || ""),
        prompt: String(body?.prompt || ""),
      });
      json(res, 200, { ok: true, ...result });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/api/app/agent" && method === "POST") {
    try {
      const body = await readBody(req);
      const result = await runAppAgent({
        appId: appIdOf(body),
        summary: String(body?.summary || ""),
        message: String(body?.message || ""),
        workdir: body?.workdir ? String(body.workdir) : undefined,
      });
      json(res, 200, { ok: true, ...result });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  // ── fs:workspace 能力:工作区内的受限文件读写(路径 = 绝对,或相对第一个工作区根)──
  if (url.pathname === "/api/app/fs" && method === "POST") {
    try {
      const body = await readBody(req);
      appIdOf(body); // 校验来源身份
      const roots = (tree.listWorkspaces() as { path: string }[]).map((w) => w.path);
      if (!roots.length) throw new Error("还没有工作区");
      const raw = String(body?.path || "");
      if (!raw) throw new Error("path 必填");
      const abs = path.normalize(path.isAbsolute(raw) ? raw : path.join(roots[0], raw));
      if (!(tree as any).isAllowedPath(abs)) throw new Error("路径必须在某个工作区内");

      const op = String(body?.op || "");
      if (op === "read") {
        if (fs.statSync(abs).size > 2 * 1024 * 1024) throw new Error("文件超过 2MB,拒绝读取");
        json(res, 200, { ok: true, content: fs.readFileSync(abs, "utf8") });
      } else if (op === "write") {
        const content = String(body?.content ?? "");
        if (content.length > 5 * 1024 * 1024) throw new Error("内容超过 5MB");
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
        json(res, 200, { ok: true });
      } else if (op === "list") {
        const entries = fs.readdirSync(abs, { withFileTypes: true })
          .map((e) => ({ name: e.name, kind: e.isDirectory() ? "dir" : "file" }));
        json(res, 200, { ok: true, entries });
      } else {
        throw new Error(`未知 op: ${op}`);
      }
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  return false;
};
