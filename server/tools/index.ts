// 工具装配:定义表(发给模型)与执行映射(注入内核)在这里合拢。
// 内核(ai/)只认 tools 数组 + executors Map,不知道 Worktop 是什么;
// Worktop 的外部能力(文件、进程、浏览器)全部通过 ctx 闭包进执行器。
//
// 六个工具:
//   bash(background?)  — 命令与后台进程(读日志用 read 日志文件,停止用 kill)
//   read / edit / write — 文件三件套
//   browser            — 操作网页标签(Electron <webview>,真登录态,分屏可见)
//   confirm            — 主动提醒(助手自己的判断;规则是用户定的闸,两者互补)
import { bash, bashDef } from "./bash.js";
import { edit, editDef, read, readDef, write, writeDef } from "./files.js";
import { browser, browserDef } from "./browser.js";
import { confirm, confirmDef } from "./confirm.js";

export const tools = [
  bashDef,
  readDef,
  editDef,
  writeDef,
  browserDef,
  confirmDef,
];

const IMPLS = {
  bash,
  read,
  edit,
  write,
  browser,
  confirm,
};

/**
 * 给模型的结果统一截断:留头留尾,中间挖掉。
 * 标记必须告知**原始规模**(codex 式),并直接教模型自救的路 ——
 * bash 输出是一次性的,截掉就没了;指引它重跑时重定向到文件再用 read 分段读。
 * (read 自己按行收口、永不进这里;详见 files.ts。)
 */
export const truncateToolResult = (text: unknown, maxChars = 30000) => {
  const limit = Math.max(1000, Math.min(50000, Number(maxChars) || 30000));
  const value = String(text || "");
  if (value.length <= limit) return value;
  const head = value.slice(0, Math.floor(limit * 0.7));
  const tail = value.slice(-Math.floor(limit * 0.3));
  const totalLines = value.split("\n").length;
  const cut = value.length - head.length - tail.length;
  return `${head}\n\n…[已截断:原始输出共 ${value.length} 字符 / ${totalLines} 行,中间省略 ${cut} 字符,开头与结尾已保留。` +
    `需要完整内容时:重跑命令并重定向到文件(如 cmd > /tmp/out.log 2>&1),再用 read 分段读取]…\n\n${tail}`;
};

/**
 * 按本次运行的 ctx 生成执行映射。
 * 内核每次调用只带 {signal, cwd, env};Worktop 的能力在这里合并进去,
 * 结果在这里统一截断 —— 截断只写一处,工具实现不用各自操心。
 */
/** 工具执行上下文:Worktop 的外部能力经此注入,各工具按需取用(刻意宽松)。 */
export type ToolCtx = Record<string, any> & { toolResultMaxChars?: number; signal?: AbortSignal };

export const buildExecutors = (ctx: ToolCtx) => {
  const executors = new Map();
  for (const [name, impl] of Object.entries(IMPLS)) {
    executors.set(name, async (args: unknown, kernelCtx: { signal?: AbortSignal } = {}) => {
      const result: any = await impl(args as any, { ...ctx, signal: kernelCtx.signal });
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
