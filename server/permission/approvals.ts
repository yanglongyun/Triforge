// 待确认的工具调用。一次调用停在这儿,直到用户表态、超时,或整轮被停。
//
// 三条出口都必须有人兜底 —— 悬着的 Promise 会把整轮 agent 永远挂住,
// 而挂住的那一轮既不入库也不报错,是最难查的一类故障。
import { randomUUID } from "node:crypto";
import { emit } from "../bus.js";
import { ACTION_LABELS, type ToolRequest } from "./danger.js";
import type { Verdict } from "./rules.js";

const TIMEOUT_MS = 300_000;

export type ApprovalCard = {
  id: string;
  chatId: string;
  /** rule = 你定的闸到了;consult = 助手自己觉得该问一句(是判断,不是保证)。 */
  source: "rule" | "consult";
  /** consult 专属:助手说的风险在哪。 */
  risk?: string;
  tool: string;
  summary: string;
  command: string;
  paths: string[];
  actions: string[];
  /** 动作的中文名,界面直接用(免得前端再维护一份词表)。 */
  actionLabels: string[];
  reason: string;
  rule: { id: string; text: string } | null;
  at: string;
};

export type Answer = "allow" | "deny" | "timeout";

type Entry = {
  resolve: (answer: Answer) => void;
  timer: NodeJS.Timeout;
  card: ApprovalCard;
  cleanup: () => void;
};

const pending = new Map<string, Entry>();

const settle = (id: string, answer: Answer) => {
  const entry = pending.get(id);
  if (!entry) return false;
  pending.delete(id);
  clearTimeout(entry.timer);
  entry.cleanup();
  emit({ type: "approval_done", id, chatId: entry.card.chatId, answer });
  entry.resolve(answer);
  return true;
};

/** 刷新页面要能把还悬着的卡捞回来,否则用户永远等不到那张卡。 */
export const listApprovals = (chatId: string) =>
  [...pending.values()].filter((e) => e.card.chatId === chatId).map((e) => e.card);

export const respondApproval = (id: string, answer: string) =>
  settle(String(id), answer === "allow" ? "allow" : "deny");

/** 助手主动请示:走同一条问询通道,只是卡长得不一样。 */
export const requestConsult = (
  { chatId, summary, detail, risk, signal }:
  { chatId: string; summary: string; detail: string; risk: string; signal?: AbortSignal },
): Promise<Answer> => {
  const id = randomUUID();
  const card: ApprovalCard = {
    id, chatId, source: "consult",
    tool: "consult",
    summary,
    command: detail,
    paths: [], actions: [], actionLabels: [],
    risk,
    reason: "",
    rule: null,
    at: new Date().toISOString(),
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(id, "timeout"), TIMEOUT_MS);
    const onAbort = () => settle(id, "deny");
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(id, { resolve, timer, card, cleanup: () => signal?.removeEventListener("abort", onAbort) });
    emit({ type: "approval_ask", ...card });
  });
};

export const requestApproval = (
  { chatId, request, verdict, signal }:
  { chatId: string; request: ToolRequest; verdict: Verdict; signal?: AbortSignal },
): Promise<Answer> => {
  const id = randomUUID();
  const card: ApprovalCard = {
    id, chatId, source: "rule",
    tool: request.tool,
    summary: request.summary,
    command: request.command,
    paths: request.paths,
    actions: request.actions,
    actionLabels: request.actions.map((a) => ACTION_LABELS[a] || a),
    reason: verdict.reason,
    rule: verdict.rule ? { id: verdict.rule.id, text: verdict.rule.text } : null,
    at: new Date().toISOString(),
  };
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(id, "timeout"), TIMEOUT_MS);
    const onAbort = () => settle(id, "deny");
    signal?.addEventListener("abort", onAbort, { once: true });
    pending.set(id, {
      resolve, timer, card,
      cleanup: () => signal?.removeEventListener("abort", onAbort),
    });
    emit({ type: "approval_ask", ...card });
  });
};
