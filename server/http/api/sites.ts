// 网站面板:收藏(一棵浅树)、浏览记录、站点图标代理。
import type { IncomingMessage, ServerResponse } from "node:http";
import * as sites from "../../sites/sites.js";
import * as history from "../../sites/history.js";
import { serveFavicon } from "../../sites/favicons.js";
import { attempt, json, parseBody } from "./helpers.js";

export const handleSiteRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  const path = url.pathname;
  if (path === "/api/favicon" && method === "GET") { serveFavicon(url.searchParams.get("url"), res); return true; }

  if (path === "/api/sites") {
    if (method === "GET") { json(res, 200, { ok: true, sites: sites.list() }); return true; }
    if (method === "POST") return attempt(res, 201, async () => ({ item: sites.create(await parseBody(req)) }));
    if (method === "PATCH") return attempt(res, 200, async () => ({ item: sites.update(String(url.searchParams.get("id") || ""), await parseBody(req)) }));
    if (method === "DELETE") { json(res, 200, { ok: true, deleted: sites.remove(String(url.searchParams.get("id") || "")) }); return true; }
  }
  // 新建文件夹;整层顺序重排(拖拽后一次发全量,顺序与归属一起改)
  if (path === "/api/sites/folder" && method === "POST") return attempt(res, 201, async () => ({ item: sites.createFolder(await parseBody(req)) }));
  if (path === "/api/sites/order" && method === "POST") { json(res, 200, { ok: true, sites: sites.reorder(await parseBody(req)) }); return true; }

  if (path === "/api/history") {
    if (method === "GET") {
      json(res, 200, { ok: true, history: history.list({ q: url.searchParams.get("q") ?? undefined, limit: Number(url.searchParams.get("limit")) }) });
      return true;
    }
    if (method === "DELETE") {
      json(res, 200, { ok: true, forgot: history.forget({ url: url.searchParams.get("url") ?? undefined, all: url.searchParams.get("all") === "1" }) });
      return true;
    }
  }
  if (path === "/api/history/visit" && method === "POST") { json(res, 200, { ok: true, noted: history.visit(await parseBody(req)) }); return true; }
  return false;
};
