// @ts-nocheck
// 运行编排:一个对话同一时刻只有一轮在跑。
//   - 压缩水位判断 → 组装历史与 system → 调 ai/ 内核 → **逐条落库** → 事件广播
//   - 运行状态只在内存里(running Map)+ 事件广播;跑到一半重启本就恢复不了
//   - 停止/出错收尾:悬空 function_call 补输出(Responses 要求成对,缺了下一轮请求被拒),
//     落 [stopped]/[error] 留痕 —— 给用户看,也给模型看
//
// ai/ 内核完全不知道树/邮箱/进程/调用,所有状态在这里管。
import { complete, runAgent as runAi } from "../ai/index.js";
import { EVENTS } from "../shared/events.js";
import { buildExecutors, tools } from "../tools/index.js";
import type { Mode } from "../permission/rules.js";
import { buildSystem } from "./system.js";
import { maybeCompact } from "./compact.js";
import { DEFAULT_TITLE, createChat, getChat, resolveWorkdir, touchChat, updateChat } from "../repo/chats.js";
import { appendItem, listRows } from "../repo/messages.js";
import { getLatestCompaction } from "../repo/compactions.js";
import { getSettings } from "../repo/settings.js";
import { prepareInput } from "../host/files.js";
import { emit } from "../bus.js";

const MAX_ROUNDS = 64;
const ERROR_MAX_CHARS = 4000;

// ── 对话级运行注册:stop 对任意 chatId 都生效 ──
const running = new Map();
const isChatRunning = (chatId) => running.has(String(chatId));
const runningIds = () => [...running.keys()];
const stopChat = (chatId) => { running.get(String(chatId))?.abort(); };

const parseArgs = (value) => {
  try { return JSON.parse(String(value || "{}")); } catch { return {}; }
};

const messageText = (item) => {
  if (typeof item?.content === "string") return item.content;
  if (Array.isArray(item?.content)) return item.content.map((part) => part?.text || "").join("");
  return "";
};

/**
 * 首条消息跑完后给对话取名 —— 独立的一次补全调用,和对话运行完全分离,
 * 失败退回机械截断(用户消息前 24 字),保证一定脱离「未命名对话」。
 */
const autoTitle = async (chatId, rows, finalText, settings) => {
  const lastUser = [...rows].reverse().find((r) => r.item?.role === "user" && r.meta?.kind === "message")
    || [...rows].reverse().find((r) => r.item?.role === "user");
  const ask = String(lastUser?.item?.content || "").replace(/\s+/g, " ").trim();
  let title = "";
  try {
    const result = await complete({
      driver: settings.driver,
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      errorMaxChars: ERROR_MAX_CHARS,
      instructions: "为这段对话起一个简短标题(中文不超过 16 字,英文不超过 6 个词),用对话本身的语言,概括用户想做的事。只输出标题本身,不要引号和句号。",
      input: [{ role: "user", content: `用户:${ask.slice(0, 1200)}\n\n助手:${String(finalText || "").slice(0, 1200)}` }],
    });
    title = String(result.text).replace(/\s+/g, " ").trim().slice(0, 32);
  } catch { /* 模型起不出来就机械截断 */ }
  if (!title) title = ask.slice(0, 24);
  if (!title) title = String(lastUser?.item?.attachments?.[0]?.name || "").slice(0, 24); // 只发了附件没打字
  if (!title) return;
  updateChat(chatId, { title });
  emit({ type: "chats_changed" });
};

/** 停止/出错后,给没等到结果的 function_call 补一条输出,落库并广播。 */
const settleDanglingCalls = (chatId, items, reason) => {
  const pending = new Map();
  for (const item of items) {
    if (item?.type === "function_call") pending.set(item.call_id, item);
    else if (item?.type === "function_call_output") pending.delete(item.call_id);
  }
  for (const call of pending.values()) {
    const output = { type: "function_call_output", call_id: call.call_id, output: `error: ${reason}` };
    appendItem(chatId, output);
    emit({ type: EVENTS.CALL_OUTPUT, chatId, callId: call.call_id, result: output.output });
  }
};

const runChat = async (chatId) => {
  const chat = getChat(chatId);
  if (!chat) throw new Error(`chat not found: ${chatId}`);
  if (running.has(String(chatId))) throw new Error("already running");
  const wasUntitled = chat.title === DEFAULT_TITLE;

  const settings = getSettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    throw new Error("还没配置模型(设置 → 接口协议 / API URL / API Key / 模型)");
  }

  const controller = new AbortController();
  running.set(String(chatId), controller);
  const signal = controller.signal;

  emit({ type: EVENTS.START, chatId });

  const generated = [];

  try {
    await maybeCompact({ chatId, settings, signal, emit });

    const latest = getLatestCompaction(chatId);
    const rows = listRows(chatId, { afterId: Number(latest?.end_message_id || 0) });
    const input = rows.map((row) => row.item);
    const cwd = resolveWorkdir(chat);

    const ctx = {
      selfChatId: chatId,
      chatId,        // confirm 要用它把提醒卡投到这段对话里
      signal,        // 整轮被停时,悬着的提醒卡跟着收掉
      cwd,
      emit,
      toolResultMaxChars: Number(settings.toolResultMaxChars) || 30000,
    };

    const emitKernel = (type, data) => {
      if (type === "message" && data.delta) {
        emit({ type: EVENTS.DELTA, chatId, content: data.delta });
        return;
      }
      if (type === "reasoning" && data.delta) {
        emit({ type: EVENTS.REASONING, chatId, content: data.delta });
        return;
      }
      if (type === "function_call" && data.phase === "started") {
        emit({ type: EVENTS.CALL_STARTED, chatId });
        return;
      }
      if (type === "retry") {
        // 网络抖动/限流,内核在退避重试 —— 透给界面,别让用户以为卡死了
        emit({ type: EVENTS.RETRY, chatId, attempt: data.attempt, maxRetries: data.maxRetries, delayMs: data.delayMs, message: String(data.error || "") });
        return;
      }
      if (!data.item) return; // 内核自己的 done/error 事件,终局由本层广播
      generated.push(data.item);
      appendItem(chatId, data.item, { usage: data.usage || null });
      if (type === "function_call") {
        emit({
          type: EVENTS.CALLS,
          chatId,
          calls: [{ callId: data.item.call_id, name: data.item.name, args: parseArgs(data.item.arguments) }],
        });
      } else if (type === "function_call_output") {
        emit({ type: EVENTS.CALL_OUTPUT, chatId, callId: data.item.call_id, result: data.item.output || "" });
      }
    };

    // 规则开关:开着 confirm 工具在;关着连它也不在(描述一个调不到的工具,模型只会去调然后撞空)
    const rulesOn = (settings.rulesEnabled || "on") !== "off";

    const result = await runAi({
      runId: crypto.randomUUID(),
      driver: settings.driver, // 'responses' | 'chat',协议差异全在 ai/drivers/ 内消化
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      instructions: buildSystem(chat, settings),
      input,
      tools: rulesOn ? tools : tools.filter((t) => t.name !== "confirm"),
      executors: buildExecutors(ctx),
      maxRounds: MAX_ROUNDS,
      errorMaxChars: ERROR_MAX_CHARS,
      workdir: cwd,
      env: process.env,
      signal,
      emit: emitKernel,
      prepareInput, // 附件展开/剥除:当前轮的图片才进 input_image,旧轮不带字节
    });

    const finalText = result.items
      .filter((item) => item?.type === "message")
      .map(messageText)
      .join("\n\n")
      .trim();

    // 截断/内容过滤(response.incomplete):落 [incomplete] 留痕 —— 给用户看,也给模型看
    if (result.stopReason) {
      const marker = { role: "system", content: `[incomplete] 上一条回复未完整结束:${result.stopReason}` };
      const row = appendItem(chatId, marker, { meta: { kind: "marker" } });
      emit({ type: EVENTS.INPUT, chatId, row });
    }
    emit({ type: EVENTS.DONE, chatId, usage: result.usage || null });
    if (wasUntitled) void autoTitle(chatId, rows, finalText, settings); // 取名独立走,不挡终局
    return finalText;
  } catch (error) {
    const aborted = signal.aborted || error?.name === "AbortError";
    const message = String(error?.message || error).slice(0, ERROR_MAX_CHARS);
    settleDanglingCalls(chatId, generated, aborted ? "任务被用户停止,该调用未完成" : "运行出错,该调用未完成");

    const marker = aborted
      ? { role: "system", content: "[stopped] 上一条回复被用户停止,输出到此为止。" }
      : { role: "system", content: `[error] 上一轮运行失败:${message}` };
    const row = appendItem(chatId, marker, { meta: { kind: "marker" } });
    emit({ type: EVENTS.INPUT, chatId, row });
    if (aborted) emit({ type: EVENTS.ABORTED, chatId });
    else emit({ type: EVENTS.ERROR, chatId, message });
    throw error;
  } finally {
    running.delete(String(chatId));
  }
};

export { runChat, stopChat, isChatRunning, runningIds };
