// @ts-nocheck
// 工具装配:定义表(发给模型)与执行映射(注入内核)在这里合拢。
// 内核(ai/)只认 tools 数组 + executors Map,不知道 Workbench 是什么;
// Workbench 的外部能力(文件、进程、浏览器、多智能体)全部通过 ctx 闭包进执行器。
//
// 六个工具,一个不多:
//   bash(background?)  — 命令与后台进程(读日志用 read 日志文件,停止用 kill)
//   read / edit / write — 文件三件套
//   browser            — 操作网页标签(Electron <webview>,真登录态,分屏可见)
//   agent              — 多智能体(发消息 / 派生)
import { bash, bashDef } from "./bash.js";
import { edit, editDef, read, readDef, write, writeDef } from "./files.js";
import { browser, browserDef } from "./browser.js";
import { agent, agentDef } from "./agent.js";

export const tools = [
  bashDef,
  readDef,
  editDef,
  writeDef,
  browserDef,
  agentDef,
];

const IMPLS = {
  bash,
  read,
  edit,
  write,
  browser,
  agent,
};

/** 给模型的结果统一截断:留头留尾,中间标注截掉多少。 */
export const truncateToolResult = (text, maxChars = 12000) => {
  const limit = Math.max(1000, Math.min(50000, Number(maxChars) || 12000));
  const value = String(text || "");
  if (value.length <= limit) return value;
  const head = value.slice(0, Math.floor(limit * 0.7));
  const tail = value.slice(-Math.floor(limit * 0.3));
  return `${head}\n... [truncated ${value.length - head.length - tail.length} chars] ...\n${tail}`;
};

/**
 * 按本次运行的 ctx 生成执行映射。
 * 内核每次调用只带 {signal, cwd, env};Workbench 的能力在这里合并进去,
 * 结果在这里统一截断 —— 截断只写一处,工具实现不用各自操心。
 */
export const buildExecutors = (ctx) => {
  const executors = new Map();
  for (const [name, impl] of Object.entries(IMPLS)) {
    executors.set(name, async (args, kernelCtx = {}) => {
      const result = await impl(args, { ...ctx, signal: kernelCtx.signal });
      // 带图的结果(read 读图片)整体放行:文本部分照常截断,image 交给内核
      // (runner 会把它挂到 function_call_output 上,附件层在当前轮展开成 input_image)
      if (result && typeof result === "object" && result.image) {
        return { output: truncateToolResult(String(result.output || ""), ctx.toolResultMaxChars), image: result.image };
      }
      return truncateToolResult(result, ctx.toolResultMaxChars);
    });
  }
  return executors;
};
