// @ts-nocheck
// 两次运行之间的上下文压缩(item 版)。
// 水位:最近一次用量 ≥ settings.compressThreshold(token)。
// 做法:保留近期尾部(按字符水位),把更早的行交给模型摘要;摘要失败用机械索引兜底 ——
// 压缩永远不能因为模型失败而不发生,不然下一轮直接撞上下文墙。
// 摘要作为一条 user 消息落进邮箱(meta.kind='compaction'),并记一条 compactions 锚点;
// 此后每次运行的历史都从锚点之后取,摘要行自然在其中。
import { complete } from "../../ai/index.js";
import { createCompaction, getLatestCompaction } from "../repo/compactions.js";
import { appendItem, latestUsage, listRows } from "../repo/messages.js";
import { EVENTS } from "../shared/events.js";

const TAIL_KEEP_CHARS = 40_000;
const SUMMARY_MIN_CHARS = 80;
/** 交给摘要的材料至少要有这么多字符 —— 只切出零头时压了也白压,还会生成
    「历史里什么都没发生」的误导性摘要(它会作为事实进入后续上下文)。 */
const MATERIAL_MIN_CHARS = 1_500;

const DEFAULT_COMPACT_PROMPT =
  "你负责压缩一段 agent 对话上下文,供后续模型继续工作时使用。" +
  "保留目标、限制、关键事实、工具结果、已做决定和未完成事项。删除寒暄和重复内容。输出中文摘要,避免编造。";

const totalTokensOf = (usage) => {
  if (!usage) return 0;
  return Number(usage.total_tokens) || (Number(usage.input_tokens) || 0) + (Number(usage.output_tokens) || 0);
};

const chars = (row) => { try { return JSON.stringify(row.item).length; } catch { return 0; } };

const itemText = (item) => {
  if (item?.type === "function_call") return `${item.name}: ${String(item.arguments || "").slice(0, 2000)}`;
  if (item?.type === "function_call_output") return String(item.output || "").slice(0, 4000);
  const content = item?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
  return "";
};

/**
 * 压缩/保留的分界。不把 function_call 和它的输出拆开。
 * 尾部保留量自适应:min(TAIL_KEEP_CHARS, 总量的 40%) —— 水位既然已经越线,
 * 这次压缩就必须真的压掉大头;从前固定留 40k,历史刚超 40k 时切给摘要的只剩
 * 开头一两行,产出误导性摘要,而且水位不降,每一轮都再来一次。
 */
const splitAt = (rows) => {
  const total = rows.reduce((sum, row) => sum + chars(row), 0);
  const tailKeep = Math.min(TAIL_KEEP_CHARS, Math.floor(total * 0.4));
  let at = rows.length;
  let size = 0;
  while (at > 0 && (size < tailKeep || rows.length - at < 2)) {
    at -= 1;
    size += chars(rows[at]);
  }
  while (at > 0 && rows[at]?.item?.type === "function_call_output") at -= 1;
  while (at > 0 && rows[at - 1]?.item?.type === "function_call") at -= 1;
  return at;
};

const material = (rows) => rows
  .filter((row) => row.item?.type !== "reasoning")
  .map((row) => `#${row.id} ${row.item?.role || row.item?.type || "unknown"}\n${itemText(row.item)}`)
  .join("\n\n---\n\n");

const mechanical = (rows) => [
  "[早前对话的机械摘要]",
  ...rows
    .filter((row) => row.item?.type !== "reasoning")
    .map((row) => `#${row.id} ${row.item?.role || row.item?.type || "unknown"} ${itemText(row.item).replace(/\s+/g, " ").slice(0, 160)}`),
].join("\n");

export const maybeCompact = async ({ agentId, settings, signal, emit }) => {
  const threshold = Number(settings.compressThreshold || 0) || 0;
  if (!threshold) return null;
  if (totalTokensOf(latestUsage(agentId)) < threshold) return null;

  const latest = getLatestCompaction(agentId);
  const rows = listRows(agentId, { afterId: Number(latest?.end_message_id || 0) })
    .filter((row) => row.meta?.kind !== "compaction");
  const at = splitAt(rows);
  if (at < 2) return null;

  const candidates = rows.slice(0, at);
  const body = material(candidates);
  // 材料太薄(比如只有首条用户消息,reasoning 被滤掉后一片空白)就不压:
  // 折叠不了多少上下文,却会往历史里塞一份「什么都没发生」的假事实
  if (body.length < MATERIAL_MIN_CHARS) return null;
  const startMessageId = candidates[0].id;
  const endMessageId = candidates[candidates.length - 1].id;

  emit({ type: EVENTS.COMPACT_START, agentId });
  let summary = "";
  try {
    const result = await complete({
      responsesUrl: settings.apiUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      errorMaxChars: 4000,
      instructions: String(settings.compactPrompt || "").trim() || DEFAULT_COMPACT_PROMPT,
      input: [{ role: "user", content: `请压缩以下消息:\n\n${body}` }],
      signal,
    });
    if (String(result.text).trim().length >= SUMMARY_MIN_CHARS) summary = String(result.text).trim();
  } catch { /* 摘要失败走机械兜底 */ }
  if (!summary) summary = mechanical(candidates);

  const compactionId = createCompaction({ agentId, startMessageId, endMessageId, summary, tokens: 0 });
  const row = appendItem(
    agentId,
    { role: "user", content: `以下是历史上下文压缩摘要:\n\n${summary}` },
    { meta: { kind: "compaction", compactionId, startMessageId, endMessageId } },
  );
  emit({ type: EVENTS.INPUT, agentId, row });
  emit({ type: EVENTS.COMPACT_DONE, agentId });
  return { compactionId, startMessageId, endMessageId };
};
