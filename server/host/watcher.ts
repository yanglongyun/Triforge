// 文件系统监听:树的另一半事实来源。
//
// 自己的工具(bash/write/…)改文件会手动广播 tree_changed;但 Finder、终端、
// dev server、git、别的进程改磁盘时没人说话 —— 树就静默过期。VS Code 的资源管理器
// 之所以"总是新的",是向内核注册文件事件(macOS FSEvents / Win ReadDirectoryChangesW /
// Linux inotify)。Node 的 fs.watch({recursive}) 在 libuv 底下用的正是同一套内核 API,
// 零依赖 —— 树顶是整个主目录,就对它挂一个递归监听,事件节流后广播 tree_changed。
import fs from "fs";
import path from "path";
import { emit } from "../bus.js";
import { IGNORE_DIRS, ROOT, isRootNoise } from "../repo/tree.js";

// npm install / git checkout 是几千个事件的风暴:节流成每 400ms 至多一次广播。
// 树的刷新是幂等的整树重拉,合并多少事件都不丢信息。
const INTERVAL_MS = 400;
let lastFired = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const fire = () => {
  lastFired = Date.now();
  emit({ type: "tree_changed", reason: "fs" });
};

const schedule = () => {
  if (timer) return;
  const wait = Math.max(50, INTERVAL_MS - (Date.now() - lastFired));
  timer = setTimeout(() => { timer = null; fire(); }, wait);
};

/**
 * 忽略树本来就不显示的东西里的抖动,少刷无谓的一轮:
 * - 主目录顶层的配置目录 / Library(缓存、日志,一直在写);
 * - 任何一级里的 node_modules/.git/…。
 */
const ignorable = (filename: string | Buffer | null) => {
  if (!filename) return false; // 拿不到路径就宁可刷一次
  const parts = String(filename).split(path.sep).filter(Boolean);
  if (parts.length && isRootNoise(parts[0])) return true;
  return parts.some((part) => IGNORE_DIRS.has(part));
};

let watcher: fs.FSWatcher | null = null;

const startWatcher = () => {
  if (watcher) return;
  try {
    watcher = fs.watch(ROOT, { recursive: true }, (_event, filename) => {
      if (ignorable(filename)) return;
      schedule();
    });
    watcher.on("error", () => { watcher?.close(); watcher = null; });
  } catch {
    // 主目录都监听不了就算了,树退化成手动刷新
  }
};

export { startWatcher };
