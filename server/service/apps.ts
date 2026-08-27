// 工作区应用注册表:应用 = 工作区里的一个目录(<workspace>/apps/<id>/app.json + 入口 HTML)。
// 「安装」= 目录存在;「移除」= 删目录。agent 用 write 工具就能造应用 —— 见 APP.md。
import fs from "fs";
import path from "path";
import { listWorkspaces } from "../repo/tree.js";

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ENTRY = /^[\w./-]+\.html$/;

export type WorkspaceApp = {
  id: string;
  name: string;
  icon: string;
  mounts: { panel?: string; tab?: string };
  capabilities: string[];
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
    return {
      id,
      name: String(raw?.name || id).slice(0, 32),
      icon: String(raw?.icon || "📦").slice(0, 8),
      mounts,
      capabilities: Array.isArray(raw?.capabilities) ? raw.capabilities.map((c: unknown) => String(c)).slice(0, 16) : [],
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
