// 工作区应用注册表:应用 = 工作区里的一个目录(<workspace>/apps/<id>/app.json + 入口 HTML)。
// 「安装」= 目录存在;「移除」= 删目录。agent 用 write 工具就能造应用 —— 见 APP.md。
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { listWorkspaces } from "../repo/tree.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.WORKBENCH_HOME || path.join(__dirname, "../..");
const UI_DIST = process.env.WORKBENCH_UI_DIST || path.join(HOME, "ui/dist");

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENTRY = /^[\w./-]+\.html$/;
const SERVER_ENTRY = /^[\w.-]+\.js$/;

export type WorkspaceApp = {
  id: string;
  name: string;
  icon: string;
  mounts: { panel?: string; tab?: string };
  capabilities: string[];
  /** 应用后端入口(workerd 里跑的 server.js,导出 Gadget 类)。 */
  server?: string;
  source: "workspace";
  dir: string; // 绝对路径(仅服务端内部用,不下发敏感细节也无妨 —— 本机产品)
};

const readManifest = (dir: string): WorkspaceApp | null => {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "app.json"), "utf8"));
    const id = String(raw?.id || path.basename(dir)).toLowerCase();
    if (!APP_ID.test(id)) return null;
    const mounts: WorkspaceApp["mounts"] = {};
    for (const key of ["panel", "tab"] as const) {
      const entry = raw?.mounts?.[key];
      if (typeof entry === "string" && ENTRY.test(entry) && !entry.includes("..")) mounts[key] = entry;
    }
    if (!mounts.panel && !mounts.tab) return null; // 至少一个挂载点
    const server = typeof raw?.server === "string" && SERVER_ENTRY.test(raw.server) && !raw.server.includes("..")
      ? raw.server : undefined;
    return {
      id,
      name: String(raw?.name || id).slice(0, 32),
      icon: String(raw?.icon || "📦").slice(0, 8),
      mounts,
      capabilities: Array.isArray(raw?.capabilities) ? raw.capabilities.map((c: unknown) => String(c)).slice(0, 16) : [],
      server,
      source: "workspace",
      dir,
    };
  } catch {
    return null;
  }
};

export const listWorkspaceApps = (): WorkspaceApp[] => {
  const out: WorkspaceApp[] = [];
  const seen = new Set<string>();
  for (const workspace of listWorkspaces() as { path: string }[]) {
    const appsDir = path.join(workspace.path, "apps");
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(appsDir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const app = readManifest(path.join(appsDir, entry.name));
      if (app && !seen.has(app.id)) { seen.add(app.id); out.push(app); }
    }
  }
  return out;
};

/** 应用目录内文件的绝对路径(路径穿越防护)。 */
export const appFileAbs = (appId: string, rel: string) => {
  const app = listWorkspaceApps().find((a) => a.id === appId);
  if (!app) return null;
  const abs = path.normalize(path.join(app.dir, rel));
  if (!abs.startsWith(app.dir + path.sep) && abs !== app.dir) return null;
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
};

/** 应用后端代码(workerd overseer 取码用):工作区应用优先,其次预装应用(UI 资产目录)。 */
export const appServerCode = (appId: string): { code: string; capabilities: string[]; version: string } | null => {
  if (!APP_ID.test(appId)) return null;
  let dir: string | null = null;
  let app: WorkspaceApp | null = listWorkspaceApps().find((a) => a.id === appId) || null;
  if (app?.server) {
    dir = app.dir;
  } else {
    // 预装应用:manifest 与代码都在 UI 资产目录(打包后 core/ui/apps/<id>/)
    const presetDir = path.join(UI_DIST, "apps", appId);
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(presetDir, "app.json"), "utf8"));
      const server = typeof raw?.server === "string" && SERVER_ENTRY.test(raw.server) && !raw.server.includes("..") ? raw.server : undefined;
      if (!server) return null;
      app = {
        id: appId,
        name: String(raw?.name || appId),
        icon: String(raw?.icon || "📦"),
        mounts: {},
        capabilities: Array.isArray(raw?.capabilities) ? raw.capabilities.map((c: unknown) => String(c)) : [],
        server,
        source: "workspace",
        dir: presetDir,
      };
      dir = presetDir;
    } catch { return null; }
  }
  if (!app?.server || !dir) return null;
  try {
    const code = fs.readFileSync(path.join(dir, app.server), "utf8");
    const version = createHash("sha256").update(code).digest("hex").slice(0, 16);
    return { code, capabilities: app.capabilities, version };
  } catch { return null; }
};
