// 应用契约的路由面(APP.md)。按 AGENTS.md 规则二独立成模块;index.ts 只负责分发。
//
// 分两类:
//   给 UI 的      —— 注册表、应用网址(带 token)、活动流水;
//   给 overseer 的 —— 取码、解 token、DB/资源/AI/agent/日志(应用的 binding 全落在这)。
import type http from "http";
import { batchAppSql, execAppSql } from "../service/appdb.js";
import { runAppAi } from "../service/appai.js";
import { runAppAgent } from "../service/appagent.js";
import { listActivities } from "../service/activities.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { appAsset, appIdForToken, appServerCode, appToken, getApp, listApps } from "../service/apps.js";
import { closeAppDb } from "../service/appdb.js";
import { gadgetEndpoint } from "../gadgets.js";
import { emit } from "../bus.js";

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST = process.env.WORKBENCH_UI_DIST
  || path.join(process.env.WORKBENCH_HOME || path.join(__dirname, "../.."), "ui/dist");

const json = (res: http.ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};

const readBody = async (req: http.IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 25 * 1024 * 1024) throw new Error("body too large");
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
  // ── 给 UI:注册表 / 应用网址 / 活动 ──
  if (url.pathname === "/api/apps/registry" && method === "GET") {
    json(res, 200, { ok: true, apps: listApps().map(({ dir: _d, ...rest }) => rest) });
    return true;
  }

  /** 应用的网站地址:iframe 直接指向它。token 每应用一个,防止应用间互访。 */
  if (url.pathname === "/api/apps/url" && method === "GET") {
    const id = String(url.searchParams.get("id") || "").toLowerCase();
    const route = String(url.searchParams.get("route") || "/");
    const app = APP_ID.test(id) ? getApp(id) : null;
    const endpoint = gadgetEndpoint();
    if (!app) { json(res, 404, { ok: false, error: "应用不存在" }); return true; }
    if (!endpoint) { json(res, 503, { ok: false, error: "应用运行时未就绪(workerd 未启动)" }); return true; }
    const safeRoute = route.startsWith("/") && !route.includes("..") ? route : "/";
    json(res, 200, { ok: true, url: `http://127.0.0.1:${endpoint.port}/app/${appToken(app.id)}${safeRoute}` });
    return true;
  }

  /** 宿主 UI 能力的 SDK:由 overseer 转发给应用(应用不在 Workbench 同源里)。 */
  if (url.pathname === "/api/apps/sdk.js" && method === "GET") {
    try {
      const body = fs.readFileSync(path.join(UI_DIST, "apps/workbench-sdk.js"));
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("sdk not built");
    }
    return true;
  }

  /** 删除应用 = 删目录(应用就是目录,没有别的注册表)。 */
  if (url.pathname === "/api/apps/remove" && method === "POST") {
    try {
      const body = await readBody(req);
      const app = getApp(appIdOf(body));
      if (!app) throw new Error("应用不存在");
      closeAppDb(app.id);
      fs.rmSync(app.dir, { recursive: true, force: true });
      json(res, 200, { ok: true });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/api/activities" && method === "GET") {
    json(res, 200, { ok: true, activities: listActivities() });
    return true;
  }

  // ── 给 overseer:解 token / 取码 ──
  if (url.pathname === "/api/apps/resolve-token" && method === "GET") {
    const appId = appIdForToken(String(url.searchParams.get("token") || ""));
    if (!appId) { json(res, 404, { ok: false }); return true; }
    json(res, 200, { ok: true, appId });
    return true;
  }

  if (url.pathname === "/api/apps/server-code" && method === "GET") {
    const result = appServerCode(String(url.searchParams.get("id") || ""));
    if (!result) { json(res, 404, { ok: false, error: "no server code" }); return true; }
    json(res, 200, result);
    return true;
  }

  // ── 给 overseer:应用的 binding 执行端 ──
  if (url.pathname === "/api/app/db" && method === "POST") {
    try {
      const body = await readBody(req);
      json(res, 200, { ok: true, ...execAppSql(appIdOf(body), String(body?.sql || ""), body?.params) });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/api/app/db-batch" && method === "POST") {
    try {
      const body = await readBody(req);
      json(res, 200, { ok: true, ...batchAppSql(appIdOf(body), body?.statements || []) });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/api/app/asset" && method === "POST") {
    try {
      const body = await readBody(req);
      const b64 = appAsset(appIdOf(body), String(body?.path || "/"));
      if (b64 === null) { json(res, 404, { ok: false, error: "asset not found" }); return true; }
      json(res, 200, { ok: true, b64 });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
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

  if (url.pathname === "/api/app/ai" && method === "POST") {
    try {
      const body = await readBody(req);
      json(res, 200, {
        ok: true,
        ...await runAppAi({
          appId: appIdOf(body),
          summary: String(body?.summary || ""),
          system: String(body?.system || ""),
          prompt: String(body?.prompt || ""),
        }),
      });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  if (url.pathname === "/api/app/agent" && method === "POST") {
    try {
      const body = await readBody(req);
      json(res, 200, {
        ok: true,
        ...await runAppAgent({
          appId: appIdOf(body),
          summary: String(body?.summary || ""),
          message: String(body?.message || ""),
          workdir: body?.workdir ? String(body.workdir) : undefined,
        }),
      });
    } catch (e: any) {
      json(res, 400, { ok: false, error: String(e?.message || e) });
    }
    return true;
  }

  return false;
};
