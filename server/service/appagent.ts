// 应用的 agent 能力:派活给一个真正的智能体(有工作目录、六个工具、多轮运行)。
// 「产生活动,不产生聊天」:执行体是 hidden 智能体 —— 会话面板不显示,
// 但运行走完整 runs 层,calls 表里 caller_id = app:<id>,活动面板可见、可点开审查过程。
import * as agentsRepo from "../repo/agents.js";
import { appendItem, listRows } from "../repo/messages.js";
import { runAgent } from "../runs/index.js";
import { emit } from "../bus.js";
import { EVENTS } from "../shared/events.js";

const messageText = (item: any) => {
  if (typeof item?.content === "string") return item.content;
  if (Array.isArray(item?.content)) return item.content.map((p: any) => p?.text || "").join("");
  return "";
};

export const runAppAgent = async ({
  appId,
  summary,
  message,
  workdir,
}: {
  appId: string;
  summary: string;
  message: string;
  workdir?: string;
}) => {
  if (!String(summary || "").trim()) throw new Error("summary 必填:一句话说明这次派活的目的,活动里会显示");
  if (!String(message || "").trim()) throw new Error("message 不能为空");

  // 每次派活一个全新 hidden 智能体:隔离干净;记录保留,活动里点开可查全过程
  const node = (agentsRepo as any).createAgent({
    title: String(summary).slice(0, 24),
    workdir: workdir ? String(workdir) : undefined,
    hidden: true,
  });
  const row = appendItem(node.id, { role: "user", content: String(message) }, {
    meta: { kind: "call", source: "app", from: `app:${appId}` },
  });
  emit({ type: EVENTS.INPUT, agentId: node.id, row });

  await (runAgent as any)(node.id, { callerId: `app:${appId}` });

  // 最终回复 = 邮箱里最后一条 assistant message
  const rows = listRows(node.id);
  const last = [...rows].reverse().find((r: any) => r.item?.type === "message" || r.item?.role === "assistant");
  return { agentId: node.id, text: messageText(last?.item) };
};
