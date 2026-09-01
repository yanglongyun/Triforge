// @ts-nocheck
// HTTP 层:只管解析请求 / 拼响应,业务都委托给 service。
import fs from "fs";
import nodePath from "path";
import { execFile } from "child_process";
import * as tree from "../service/tree.js";
import * as chats from "../service/chats.js";
import * as sites from "../service/sites.js";
import * as history from "../service/history.js";
import { handleWidgetRoutes } from "./widget.js";
import { handleAppRoutes } from "./app.js";
import { handlePermissionRoutes } from "./permission.js";
import { handleHostRoutes } from "../host/appBridge.js";
import { listRows } from "../repo/messages.js";
import { listTasks } from "../repo/tasks.js";
import { runningIds } from "../runs/index.js";
import { getSettings, saveSettings } from "../repo/settings.js";
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitDiff,
  gitDiscard,
  gitFilePair,
  gitLog,
  gitShow,
  gitInit,
  gitRemoteAction,
  gitStage,
  gitUnstage,
  listGitRepositories,
  repositoryStatusForPath,
} from "../repo/git.js";
import { pickDirectory } from "../host/directoryPicker.js";
import { syncWatchers } from "../host/watcher.js";
import * as files from "../host/files.js";
import { serveFavicon } from "../host/favicons.js";

const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
};

const json = (res, code, data) => {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2) + "\n");
};

// 静态文件 mime —— 给 /api/fs(按路径服务,供 HTML 预览解析相对资源)和 /api/file/raw 复用
const MIME = {
  ".html": "text/html", ".htm": "text/html",
  ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".bmp": "image/bmp", ".avif": "image/avif", ".pdf": "application/pdf",
  ".txt": "text/plain", ".md": "text/plain",
};
const serveFile = (res, abs) => {
  const type = MIME[nodePath.extname(abs).toLowerCase()] || "application/octet-stream";
  const textish = type.startsWith("text/") || type.endsWith("json") || type.endsWith("svg+xml");
  res.writeHead(200, {
    "Content-Type": textish ? `${type}; charset=utf-8` : type,
    "Cache-Control": "no-cache",
  });
  res.end(fs.readFileSync(abs));
};

const handleApi = async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const path = url.pathname;
  const method = req.method;

  try {
    if (path === "/health") return json(res, 200, { ok: true });

    // 组件的路由面(注册表 / 地址 / 卸载)
    if (await handleWidgetRoutes(req, res, url, String(method || "GET").toUpperCase())) return true;

    // 应用:界面用的路由面 + app 自己调的宿主能力面(/host/*,token 即身份)
    if (await handleAppRoutes(req, res, url, String(method || "GET").toUpperCase())) return true;
    if (await handleHostRoutes(req, res, path)) return true;

    // 权限:规则 CRUD + 审批表态
    if (await handlePermissionRoutes(req, res, url, String(method || "GET").toUpperCase())) return true;

    // ---- 附件(图片/文件上传;内容寻址,消息里只存元数据)----
    if (path === "/api/upload" && method === "POST") {
      const body = await parseBody(req);
      try { return json(res, 201, { ok: true, attachment: files.upload(body) }); }
      catch (error) { return json(res, 400, { ok: false, error: error.message }); }
    }
    if (path.startsWith("/api/files/") && method === "GET") {
      const id = decodeURIComponent(path.slice("/api/files/".length));
      if (files.serve(id, res)) return;
      return json(res, 404, { ok: false, error: "文件不存在" });
    }

    // ---- 网站图标(抓取+缓存代理,直连站点自身)----
    if (path === "/api/favicon" && method === "GET") {
      return serveFavicon(url.searchParams.get("url"), res);
    }

    // ---- chats(会话列表:对话不在树上,住 SQLite,绑定 workdir)----
    if (path === "/api/chats") {
      if (method === "GET") return json(res, 200, { ok: true, chats: chats.list() });
      if (method === "POST") {
        const body = await parseBody(req);
        try { return json(res, 201, { ok: true, item: chats.create(body) }); }
        catch (error) { return json(res, 400, { ok: false, error: error.message }); }
      }
      if (method === "PATCH") {
        const body = await parseBody(req);
        try { return json(res, 200, { ok: true, item: chats.update(url.searchParams.get("id"), body) }); }
        catch (error) { return json(res, 400, { ok: false, error: error.message }); }
      }
      if (method === "DELETE") {
        const id = url.searchParams.get("id");
        if (!id) return json(res, 400, { ok: false, error: "id is required" });
        return json(res, 200, { ok: true, deleted: chats.remove(id) });
      }
    }
    if (path === "/api/chats/get" && method === "GET") {
      const item = chats.get(url.searchParams.get("id"));
      if (!item) return json(res, 404, { ok: false, error: "not found" });
      return json(res, 200, { ok: true, item });
    }
    if (path === "/api/chats/read" && method === "POST") {
      return json(res, 200, { ok: true, item: chats.markRead(url.searchParams.get("id")) });
    }

    // ---- sites(原生「网站」面板的收藏)----
    if (path === "/api/sites") {
      if (method === "GET") return json(res, 200, { ok: true, sites: sites.list() });
      if (method === "POST") {
        const body = await parseBody(req);
        try { return json(res, 201, { ok: true, item: sites.create(body) }); }
        catch (error) { return json(res, 400, { ok: false, error: error.message }); }
      }
      if (method === "PATCH") {
        const body = await parseBody(req);
        try { return json(res, 200, { ok: true, item: sites.update(url.searchParams.get("id"), body) }); }
        catch (error) { return json(res, 400, { ok: false, error: error.message }); }
      }
      if (method === "DELETE") {
        return json(res, 200, { ok: true, deleted: sites.remove(url.searchParams.get("id")) });
      }
    }

    // 新建文件夹;整层顺序重排(拖拽后一次发全量,顺序与归属一起改)
    if (path === "/api/sites/folder" && method === "POST") {
      const body = await parseBody(req);
      try { return json(res, 201, { ok: true, item: sites.createFolder(body) }); }
      catch (error) { return json(res, 400, { ok: false, error: error.message }); }
    }
    if (path === "/api/sites/order" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, sites: sites.reorder(body) });
    }

    // ---- history(浏览记录)----
    if (path === "/api/history") {
      if (method === "GET") {
        return json(res, 200, {
          ok: true,
          history: history.list({ q: url.searchParams.get("q"), limit: Number(url.searchParams.get("limit")) }),
        });
      }
      if (method === "DELETE") {
        return json(res, 200, {
          ok: true,
          forgot: history.forget({ url: url.searchParams.get("url"), all: url.searchParams.get("all") === "1" }),
        });
      }
    }
    if (path === "/api/history/visit" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, noted: history.visit(body) });
    }

    // ---- tree(纯文件树:文件夹 / 文件)----
    if (path === "/api/tree/copy" && method === "POST") {
      const body = await parseBody(req);
      try { return json(res, 201, { ok: true, item: tree.copy(body.id, body.parentId || null) }); }
      catch (error) { return json(res, 400, { ok: false, error: error.message }); }
    }
    if (path === "/api/tree/import" && method === "POST") {
      const body = await parseBody(req);
      try { return json(res, 201, { ok: true, item: tree.importFile(body) }); }
      catch (error) { return json(res, 400, { ok: false, error: error.message }); }
    }

    if (path === "/api/tree") {
      if (method === "GET") {
        return json(res, 200, { ok: true, items: tree.listChildren(url.searchParams.get("parentId")) });
      }
      if (method === "POST") {
        const body = await parseBody(req);
        try {
          return json(res, 201, { ok: true, item: tree.create(body) });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
      if (method === "PATCH") {
        const id = url.searchParams.get("id");
        const body = await parseBody(req);
        try {
          return json(res, 200, { ok: true, item: tree.update(id, body) });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
      if (method === "DELETE") {
        try {
          tree.remove(url.searchParams.get("id"));
          return json(res, 200, { ok: true });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
    }

    // ---- workspaces(root folders)----
    if (path === "/api/workspaces/pick" && method === "POST") {
      try {
        return json(res, 200, { ok: true, path: await pickDirectory() });
      } catch (error) {
        return json(res, 400, { ok: false, error: error.message });
      }
    }

    if (path === "/api/workspaces") {
      if (method === "GET") return json(res, 200, { ok: true, workspaces: tree.listWorkspaces() });
      if (method === "POST") {
        const body = await parseBody(req);
        try {
          const item = tree.addWorkspace(body);
          syncWatchers(); // 新根挂上文件监听
          return json(res, 201, { ok: true, item });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
      if (method === "DELETE") {
        try {
          const workspace = tree.removeWorkspace(url.searchParams.get("id"));
          syncWatchers(); // 摘掉的根不再监听
          return json(res, 200, { ok: true, workspace });
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
      }
    }

    if (path === "/api/tree/get") {
      const item = tree.getItem(url.searchParams.get("id"));
      if (!item) return json(res, 404, { ok: false, error: "not found" });
      return json(res, 200, { ok: true, item });
    }

    // 全树扁平列表(⌘P 快速打开)
    // 任务:应用触发的 agent 轮次(见 host/appTasks.ts)
    if (path === "/api/tasks" && method === "GET") {
      return json(res, 200, { ok: true, tasks: listTasks(Number(url.searchParams.get("limit")) || 50) });
    }

    if (path === "/api/tree/all" && method === "GET") {
      return json(res, 200, { ok: true, items: tree.listAll() });
    }

    // 标记对话已读

    // 全局内容搜索(⌘⇧F):grep 真实文件
    if (path === "/api/search" && method === "GET") {
      return json(res, 200, { ok: true, results: tree.search(url.searchParams.get("q") || "") });
    }

    // 原始文件流(图片/PDF 等二进制预览用)
    if (path === "/api/file/raw" && method === "GET") {
      const abs = tree.fileRawAbs(url.searchParams.get("id"));
      if (!abs) return json(res, 404, { ok: false, error: "not found" });
      const RAW_MIME = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
        ".ico": "image/x-icon", ".bmp": "image/bmp", ".avif": "image/avif",
        ".pdf": "application/pdf",
      };
      const ext = nodePath.extname(abs).toLowerCase();
      res.writeHead(200, {
        "Content-Type": RAW_MIME[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(fs.readFileSync(abs));
      return;
    }

    if (path === "/api/ancestry") {
      return json(res, 200, { ok: true, ancestry: tree.ancestry(url.searchParams.get("id")) });
    }

    // ---- messages(某个对话的邮箱)----
    if (path === "/api/messages" && method === "GET") {
      return json(res, 200, { ok: true, rows: listRows(url.searchParams.get("chatId")) });
    }

    // ---- 谁在跑(界面初始化对账;实时靠 conversation.* 事件)----
    if (path === "/api/runs" && method === "GET") {
      return json(res, 200, { ok: true, ids: runningIds() });
    }


    // ---- git ----
    if (path === "/api/git/status" && method === "GET") {
      return json(res, 200, { ok: true, repositories: listGitRepositories() });
    }
    if (path === "/api/git/repository" && method === "GET") {
      return json(res, 200, { ok: true, repository: repositoryStatusForPath(url.searchParams.get("path")) });
    }
    if (path === "/api/git/diff" && method === "GET") {
      return json(res, 200, {
        ok: true,
        diff: gitDiff({
          root: url.searchParams.get("root"),
          filePath: url.searchParams.get("path"),
          staged: url.searchParams.get("staged") === "1",
        }),
      });
    }
    // merge 视图用:两份完整内容(unstaged = 暂存区 vs 工作树;staged = HEAD vs 暂存区;
    // 带 commit = 历史视图:父提交 vs 该提交)
    if (path === "/api/git/file-pair" && method === "GET") {
      return json(res, 200, {
        ok: true,
        ...gitFilePair({
          root: url.searchParams.get("root"),
          filePath: url.searchParams.get("path"),
          staged: url.searchParams.get("staged") === "1",
          commit: url.searchParams.get("commit") || "",
        }),
      });
    }
    if (path === "/api/git/log" && method === "GET") {
      return json(res, 200, { ok: true, ...gitLog({ root: url.searchParams.get("root"), limit: Number(url.searchParams.get("limit")) || 50 }) });
    }
    if (path === "/api/git/show" && method === "GET") {
      return json(res, 200, { ok: true, ...gitShow({ root: url.searchParams.get("root"), hash: url.searchParams.get("hash") }) });
    }
    if (path === "/api/git/branches" && method === "GET") {
      return json(res, 200, { ok: true, ...gitBranches(url.searchParams.get("root")) });
    }
    if (path === "/api/git/stage" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, repository: gitStage(body) });
    }
    if (path === "/api/git/unstage" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, repository: gitUnstage(body) });
    }
    if (path === "/api/git/discard" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, repository: gitDiscard(body) });
    }
    if (path === "/api/git/commit" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, ...gitCommit(body) });
    }
    if (path === "/api/git/remote" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, ...gitRemoteAction(body) });
    }
    if (path === "/api/git/checkout" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, ...gitCheckout(body) });
    }
    if (path === "/api/git/init" && method === "POST") {
      const body = await parseBody(req);
      return json(res, 200, { ok: true, ...gitInit(body) });
    }

    // ---- settings ----
    if (path === "/api/settings") {
      if (method === "GET") return json(res, 200, { ok: true, settings: getSettings() });
      if (method === "POST") {
        const body = await parseBody(req);
        return json(res, 200, { ok: true, settings: saveSettings(body) });
      }
    }

    // 在系统文件管理器里显示该节点(macOS Finder / Windows 资源管理器 / Linux 文件管理器)
    if (path === "/api/reveal" && method === "POST") {
      const id = url.searchParams.get("id");
      // 对话 = 打开它的工作目录;文件/文件夹 = 其自身路径
      const abs = chats.get(id)?.workdir || tree.pathForId(id);
      if (!abs) return json(res, 404, { ok: false, error: "not found" });
      const plt = process.platform;
      let cmd, args;
      if (plt === "darwin") { cmd = "open"; args = ["-R", abs]; }
      else if (plt === "win32") { cmd = "explorer"; args = [`/select,${abs}`]; }
      else { cmd = "xdg-open"; args = [nodePath.dirname(abs)]; }
      execFile(cmd, args, () => {}); // 部分平台(如 explorer)成功也返回非 0,忽略
      return json(res, 200, { ok: true, path: abs });
    }

    // 按路径服务工作区内文件(HTML 预览用 —— iframe 在 /api/fs/<dir>/index.html,
    // 相对的 styles.css 自然解析到 /api/fs/<dir>/styles.css)。仅限工作区根内的文件。
    if (path.startsWith("/api/fs/") && method === "GET") {
      let abs;
      try { abs = decodeURIComponent(path.slice("/api/fs".length)); }
      catch { abs = path.slice("/api/fs".length); }
      const real = tree.fileRawAbs(abs);
      if (!real) return json(res, 404, { ok: false, error: "not found" });
      serveFile(res, real);
      return;
    }

    if (path.startsWith("/api/")) return json(res, 404, { ok: false, error: "Not found" });
    return null;
  } catch (error) {
    json(res, 500, { ok: false, error: error.message });
  }
};

export { handleApi };
