// 附件:图片 / 文件上传(内容寻址,消息里只存元数据),按 id 取回。
import type { IncomingMessage, ServerResponse } from "node:http";
import * as files from "../../chat/files.js";
import { attempt, json, parseBody } from "./helpers.js";

export const handleFileRoutes = async (req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> => {
  const path = url.pathname;
  if (path === "/api/upload" && method === "POST") return attempt(res, 201, async () => ({ attachment: files.upload(await parseBody(req)) }));
  if (path.startsWith("/api/files/") && method === "GET") {
    const id = decodeURIComponent(path.slice("/api/files/".length));
    if (files.serve(id, res)) return true;
    json(res, 404, { ok: false, error: "文件不存在" }); return true;
  }
  return false;
};
