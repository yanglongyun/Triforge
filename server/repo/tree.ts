// @ts-nocheck
// 文件系统即树 —— 而且**只有**文件系统的东西:
//   目录     = 空间(space)—— 唯一会无限自嵌套的容器
//   真实文件 = 文件(file)—— 内容就是文件内容
//
// 对话不在这棵树上:对话是过程,不是用户的资产,住 SQLite(repo/chats.ts),
// 只通过 workdir 绑定到某个目录。目录改名/移动/删除时,这里负责把绑定跟着搬家。
// id 规则:space / file = 绝对路径(改名/移动即变,前端重拉,无需 fs↔DB 同步)。

import fs from "fs";
import os from "os";
import path from "path";
import { getDb } from "../db.js";

// 没有「工作区」这一层:整台机器就是台面。
//   树顶 = 用户主目录(~),文件面板默认摊开桌面;
//   产品自己的东西(应用/组件/它们的数据)住 ~/.mainbench,不混进用户看得见的目录。
const ROOT = path.resolve(process.env.WORKBENCH_ROOT || os.homedir());
const PRODUCT_HOME = path.resolve(process.env.WORKBENCH_PRODUCT_HOME || path.join(os.homedir(), ".mainbench"));
const SEP = path.sep;

/** 产品的家(应用、组件、数据)。 */
const productHome = () => { fs.mkdirSync(PRODUCT_HOME, { recursive: true }); return PRODUCT_HOME; };
/** 默认落脚点:桌面。没有桌面的系统退回主目录。 */
const defaultDir = () => {
  const desktop = path.join(ROOT, "Desktop");
  try { if (fs.statSync(desktop).isDirectory()) return desktop; } catch {}
  return ROOT;
};

const isPathId = (id) => typeof id === "string" && id.startsWith("/");
const normalizeAbs = (p) => path.resolve(String(p || "").trim());
const withSep = (abs) => abs.endsWith(SEP) ? abs : abs + SEP;
const isUnder = (abs, root) => abs === root || abs.startsWith(withSep(root));
const isAllowedPath = (abs) => isUnder(normalizeAbs(abs), ROOT);
/** 主目录的直接子项(桌面、文稿、code…):树的顶层行,不能在树里删/移/改名 —— 那是系统目录。 */
const isTopLevel = (abs) => path.dirname(normalizeAbs(abs)) === ROOT;
const parentAbsOf = (abs) => isTopLevel(abs) ? null : path.dirname(normalizeAbs(abs));
// 主目录顶层的噪音:点开头的配置目录(.npm/.cache/.zshrc…)和 Library。
// 只在 ~ 这一层过滤 —— 项目里的 .dev/.github 照常显示(那是内容,不是配置)。
const isRootNoise = (name) => name.startsWith(".") || name === "Library";
// 点开头不等于隐藏:.dev / .github / .gitignore 都是要看的(VS Code 同款语义)。
// 真正藏起来的只有系统噪音文件;噪音目录走 IGNORE_DIRS(.git 在其中)。
const IGNORE_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
// SQLite 的附属文件(应用 data.db 旁边那两个)不上树:一个库显示三个文件纯属噪音
const isHidden = (name) => IGNORE_FILES.has(name) || /\.(db|sqlite)-(wal|shm)$/.test(name);
// 递归(搜索 / 删除子树)时跳过的重目录 —— 跟 VSCode 一样不索引它们,
// 否则 AI 一 npm install,node_modules 几万文件会拖垮一切。
const IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", "out", "target", "vendor",
  ".git", ".next", ".cache", ".turbo", ".gradle", ".venv", "__pycache__",
]);
// 允许 .dev 这类点开头的名字;只挡路径分隔符和 "." / ".." 两个特殊目录名
const sanitize = (title) => {
  const t = String(title || "").trim().replace(/[/\\]/g, "-");
  return (t === "." || t === ".." ? "" : t) || "未命名";
};

const statCreatedAt = (abs) => {
  try { const s = fs.statSync(abs); return new Date(s.birthtimeMs || s.mtimeMs).toISOString(); }
  catch { return null; }
};

// ── 目录变动时给对话搬家:workdir 是路径数据,路径变了数据要跟上 ──
// 改名/移动 = 前缀替换;删除 = 塌缩到父目录(家没了,但对话不能跟着蒸发)。
const reprefixAgents = (oldDir, newDir) => {
  const from = withSep(normalizeAbs(oldDir));
  const db = getDb();
  db.prepare("UPDATE chats SET workdir = ? WHERE workdir = ?").run(normalizeAbs(newDir), normalizeAbs(oldDir));
  db.prepare("UPDATE chats SET workdir = ? || substr(workdir, ?) WHERE substr(workdir, 1, ?) = ?")
    .run(withSep(normalizeAbs(newDir)), from.length + 1, from.length, from);
};
const collapseAgents = (dir, target) => {
  const from = withSep(normalizeAbs(dir));
  getDb().prepare("UPDATE chats SET workdir = ? WHERE workdir = ? OR substr(workdir, 1, ?) = ?")
    .run(normalizeAbs(target), normalizeAbs(dir), from.length, from);
};

// ── 构造统一 item ──
const spaceItem = (abs) => {
  const full = normalizeAbs(abs);
  return {
    id: full, parent_id: parentAbsOf(full), kind: "space",
    title: path.basename(full), system: null, content: null, position: null, last_read_at: null, created_at: null,
  };
};
const MAX_TEXT = 2_000_000;
const fileItem = (abs, withContent = false) => {
  const node = {
    id: abs, parent_id: parentAbsOf(abs), kind: "file",
    title: path.basename(abs), system: null, content: null, position: null, last_read_at: null, created_at: null,
    size: 0, binary: false, tooLarge: false,
  };
  if (!withContent) return node;
  node.created_at = statCreatedAt(abs);
  try { node.size = fs.statSync(abs).size; } catch {}
  if (node.size > MAX_TEXT) { node.tooLarge = true; return node; }
  let buf; try { buf = fs.readFileSync(abs); } catch { return node; }
  if (buf.subarray(0, 8192).includes(0)) { node.binary = true; return node; } // 二进制(NUL 字节)
  node.content = buf.toString("utf8");
  return node;
};

// 把 file id 解析成磁盘绝对路径(给 /api/file/raw 用);非文件返回 null
const resolveFileAbs = (id) => {
  const hit = locate(id);
  return hit && hit.kind === "file" ? hit.abs : null;
};

// 任意节点 → 磁盘绝对路径(文件夹=目录,文件=文件)。仅工作区内有效。
const pathForId = (id) => { const hit = locate(id); return hit ? hit.abs : null; };

// SKILL.md → { name, description }:优先 frontmatter,回退到首个标题 / 首行
const parseSkill = (content, fallbackName) => {
  let name = fallbackName, description = "";
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const n = fm[1].match(/^name:\s*(.+)$/m); if (n) name = n[1].trim().replace(/^["']|["']$/g, "");
    const d = fm[1].match(/^description:\s*(.+)$/m); if (d) description = d[1].trim().replace(/^["']|["']$/g, "");
  }
  if (!description) {
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const h = body.match(/^#\s+(.+)$/m); if (h && !name) name = h[1].trim();
    const firstPara = body.split(/\n\s*\n/).map((s) => s.replace(/^#+\s*/, "").trim()).find((s) => s.length > 0);
    description = (firstPara || "").slice(0, 200);
  }
  return { name, description };
};

// 对话上下文:只看对话「自己所在的那个文件夹」—— 同级的 AGENTS.md / CLAUDE.md(指令)
// 和 skills/<名>/SKILL.md(可用技能)。不向上继承、不向下穿透:作用范围仅同级。
// 这些都只是树里的文件,放哪个文件夹就只对那个文件夹里的对话生效。
const CONTEXT_DOC_NAMES = ["AGENTS.md", "CLAUDE.md"];
const agentContext = (startDir) => {
  const dir = normalizeAbs(startDir);
  if (!isAllowedPath(dir)) return { docs: [], skills: [] };
  const docs = [], skills = [];
  for (const nm of CONTEXT_DOC_NAMES) {
    const p = path.join(dir, nm);
    try {
      if (fs.statSync(p).isFile()) docs.push({ name: nm, rel: nm, content: fs.readFileSync(p, "utf8").slice(0, 6000) });
    } catch {}
  }
  const skillsDir = path.join(dir, "skills");
  try {
    for (const e of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!e.isDirectory() || isHidden(e.name)) continue;
      const sp = path.join(skillsDir, e.name, "SKILL.md");
      try {
        const meta = parseSkill(fs.readFileSync(sp, "utf8"), e.name);
        skills.push({ ...meta, rel: path.join("skills", e.name, "SKILL.md") });
      } catch {}
    }
  } catch {}
  return { docs, skills };
};

// 递归列出整棵树所有节点(给 ⌘P 快速打开用),跳过 IGNORE_DIRS / 隐藏。不读文件内容。
// 树顶是整个主目录,给个上限:够筛选用,不至于把下载/图片几万个文件全扫一遍。
const LIST_ALL_CAP = 20_000;
const listAll = () => {
  const out = [];
  const walk = (dir, top) => {
    if (out.length >= LIST_ALL_CAP) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= LIST_ALL_CAP) return;
      if (isHidden(e.name) || (top && isRootNoise(e.name))) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) { out.push(spaceItem(abs)); walk(abs, false); } }
      else out.push(fileItem(abs));
    }
  };
  walk(ROOT, true);
  return out;
};

// ── 定位 id 在磁盘上是什么 → { kind, abs } ──
const locate = (id) => {
  if (id == null || id === "") return null;
  const sid = String(id);
  if (!isPathId(sid)) return null; // 非路径 id(如对话 uuid)不归这棵树管
  const abs = normalizeAbs(sid);
  if (!isAllowedPath(abs)) return null;
  let st; try { st = fs.statSync(abs); } catch { return null; }
  return { kind: st.isDirectory() ? "space" : "file", abs };
};

const terminalCwd = (id) => {
  if (!id) return defaultDir();
  const hit = locate(id);
  if (hit) return hit.kind === "space" ? hit.abs : path.dirname(hit.abs);
  return defaultDir();
};

// ════════════════ 公开 API(统一树 facade)════════════════

const listChildren = (parentId) => {
  let dirAbs;
  if (!parentId) dirAbs = ROOT; // 树顶 = 主目录的子项
  else {
    const hit = locate(parentId);
    if (!hit || hit.kind !== "space") return [];
    dirAbs = hit.abs;
  }
  const top = dirAbs === ROOT;
  let entries; try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (isHidden(e.name) || (top && isRootNoise(e.name))) continue;
    const abs = path.join(dirAbs, e.name);
    if (e.isDirectory()) out.push(spaceItem(abs));
    else out.push(fileItem(abs));
  }
  // 排序:普通文件管理器规则 —— 文件夹在前,同类按名(不给任何文件特权)
  const rank = (n) => (n.kind === "space" ? 1 : 2);
  out.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  out.forEach((n, i) => { n.position = i + 1; });
  return out;
};

const getItem = (id) => {
  const hit = locate(id);
  if (!hit) return null;
  if (hit.kind === "space") return spaceItem(hit.abs);
  return fileItem(hit.abs, true);
};

const createItem = ({ kind, parentId = null, title, system = null, content = null }) => {
  let parentDir;
  if (parentId) {
    const hit = locate(parentId);
    if (!hit || hit.kind !== "space") throw new Error(`父级必须是文件夹: ${parentId}`);
    parentDir = hit.abs;
  } else parentDir = defaultDir();

  if (kind === "space") {
    const abs = path.join(parentDir, sanitize(title));
    fs.mkdirSync(abs, { recursive: true });
    return spaceItem(abs);
  }
  if (kind === "file") {
    const abs = path.join(parentDir, sanitize(title));
    fs.writeFileSync(abs, content != null ? String(content) : "");
    return fileItem(abs, true);
  }
  throw new Error(`未知类型: ${kind}`);
};

const updateItem = (id, { title, system, content, overwrite = false } = {}) => {
  const hit = locate(id);
  if (!hit) throw new Error(`not found: ${id}`);

  // 改名撞上同名:默认报错;overwrite=true 时旧的进废纸篓,不静默覆盖
  const renameGuard = (next) => {
    if (!fs.existsSync(next)) return;
    if (!overwrite) throw new Error(`目标已有同名:${path.basename(next)}`);
    trashItem(next);
  };

  if (hit.kind === "space" && isTopLevel(hit.abs) && title !== undefined) {
    throw new Error("主目录下的顶层文件夹(桌面、文稿…)不能在这里改名");
  }

  if (hit.kind === "file") {
    let abs = hit.abs;
    if (content !== undefined) fs.writeFileSync(abs, content == null ? "" : String(content));
    if (title !== undefined) {
      const next = path.join(path.dirname(abs), sanitize(title));
      if (next !== abs) { renameGuard(next); fs.renameSync(abs, next); abs = next; }
    }
    return fileItem(abs, true);
  }
  // space:改名 = 目录改名;住在子树上的对话跟着搬家
  let abs = hit.abs;
  if (title !== undefined) {
    const next = path.join(path.dirname(abs), sanitize(title));
    if (next !== abs) { renameGuard(next); fs.renameSync(abs, next); reprefixAgents(abs, next); abs = next; }
  }
  return spaceItem(abs);
};

/** 删除走废纸篓:macOS 移入 ~/.Trash(重名加时间戳),跨卷/失败或非 mac 退回永久删。 */
const trashItem = (abs) => {
  if (process.platform === "darwin") {
    try {
      const trash = path.join(process.env.HOME || "", ".Trash");
      fs.mkdirSync(trash, { recursive: true });
      let dest = path.join(trash, path.basename(abs));
      if (fs.existsSync(dest)) {
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
        const parsed = path.parse(path.basename(abs));
        dest = path.join(trash, `${parsed.name} ${stamp}${parsed.ext}`);
      }
      fs.renameSync(abs, dest);
      return true;
    } catch { /* 跨卷 EXDEV / 权限 → 永久删兜底 */ }
  }
  fs.rmSync(abs, { recursive: true, force: true });
  return false;
};

const deleteItem = (id) => {
  const hit = locate(id);
  if (!hit) return;
  if (hit.kind === "file") { trashItem(hit.abs); return; }
  if (isTopLevel(hit.abs)) throw new Error("主目录下的顶层文件夹(桌面、文稿…)不能在这里删除");
  // space:整目录进废纸篓;绑在这棵子树上的对话**不陪葬**——对话不是目录的附属品,
  // 它们的 workdir 塌缩到父目录,会话照常留在会话列表里
  trashItem(hit.abs);
  collapseAgents(hit.abs, path.dirname(hit.abs));
};

/** 目标目录里找一个不冲突的名字:name → name copy → name copy 2 …(带扩展名的插在扩展名前)。 */
const uniqueDest = (dir, name) => {
  let candidate = path.join(dir, name);
  if (!fs.existsSync(candidate)) return candidate;
  const parsed = path.parse(name);
  for (let i = 1; i < 100; i += 1) {
    const suffix = i === 1 ? " copy" : ` copy ${i}`;
    candidate = path.join(dir, `${parsed.name}${suffix}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error("重名副本太多");
};

// 复制到某空间下(targetParentId 缺省 = 原地出副本)。重名自动 「name copy」。
const copyItem = (id, targetParentId = null) => {
  const hit = locate(id);
  if (!hit) throw new Error(`not found: ${id}`);
  if (hit.kind === "space" && isTopLevel(hit.abs)) throw new Error("主目录下的顶层文件夹不能复制");
  let targetDir;
  if (targetParentId) {
    const ph = locate(targetParentId);
    if (!ph || ph.kind !== "space") throw new Error("目标必须是一个文件夹");
    targetDir = ph.abs;
  } else targetDir = path.dirname(hit.abs);
  if (hit.kind === "space" && (targetDir === hit.abs || targetDir.startsWith(withSep(hit.abs)))) {
    throw new Error("不能把文件夹复制进自己的子孙");
  }
  const dest = uniqueDest(targetDir, path.basename(hit.abs));
  fs.cpSync(hit.abs, dest, { recursive: true });
  return hit.kind === "space" ? spaceItem(dest) : fileItem(dest, true);
};

// 移到某空间下(newParentId 必须是空间或 null=根)。position 忽略(按名排序)。
// 目标已有同名:默认报错,overwrite=true 时把旧的送进废纸篓再落位(不静默覆盖)。
const moveItem = (id, newParentId, _position = undefined, overwrite = false) => {
  const hit = locate(id);
  if (!hit) throw new Error(`not found: ${id}`);
  if (hit.kind === "space" && isTopLevel(hit.abs)) throw new Error("主目录下的顶层文件夹不能移动");
  let targetDir;
  if (newParentId) {
    const ph = locate(newParentId);
    if (!ph || ph.kind !== "space") throw new Error("目标必须是一个文件夹");
    targetDir = ph.abs;
  } else targetDir = defaultDir();

  if (hit.kind === "space") {
    if (targetDir === hit.abs || targetDir.startsWith(withSep(hit.abs))) throw new Error("不能把文件夹移进自己的子孙");
  }
  const next = path.join(targetDir, path.basename(hit.abs));
  if (next !== hit.abs) {
    if (fs.existsSync(next)) {
      if (!overwrite) throw new Error(`目标已有同名:${path.basename(next)}`);
      trashItem(next);
    }
    fs.renameSync(hit.abs, next);
    if (hit.kind === "space") reprefixAgents(hit.abs, next); // 子树上的对话跟着搬家
  }
  if (hit.kind === "space") return spaceItem(next);
  return fileItem(next, true);
};

/** 外部拖入导入:把浏览器读到的文件内容落到 parentId 目录下(relPath 可带子目录)。 */
const importFile = ({ parentId = null, relPath, dataBase64 }) => {
  let baseDir;
  if (parentId) {
    const hit = locate(parentId);
    if (!hit || hit.kind !== "space") throw new Error("目标必须是一个文件夹");
    baseDir = hit.abs;
  } else baseDir = defaultDir();
  const rel = String(relPath || "").split("/").map((seg) => sanitize(seg)).filter(Boolean);
  if (!rel.length) throw new Error("文件名为空");
  const dir = path.join(baseDir, ...rel.slice(0, -1));
  fs.mkdirSync(dir, { recursive: true });
  const dest = uniqueDest(dir, rel[rel.length - 1]);
  fs.writeFileSync(dest, Buffer.from(String(dataBase64 || ""), "base64"));
  return fileItem(dest, true);
};

const ancestry = (id) => {
  const chain = [];
  let cur = getItem(id);
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parent_id != null ? getItem(cur.parent_id) : null;
  }
  return chain;
};

export {
  ROOT, productHome, defaultDir, isTopLevel, isRootNoise, IGNORE_DIRS, isAllowedPath,
  listChildren, listAll, getItem, createItem, updateItem, deleteItem, moveItem, copyItem, importFile, ancestry,
  resolveFileAbs, pathForId, agentContext, terminalCwd,
};
