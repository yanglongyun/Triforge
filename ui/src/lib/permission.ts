// 权限:审批卡 + 规则。
//
// 规则的语义只有一种:**命中就停下来问**。没有 allow 档 ——
// 「以后都允许」是一种失控:三个月前立的放行规则,今天会替你放过你并不想放的事。
// 所以出口永远是两个:不允许 / 允许(这一次)。
import { useEffect, useState } from "react";

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
  actionLabels: string[];
  /** 这次调用具体要干什么:write 的内容、edit 的原文与新文。 */
  preview: { label: string; text: string }[];
  reason: string;
  rule: { id: string; text: string } | null;
  at: string;
};

export type Rule = {
  id: string;
  text: string;
  prompt: string;
  match: { tools: string[]; actions: string[]; paths: string[] };
  enabled: boolean;
  origin: "user" | "factory" | "agent";
  /**
   * 有没有硬闸。**false 是常态,不是失败** —— 规则的本职是写进提示词约束模型,
   * 硬闸是附加的。true 时 match 描述闸的作用范围(空维度 = 不设限)。
   */
  gate: boolean;
};

// 护盾模型:盾是开关(rules = 盾开,skip = 盾关),规则是内容。没有第三档。
export type Mode = "rules" | "skip";

const req = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `请求失败(${res.status})`);
  return body;
};

export const permissionApi = {
  listRules: () => req("/api/rules").then((r) => (r.rules || []) as Rule[]),
  /** 建规则会先把大白话编译成触发条件;note 非空说明降级了。 */
  createRule: (text: string) =>
    req("/api/rules", { method: "POST", body: JSON.stringify({ text }) }) as Promise<{ rule: Rule; note: string }>,
  updateRule: (id: string, patch: Partial<Rule>) =>
    req(`/api/rules?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }) as Promise<{ rule: Rule; note: string }>,
  deleteRule: (id: string) => req(`/api/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** 整份顺序发过去 —— 拖完就是一次落库,不做增量位移。 */
  reorderRules: (ids: string[]) =>
    req("/api/rules/order", { method: "POST", body: JSON.stringify({ ids }) }).then((r) => (r.rules || []) as Rule[]),
  listApprovals: (chatId: string) =>
    req(`/api/approvals?chatId=${encodeURIComponent(chatId)}`).then((r) => (r.approvals || []) as ApprovalCard[]),
  respond: (id: string, answer: "allow" | "deny") =>
    req("/api/approvals", { method: "POST", body: JSON.stringify({ id, answer }) }),
};

/** 一条命令里危险的那几个词 —— 界面把它们标出来,别让人在一行里自己找。 */
const DANGER_WORDS = /\b(rm|rmdir|unlink|shred|trash|mv|truncate|tee|curl|wget|scp|ssh|sudo|doas|su|npm|pnpm|yarn|pip3?|brew|apt|apt-get|gem|cargo|nohup|launchctl|systemctl|pm2|mkfs|fdisk|diskutil|dd)\b|-rf?\b|--force\b|>\s|git\s+push/g;

/** 把命令切成 [普通, 危险, 普通…] 的片段,给界面上色。 */
export const highlightCommand = (command: string): { text: string; danger: boolean }[] => {
  const parts: { text: string; danger: boolean }[] = [];
  let last = 0;
  for (const m of command.matchAll(DANGER_WORDS)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: command.slice(last, start), danger: false });
    parts.push({ text: m[0], danger: true });
    last = start + m[0].length;
  }
  if (last < command.length) parts.push({ text: command.slice(last), danger: false });
  return parts.length ? parts : [{ text: command, danger: false }];
};

/** 规则列表 + 当前模式,多处共用(输入框的控制点、审批卡里的说明)。 */
export const useRules = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const reload = () => { void permissionApi.listRules().then(setRules).catch(() => {}); };
  useEffect(() => { reload(); }, []);
  return { rules, reload };
};
