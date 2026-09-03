// 规则 + 提醒卡。
//
// 规则只有一个出口:写进提示词。没有硬闸、没有编译。
// 提醒卡是助手自己觉得该问一句时停下来等你表态;出口两个:不允许 / 允许(这一次)。
import { useEffect, useState } from "react";

export type ApprovalCard = {
  id: string;
  chatId: string;
  summary: string;
  detail: string;
  risk: string;
  at: string;
};

export type Rule = {
  id: string;
  text: string;
  enabled: boolean;
  position: number;
};

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
  createRule: (text: string) =>
    req("/api/rules", { method: "POST", body: JSON.stringify({ text }) }) as Promise<{ rule: Rule }>,
  updateRule: (id: string, patch: { text?: string; enabled?: boolean }) =>
    req(`/api/rules?id=${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }) as Promise<{ rule: Rule }>,
  deleteRule: (id: string) => req(`/api/rules?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  /** 整份顺序发过去 —— 拖完就是一次落库,不做增量位移。 */
  reorderRules: (ids: string[]) =>
    req("/api/rules/order", { method: "POST", body: JSON.stringify({ ids }) }).then((r) => (r.rules || []) as Rule[]),
  listApprovals: (chatId: string) =>
    req(`/api/approvals?chatId=${encodeURIComponent(chatId)}`).then((r) => (r.approvals || []) as ApprovalCard[]),
  respond: (id: string, answer: "allow" | "deny") =>
    req("/api/approvals", { method: "POST", body: JSON.stringify({ id, answer }) }),
};

export const useRules = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const reload = () => { void permissionApi.listRules().then(setRules).catch(() => {}); };
  useEffect(() => { reload(); }, []);
  return { rules, reload };
};
