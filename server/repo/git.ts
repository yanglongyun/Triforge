// @ts-nocheck
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { IGNORE_DIRS, ROOT, isAllowedPath, isRootNoise } from "./tree.js";

const runGit = (cwd, args, { allowError = false, input = undefined } = {}) => {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 15000,
    }).trimEnd();
  } catch (error) {
    if (allowError) return String(error.stdout || "").trimEnd();
    const message = String(error.stderr || error.stdout || error.message || "git command failed").trim();
    throw new Error(message || "git command failed");
  }
};

const runGitMutation = (cwd, args) =>
  execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
  }).trimEnd();

const parseBranch = (line) => {
  const text = String(line || "").replace(/^##\s*/, "");
  const [namePart, metaPart = ""] = text.split(" [");
  const [branch = "", upstream = ""] = namePart.split("...");
  const ahead = Number(/\bahead\s+(\d+)/.exec(metaPart)?.[1] || 0);
  const behind = Number(/\bbehind\s+(\d+)/.exec(metaPart)?.[1] || 0);
  return { branch, upstream: upstream || null, ahead, behind };
};

const statusLabel = (x, y) => {
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "conflict";
  if (x === "?" && y === "?") return "untracked";
  if (x !== " " && y !== " ") return "staged+modified";
  if (x !== " ") return "staged";
  if (y !== " ") return "modified";
  return "changed";
};

const parseFile = (line, topLevel) => {
  const x = line[0] || " ";
  const y = line[1] || " ";
  const raw = line.slice(3);
  const renamed = raw.includes(" -> ");
  const file = renamed ? raw.split(" -> ").pop() : raw;
  const originalPath = renamed ? raw.split(" -> ")[0] : null;
  return {
    path: file,
    absPath: path.join(topLevel, file),
    originalPath,
    index: x,
    worktree: y,
    status: statusLabel(x, y),
    renamed,
    staged: x !== " " && x !== "?",
    unstaged: y !== " " && y !== "?",
  };
};

/** 某个目录的 git 状态。不是仓库也返回一条(isRepo=false),调用方自己决定要不要显示。 */
const getRepositoryStatus = (dir) => {
  const abs = path.resolve(String(dir || ""));
  try {
    const topLevel = runGit(abs, ["rev-parse", "--show-toplevel"]);
    const output = runGit(abs, ["status", "--porcelain=v1", "-b"]);
    const lines = output.split(/\r?\n/).filter(Boolean);
    const branch = parseBranch(lines[0] || "");
    const files = lines.slice(1).map((line) => parseFile(line, topLevel));
    return { title: path.basename(topLevel) || topLevel, dir: abs, root: topLevel, isRepo: true, ...branch, files };
  } catch {
    return { title: path.basename(abs) || abs, dir: abs, root: null, isRepo: false, branch: null, upstream: null, ahead: 0, behind: 0, files: [] };
  }
};

// 没有工作区列表可循,仓库靠**找**:从主目录出发浅扫三层(桌面/文稿/code/… 及其子项),
// 见到 .git 就算一个。跳过顶层噪音与 node_modules 之类;三层足够覆盖人放项目的地方,
// 又不至于把整块盘翻一遍。
const SCAN_DEPTH = 3;
const SCAN_CAP = 50;
const findRepoRoots = () => {
  const roots = [];
  const walk = (dir, depth, top) => {
    if (roots.length >= SCAN_CAP) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.name === ".git")) { roots.push(dir); return; } // 仓库里不再往下找嵌套仓库
    if (depth >= SCAN_DEPTH) return;
    for (const e of entries) {
      if (!e.isDirectory() || IGNORE_DIRS.has(e.name) || e.name.startsWith(".")) continue;
      if (top && isRootNoise(e.name)) continue;
      if (/\.(app|photoslibrary|musiclibrary|tvlibrary|bundle)$/i.test(e.name)) continue; // macOS 包目录
      walk(path.join(dir, e.name), depth + 1, false);
    }
  };
  walk(ROOT, 0, true);
  return roots;
};

const listGitRepositories = () => findRepoRoots().map(getRepositoryStatus).filter((repo) => repo.isRepo);

const withSep = (abs) => abs.endsWith(path.sep) ? abs : abs + path.sep;
const isUnder = (abs, root) => abs === root || abs.startsWith(withSep(root));
/** 这个目录本身是不是一个仓库根(不是仓库、或只是仓库里的子目录 → null)。 */
const repositoryStatusForPath = (rawPath) => {
  const abs = path.resolve(String(rawPath || ""));
  if (!isAllowedPath(abs)) return null;
  let st; try { st = fs.statSync(abs); } catch { return null; }
  if (!st.isDirectory()) return null;
  const repo = getRepositoryStatus(abs);
  return repo.isRepo && repo.root === abs ? repo : null;
};

const repoByRoot = (root) => {
  const requestedRoot = path.resolve(String(root || ""));
  const repo = repositoryStatusForPath(requestedRoot);
  if (repo?.root === requestedRoot) return repo;
  if (repo?.root) throw new Error("git repository root mismatch");
  const known = listGitRepositories().find((item) => item.isRepo && item.root === requestedRoot);
  if (known) return known;
  throw new Error("git repository not found");
};

const refreshRepo = (repo) => getRepositoryStatus(repo.root);

const ensureRelativePath = (filePath) => {
  const value = String(filePath || "").trim();
  if (!value || path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) throw new Error("invalid file path");
  return value;
};

const syntheticUntrackedDiff = (repoRoot, filePath) => {
  const abs = path.join(repoRoot, filePath);
  let content = "";
  try { content = fs.readFileSync(abs, "utf8"); } catch {}
  const lines = content.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${Math.max(lines.length, 1)} @@`,
    body || "+",
  ].join("\n");
};

const gitDiff = ({ root, filePath, staged = false }) => {
  const repo = repoByRoot(root);
  const file = ensureRelativePath(filePath);
  const status = repo.files.find((item) => item.path === file);
  if (status?.status === "untracked" && !staged) return syntheticUntrackedDiff(repo.root, file);
  const args = staged
    ? ["diff", "--cached", "--", file]
    : ["diff", "--", file];
  const diff = runGit(repo.root, args, { allowError: true });
  if (diff) return diff;
  if (status?.staged) return runGit(repo.root, ["diff", "--cached", "--", file], { allowError: true });
  return "";
};

// 两份完整内容(merge 视图用):unstaged 比「暂存区 vs 工作树」,staged 比「HEAD vs 暂存区」。
// 新文件/未跟踪 → before 为空;删除 → after 为空;含 \0 视为二进制,不出文本。
const gitFilePair = ({ root, filePath, staged = false, commit = "" }) => {
  const repo = repoByRoot(root);
  const file = ensureRelativePath(filePath);
  const show = (ref) => runGit(repo.root, ["show", `${ref}:${file}`], { allowError: true });
  const readWorktree = () => {
    try { return fs.readFileSync(path.join(repo.root, file), "utf8").replace(/\n$/, ""); } catch { return ""; }
  };
  // 带 commit = 看历史:父提交 vs 该提交(根提交/新增文件 before 为空)
  const before = commit ? show(`${ensureHash(commit)}^`) : staged ? show("HEAD") : show(":0");
  const after = commit ? show(ensureHash(commit)) : staged ? show(":0") : readWorktree();
  if (before.includes("\u0000") || after.includes("\u0000")) return { before: "", after: "", binary: true };
  return { before, after, binary: false };
};

const SHA = /^[0-9a-f]{7,40}$/i;
const ensureHash = (value) => {
  const hash = String(value || "").trim();
  if (!SHA.test(hash)) throw new Error("invalid commit hash");
  return hash;
};

/** 提交历史:最近 N 条。 */
const gitLog = ({ root, limit = 50 }) => {
  const repo = repoByRoot(root);
  const n = Math.max(1, Math.min(Number(limit) || 50, 200));
  const SEP = "\u001f";
  const out = runGit(repo.root, [
    "log", `-${n}`, `--pretty=format:%H${SEP}%h${SEP}%an${SEP}%ad${SEP}%s`, "--date=format:%Y-%m-%d %H:%M",
  ], { allowError: true });
  const commits = out
    ? out.split(/\r?\n/).filter(Boolean).map((line) => {
        const [hash, short, author, date, ...rest] = line.split(SEP);
        return { hash, short, author, date, subject: rest.join(SEP) };
      })
    : [];
  return { commits };
};

/** 一次提交动了哪些文件。 */
const gitShow = ({ root, hash }) => {
  const repo = repoByRoot(root);
  const commit = ensureHash(hash);
  const out = runGit(repo.root, ["show", commit, "--name-status", "--pretty=format:", "-M"], { allowError: true });
  const files = out.split(/\r?\n/).filter(Boolean).map((line) => {
    const parts = line.split("\t");
    const status = parts[0][0];
    return status === "R" || status === "C"
      ? { status, path: parts[2], oldPath: parts[1] }
      : { status, path: parts[1], oldPath: null };
  });
  return { files };
};

const gitBranches = (root) => {
  const repo = repoByRoot(root);
  const current = runGit(repo.root, ["branch", "--show-current"]);
  const rows = runGit(repo.root, ["branch", "--format=%(refname:short)"]).split(/\r?\n/).filter(Boolean);
  return { current, branches: rows };
};

const gitStage = ({ root, filePath, all = false }) => {
  const repo = repoByRoot(root);
  if (all) runGitMutation(repo.root, ["add", "-A"]);
  else runGitMutation(repo.root, ["add", "--", ensureRelativePath(filePath)]);
  return refreshRepo(repo);
};

const gitUnstage = ({ root, filePath, all = false }) => {
  const repo = repoByRoot(root);
  if (all) runGitMutation(repo.root, ["reset"]);
  else runGitMutation(repo.root, ["reset", "HEAD", "--", ensureRelativePath(filePath)]);
  return refreshRepo(repo);
};

const gitDiscard = ({ root, filePath }) => {
  const repo = repoByRoot(root);
  const file = ensureRelativePath(filePath);
  const status = repo.files.find((item) => item.path === file);
  if (!status) return refreshRepo(repo);
  if (status.status === "untracked") {
    fs.rmSync(path.join(repo.root, file), { recursive: true, force: true });
  } else {
    runGitMutation(repo.root, ["restore", "--staged", "--worktree", "--", file]);
  }
  return refreshRepo(repo);
};

const gitCommit = ({ root, message }) => {
  const repo = repoByRoot(root);
  const msg = String(message || "").trim();
  if (!msg) throw new Error("commit message is required");
  const output = runGitMutation(repo.root, ["commit", "-m", msg]);
  return { output, repository: refreshRepo(repo) };
};

const gitRemoteAction = ({ root, action }) => {
  const repo = repoByRoot(root);
  const map = {
    fetch: ["fetch"],
    pull: ["pull", "--ff-only"],
    push: ["push"],
  };
  let args = map[action];
  if (!args) throw new Error("unknown git remote action");
  if (action === "push") {
    // 新分支没有上游:git push 裸跑会拒 —— 自动 -u origin <branch>
    const upstream = runGit(repo.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { allowError: true });
    if (!upstream) {
      const branch = runGit(repo.root, ["branch", "--show-current"], { allowError: true });
      if (branch) args = ["push", "-u", "origin", branch];
    }
  }
  try {
    const output = runGitMutation(repo.root, args);
    return { output, repository: refreshRepo(repo) };
  } catch (error) {
    const raw = String(error?.stderr || error?.stdout || error?.message || "").trim();
    if (action === "pull" && /fast-forward|divergent|diverged/i.test(raw)) {
      throw new Error("远端历史和本地分叉了,快进不了。到终端(或让 AI)跑 git pull --rebase 处理后再来。");
    }
    throw new Error(raw || "git command failed");
  }
};

const gitCheckout = ({ root, branch }) => {
  const repo = repoByRoot(root);
  const name = String(branch || "").trim();
  if (!name || /[\s~^:?*[\]\\]/.test(name)) throw new Error("invalid branch name");
  const output = runGitMutation(repo.root, ["checkout", name]);
  const repository = refreshRepo(repo);
  return { output, repository, branches: gitBranches(repository.root) };
};

const gitInit = ({ path: rawPath }) => {
  const abs = path.resolve(String(rawPath || ""));
  if (!isAllowedPath(abs)) throw new Error("只能在主目录下初始化仓库");
  let st; try { st = fs.statSync(abs); } catch { throw new Error(`目录不存在: ${abs}`); }
  if (!st.isDirectory()) throw new Error(`不是文件夹: ${abs}`);
  const output = runGitMutation(abs, ["init"]);
  return { output, repository: getRepositoryStatus(abs) };
};

export {
  gitBranches,
  gitLog,
  gitShow,
  gitCheckout,
  gitCommit,
  gitDiff,
  gitFilePair,
  gitDiscard,
  gitInit,
  gitRemoteAction,
  gitStage,
  gitUnstage,
  repositoryStatusForPath,
  listGitRepositories,
};
