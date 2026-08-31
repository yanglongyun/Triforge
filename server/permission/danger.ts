// 危险动作词汇表 —— 规则能编译成什么,上限就是这张表。
//
// 收成闭集是刻意的:一句大白话能不能落地成拦截,**当场可判**,
// 不用等运行时才发现规则写了个空。表外的意图只能进提示词,靠模型自觉。
//
// 这道判定挂在**工具调用**上。模型自己写的脚本内部干了什么,它看不见 ——
// 界面和文档都不许暗示相反的事。
export const ACTIONS = [
  "delete",    // 删除文件 / 目录
  "overwrite", // 覆盖写入、截断
  "move",      // 移动、改名
  "network",   // 对外请求、上传下载
  "install",   // 装包
  "sudo",      // 提权
  "gitPush",   // 推代码到远端
  "daemon",    // 起后台常驻进程
  "format",    // 格式化、抹盘
] as const;

export type Action = (typeof ACTIONS)[number];

/** 我们的五工具里,只有这四个会动到外部世界(browser 归网页标签,用户全程看得见)。 */
export const TOOLS = ["bash", "read", "write", "edit"] as const;

export const ACTION_LABELS: Record<string, string> = {
  delete: "删除文件", overwrite: "覆盖写入", move: "移动改名",
  network: "联网请求", install: "安装软件包", sudo: "提权执行",
  gitPush: "推送代码", daemon: "起后台进程", format: "格式化磁盘",
};

// 命令里的动作特征。故意宽松 —— 宁可多问一次,不可漏一次。
const PATTERNS: [Action, RegExp][] = [
  ["delete", /(^|[\s;&|(])(rm|rmdir|unlink|shred|trash)(\s|$)/],
  ["delete", /-delete(\s|$)/],
  ["overwrite", /(^|[\s;&|(])(truncate|tee)(\s|$)/],
  ["overwrite", /[^>]>(?!>)\s*[^\s>|&]/],
  ["move", /(^|[\s;&|(])mv(\s|$)/],
  ["network", /(^|[\s;&|(])(curl|wget|nc|ncat|ssh|scp|sftp|ftp)(\s|$)/],
  ["network", /(^|[\s;&|(])git\s+(clone|fetch|pull)(\s|$)/],
  ["install", /(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(i|install|add)(\s|$)/],
  ["install", /(^|[\s;&|(])(pip3?\s+install|brew\s+install|apt(-get)?\s+install|gem\s+install|cargo\s+install)(\s|$)/],
  ["sudo", /(^|[\s;&|(])(sudo|doas|su)(\s|$)/],
  ["gitPush", /(^|[\s;&|(])git\s+push(\s|$)/],
  ["daemon", /(^|[\s;&|(])(nohup|launchctl|systemctl|pm2|screen|tmux)(\s|$)/],
  ["daemon", /&\s*$/],
  ["format", /(^|[\s;&|(])(mkfs|fdisk|diskutil\s+erase|dd\s+.*of=\/dev\/)/],
];

/** 审批卡上要展示的操作正文。bash 是命令,write 是内容,edit 是原文与新文。 */
export type Preview = { label: string; text: string };

export type ToolRequest = {
  tool: string;
  actions: Action[];
  paths: string[];
  command: string;
  summary: string;
  /** 这次调用**具体要干什么** —— 只报工具名和路径,用户没法判断该不该放行。 */
  preview: Preview[];
};

const PREVIEW_MAX = 1200;

/** 太长的正文截断,但要说清截了多少 —— 悄悄截断会让人以为看到的就是全部。 */
const clip = (value: unknown): string => {
  const text = String(value ?? "");
  return text.length <= PREVIEW_MAX
    ? text
    : `${text.slice(0, PREVIEW_MAX)}\n…(还有 ${text.length - PREVIEW_MAX} 个字符没显示)`;
};

/** 从一条 bash 命令里认出它要干的危险动作。 */
export const actionsOf = (command: unknown): Action[] => {
  const text = String(command || "");
  const found = new Set<Action>();
  for (const [action, pattern] of PATTERNS) if (pattern.test(text)) found.add(action);
  return [...found];
};

/**
 * 从命令里捞出像路径的片段。给规则的路径条件用。
 * 认不全是已知的 —— 认不出来只会让规则少命中(多问一次),不会让它漏过。
 */
export const pathsOf = (command: unknown): string[] => {
  const text = String(command || "");
  const found = new Set<string>();
  for (const raw of text.split(/[\s;|&()]+/)) {
    const token = raw.replace(/^["']|["']$/g, "");
    if (!token || token.startsWith("-")) continue;
    if (token.includes("://")) continue; // URL 不是路径,别让它误配路径条件
    if (token.startsWith("/") || token.startsWith("~") || token.startsWith("./")
      || token.startsWith("../") || token.includes("/")) found.add(token);
  }
  return [...found];
};

/** 把一次工具调用归一成可判定的形状:工具 + 动作 + 路径,外加给人看的操作正文。 */
export const describe = (name: string, args: any = {}): ToolRequest => {
  const tool = String(name || "");
  const summary = String(args?.summary || "");
  if (tool === "bash") {
    const command = String(args?.command || "");
    // 命令本身就是正文,界面已经把它标好色单独渲染,不必再进 preview
    return { tool, actions: actionsOf(command), paths: pathsOf(command), command, summary, preview: [] };
  }
  const path = String(args?.path || "");
  const actions: Action[] = tool === "write" || tool === "edit" ? ["overwrite"] : [];
  const preview: Preview[] = [];
  if (tool === "write") {
    preview.push({ label: "要写入的内容", text: clip(args?.content) });
  } else if (tool === "edit") {
    preview.push({ label: "原文", text: clip(args?.old) });
    preview.push({ label: "改成", text: clip(args?.new) });
    if (args?.replace_all) preview.push({ label: "范围", text: "替换文件里所有匹配处" });
  }
  return { tool, actions, paths: path ? [path] : [], command: "", summary, preview };
};
