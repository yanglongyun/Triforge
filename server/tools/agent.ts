// @ts-nocheck
// agent:多智能体的唯一工具。
//   - 带 agent_id:给已存在的智能体发消息(旧 call_agent);
//   - 不带 agent_id、带 title:在自己所在文件夹里派生一个新智能体并派活(旧 create_agent)。
// 都是异步 —— 立即返回,对方跑完后最终回复作为新消息投回自己的邮箱(runs 层负责回投与唤醒)。
import { EVENTS } from "../shared/events.js";

export const agentDef = {
  type: "function",
  name: "agent",
  description:
    "多智能体协作:给别的智能体发消息,或派生一个新智能体。带 agent_id 时把 message 发给该智能体;" +
    "不带 agent_id 时必须带 title —— 在你所在的文件夹下创建一个新智能体并把 message 作为它的第一个任务。" +
    "两种都是异步、立即返回;对方跑完后,它的最终回复会自动作为新消息投进你的邮箱([CALL_RESULT] 前缀),届时你会被唤醒。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明这次协作的目的(界面会显示)" },
      message: { type: "string", description: "要发给对方的消息/任务(对方只能看到这里写的内容)" },
      agent_id: { type: "string", description: "可选:目标智能体 id(发给已存在的智能体)" },
      title: { type: "string", description: "可选:新智能体的名字(不带 agent_id 时必填)" },
      system: { type: "string", description: "可选:新智能体的 system prompt" },
    },
    required: ["summary", "message"],
    additionalProperties: false,
  },
};

const dispatch = (ctx, targetId, message) => {
  const row = ctx.appendItem(
    targetId,
    { role: "user", content: String(message || "") },
    { meta: { kind: "call", source: "call", from: ctx.selfAgentId } },
  );
  ctx.touchAgent(targetId);
  ctx.emit({ type: EVENTS.INPUT, agentId: targetId, row });
  ctx.runAgent(targetId, { callerId: ctx.selfAgentId }).catch((e) =>
    console.error("[agent] wake failed:", e?.message),
  );
};

export const agent = ({ agent_id, title, system, message }, ctx) => {
  const msg = String(message || "").trim();
  if (!msg) return "error: message 不能为空";

  // ── 发给已存在的智能体 ──
  if (agent_id != null && String(agent_id).trim()) {
    const targetId = String(agent_id).trim();
    const target = ctx.getAgent(targetId);
    if (!target) return `error: agent not found: ${targetId}`;
    if (targetId === String(ctx.selfAgentId)) return "error: 不能给自己发消息";
    dispatch(ctx, targetId, msg);
    return `dispatched to "${target.title}" (id=${targetId}). reply will arrive in your mailbox as a new message.`;
  }

  // ── 派生新智能体 ──
  if (!String(title || "").trim()) return "error: 创建新智能体需要 title(或提供 agent_id 发给已存在的智能体)";
  const created = ctx.createAgent({
    title: String(title).trim(),
    system: system ? String(system) : null,
    workdir: ctx.cwd, // 新智能体和自己同一个家 ——「在你所在文件夹里派生」的语义不变
  });
  ctx.emit({ type: "agents_changed" });
  dispatch(ctx, created.id, msg);
  return `created agent "${created.title}" (id=${created.id}). initial message dispatched; reply will arrive in your mailbox.`;
};
