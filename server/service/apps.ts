// 应用注册表:应用 = 工作区里的一个目录,本身就是一个完整的 Worker 网站(见 APP.md)。
//
//   <workspace>/apps/<id>/
//     app.json     manifest(挂载点 = 路由路径,能力声明)
//     server.js    Worker:export default { fetch(req, env) }
//     public/      静态资源(env.ASSETS 读这里)
//     data.db      数据(env.DB 落这里 —— 就在应用旁边,你和 AI 都能 sqlite3 撬开)
//
// 「安装」= 目录存在(扫描自动注册);「移除」= 删目录。AI 用 write 工具即可造应用。
// 预装应用随包发,首次启动落地到第一个工作区 —— 之后它就是普通工作区应用,可改可删。
import { createHash, randomBytes } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { listWorkspaces } from "../repo/tree.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.WORKBENCH_HOME || path.join(__dirname, "../..");
const UI_DIST = process.env.WORKBENCH_UI_DIST || path.join(HOME, "ui/dist");

const APP_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ROUTE = /^\/[\w./-]*$/;

export type AppInfo = {
  id: string;
  name: string;
  icon: string;
  /** 挂载点 = 应用内的路由路径(不是文件名):tab 在标签页打开,panel 可钉到侧栏。 */
  mounts: { panel?: string; tab?: string };
  capabilities: string[];
  dir: string;
};

const readManifest = (dir: string): AppInfo | null => {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "app.json"), "utf8"));
    const id = String(raw?.id || path.basename(dir)).toLowerCase();
    if (!APP_ID.test(id)) return null;
    if (!fs.existsSync(path.join(dir, "server.js"))) return null; // 应用即网站:server.js 必备
    const mounts: AppInfo["mounts"] = {};
    for (const key of ["panel", "tab"] as const) {
      const route = raw?.mounts?.[key];
      if (typeof route === "string" && ROUTE.test(route) && !route.includes("..")) mounts[key] = route;
    }
    if (!mounts.panel && !mounts.tab) mounts.tab = "/"; // 没写就默认在标签页开根路径
    return {
      id,
      name: String(raw?.name || id).slice(0, 32),
      icon: String(raw?.icon || "📦").slice(0, 8),
      mounts,
      capabilities: Array.isArray(raw?.capabilities) ? raw.capabilities.map((c: unknown) => String(c)).slice(0, 16) : [],
      dir,
    };
  } catch {
    return null;
  }
};

const workspaceRoots = () => (listWorkspaces() as { path: string }[]).map((w) => w.path);

export const listApps = (): AppInfo[] => {
  const out: AppInfo[] = [];
  const seen = new Set<string>();
  for (const root of workspaceRoots()) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(path.join(root, "apps"), { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
      const app = readManifest(path.join(root, "apps", entry.name));
      if (app && !seen.has(app.id)) { seen.add(app.id); out.push(app); }
    }
  }
  return out;
};

export const getApp = (appId: string): AppInfo | null =>
  (APP_ID.test(appId) ? listApps().find((a) => a.id === appId) || null : null);

/** 应用后端代码 + 版本(内容哈希 —— 改了 server.js 下次装载即新版)。 */
export const appServerCode = (appId: string) => {
  const app = getApp(appId);
  if (!app) return null;
  try {
    const code = fs.readFileSync(path.join(app.dir, "server.js"), "utf8");
    return { code, capabilities: app.capabilities, version: createHash("sha256").update(code).digest("hex").slice(0, 16) };
  } catch { return null; }
};

/** env.ASSETS 的实际读取:apps/<id>/public/ 下的文件,base64 回传(二进制安全)。 */
export const appAsset = (appId: string, rel: string) => {
  const app = getApp(appId);
  if (!app) return null;
  const base = path.join(app.dir, "public");
  const abs = path.normalize(path.join(base, rel.replace(/^\/+/, "")));
  if (!abs.startsWith(base + path.sep) && abs !== base) return null; // 路径穿越防护
  try {
    if (!fs.statSync(abs).isFile()) return null;
    if (fs.statSync(abs).size > 20 * 1024 * 1024) return null;
    return fs.readFileSync(abs).toString("base64");
  } catch { return null; }
};

/** 应用私有数据库的位置:就在应用目录里,和代码做邻居。 */
export const appDbPath = (appId: string) => {
  const app = getApp(appId);
  return app ? path.join(app.dir, "data.db") : null;
};

// ── 访问 token:每应用一个,每次启动重新生成 ──
// iframe 的 src 里带着它,应用能看到自己的 URL —— 所以 token 必须**只对应一个应用**,
// 否则应用甲能用自己 URL 里的凭据去访问应用乙。
const tokens = new Map<string, string>(); // token → appId
const byApp = new Map<string, string>();  // appId → token

export const appToken = (appId: string) => {
  const existing = byApp.get(appId);
  if (existing) return existing;
  const token = randomBytes(16).toString("hex");
  tokens.set(token, appId);
  byApp.set(appId, token);
  return token;
};
export const appIdForToken = (token: string) => tokens.get(String(token || "")) || null;

/** 预装应用落地:随包的出厂模板复制进第一个工作区,之后它就是用户自己的应用(可改可删)。 */
export const seedPresetApps = () => {
  const root = workspaceRoots()[0];
  if (!root) return;
  const presetDir = path.join(UI_DIST, "apps");
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(presetDir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(root, "apps", entry.name);
    if (fs.existsSync(target)) continue; // 已落地(哪怕用户改过)就不再覆盖
    try {
      fs.cpSync(path.join(presetDir, entry.name), target, { recursive: true });
      console.log(`[apps] 预装应用已落地:apps/${entry.name}`);
    } catch (e: any) {
      console.error(`[apps] 落地失败 ${entry.name}:`, e?.message);
    }
  }
};
