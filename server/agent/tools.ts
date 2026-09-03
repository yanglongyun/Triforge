// 工具装配:定义表(发给模型)与执行(注入循环)在这里合拢。
// 循环(agent/)只认 tools 数组 + run(call),不知道 Worktop 是什么;
// Worktop 的外部能力(文件、进程、浏览器)全部通过 ctx 闭包进执行器。
//
// 六个工具:
//   bash(background?)  — 命令与后台进程(读日志用 read 日志文件,停止用 kill)
//   read / edit / write — 文件三件套
//   browser            — 操作网页标签(Electron <webview>,真登录态,分屏可见)
//   confirm            — 主动提醒(助手自己的判断;规则是用户定的闸,两者互补)
import { bash, bashDef } from "./functions/bash.js";
import { edit, editDef, read, readDef, write, writeDef } from "./functions/files.js";
import { browser, browserDef } from "./functions/browser.js";
import { confirm, confirmDef } from "./functions/confirm.js";

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

/** 工具执行上下文:Worktop 的外部能力经此注入,各工具按需取用(刻意宽松)。 */
export type ToolCtx = Record<string, any> & { toolResultMaxChars?: number; signal?: AbortSignal; cwd?: string };

const parseArgs = (value: unknown) => {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  try { return JSON.parse(String(value || "{}")) as Record<string, unknown>; } catch { return {}; }
};

/**
 * 按本次运行的 ctx 生成 run(call):按名字找实现、执行、统一截断、包成 function_call_output。
 * 工具自己出错就把错误回喂给模型;取消不是工具错误,必须一路抛到循环外。
 * 截断只写一处,工具实现不用各自操心;带图的结果文本照常截断,image 挂在 item 上,附件层在当前轮展开。
 */
export const createRunner = (ctx: ToolCtx) => async (call: { name?: string; call_id?: string; arguments?: unknown }) => {
  const name = String(call?.name || "");
  const impl = (IMPLS as unknown as Record<string, (args: any, ctx: any) => unknown>)[name];
  let result: any;
  try {
    if (typeof impl !== "function") result = { error: `未知工具:${name}` };
    else {
      const raw: any = await impl(parseArgs(call?.arguments), ctx);
      if (raw && typeof raw === "object" && raw.image) {
        result = { output: truncateToolResult(String(raw.output || ""), ctx.toolResultMaxChars), image: raw.image };
      } else {
        result = truncateToolResult(typeof raw === "string" ? raw : JSON.stringify(raw), ctx.toolResultMaxChars);
      }
    }
  } catch (error: any) {
    if (error?.name === "AbortError" || ctx.signal?.aborted) throw error;
    result = { error: error?.message || String(error) };
  }
  const item: Record<string, unknown> = {
    type: "function_call_output",
    call_id: String(call?.call_id || ""),
    output: typeof result === "string" ? result : JSON.stringify(result),
  };
  if (result?.image?.path) item.image = result.image;
  return item;
};
