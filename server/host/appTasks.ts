// @ts-nocheck
// 应用触发的 agent 轮次(POST /host/ai/agent)—— 任务机制。
//
// 与用户会话的三点不同:
//   1. 不进 chats/messages,落 tasks 表一行(过程不落库,先把机制跑起来);
//   2. **不过护盾**:任务没有人守在旁边,confirm 也不在工具表里 —— 直接按 skip 跑;
//   3. 结果以 SSE 流回给发起的应用:tool(进度)/ error / done。应用只认 error 和 done。
import { homedir } from "node:os";
import { runAgent as runAi } from "../ai/index.js";
import { buildExecutors, tools } from "../tools/index.js";
import { gate, gateTools } from "../permission/gate.js";
import { getSettings } from "../repo/settings.js";
import { createTask, settleTask } from "../repo/tasks.js";
import { ensureRoot } from "../repo/tree.js";
import { buildSystem } from "../runs/system.js";
import { emit } from "../bus.js";

const MAX_ROUNDS = 64;
const ERROR_MAX_CHARS = 4000;

const running = new Map(); // taskId → AbortController

export const runAppTask = async (
  { appId, appName, prompt, workdir },
  res, // ServerResponse:SSE 从这里流出去
) => {
  const settings = getSettings();
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "宿主还没配置模型:先在设置里填接口地址、密钥和模型" }));
    return;
  }

  const cwd = workdir || ensureRoot();
  const taskId = createTask({ appId, title: prompt.slice(0, 60), prompt });
  emit({ type: "tasks_changed" });

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* 对端已断 */ }
  };
  send("start", { taskId });

  const controller = new AbortController();
  running.set(taskId, controller);
  res.on("close", () => controller.abort()); // 应用断开(它自己有超时)= 停止任务

  const ctx = {
    selfChatId: `task:${taskId}`,
    chatId: `task:${taskId}`,
    cwd,
    emit,
    toolResultMaxChars: Number(settings.toolResultMaxChars) || 30000,
  };

  try {
    const result = await runAi({
      runId: taskId,
      driver: settings.driver,
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      instructions: buildSystem({ id: `task:${taskId}`, system: null, workdir: cwd }, settings)
        + `\n\n# 本轮是应用触发的任务\n\n发起方:应用「${appName}」(${appId})。没有用户守在旁边,不要提问、不要等确认;`
        + `按提示把事做完,做不了就直说失败原因。`,
      input: [{ role: "user", content: prompt.slice(0, 100_000) }],
      tools: gateTools(tools, "skip"),
      executors: gate(buildExecutors(ctx), {
        mode: "skip", // 任务不过护盾:先跑起来再说
        rules: [],
        context: { home: homedir(), cwd },
        chatId: ctx.chatId,
        signal: controller.signal,
      }),
      maxRounds: MAX_ROUNDS,
      errorMaxChars: ERROR_MAX_CHARS,
      workdir: cwd,
      env: process.env,
      signal: controller.signal,
      emit: (type, data) => {
        if (type === "function_call" && data.phase === "started") send("tool", { phase: "started" });
        else if (type === "function_call" && data.item) send("tool", { name: data.item.name });
      },
    });

    const finalText = result.items
      .filter((item) => item?.type === "message")
      .map((item) => (typeof item.content === "string" ? item.content
        : Array.isArray(item.content) ? item.content.map((p) => p?.text || "").join("") : ""))
      .join("\n\n").trim();

    settleTask(taskId, "done", { response: finalText });
    send("done", { taskId, text: finalText });
  } catch (error) {
    const aborted = controller.signal.aborted || error?.name === "AbortError";
    const message = String(error?.message || error).slice(0, ERROR_MAX_CHARS);
    settleTask(taskId, aborted ? "aborted" : "error", { error: message });
    if (!aborted) send("error", { taskId, message });
    send("done", { taskId }); // 契约:done 是终局信号,error 之后也要发
  } finally {
    running.delete(taskId);
    emit({ type: "tasks_changed" });
    try { res.end(); } catch { /* 已断 */ }
  }
};

export const stopAppTask = (taskId) => { running.get(String(taskId))?.abort(); };
