// 权限的路由面:规则 CRUD(建规则要先编译)+ 审批表态 + 捞回悬着的卡。
import type { IncomingMessage, ServerResponse } from "node:http";
import { listApprovals, respondApproval } from "../permission/approvals.js";
import { compileRule } from "../permission/compile.js";
import { createRule, deleteRule, listRules, reorderRules, updateRule } from "../repo/rules.js";

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readBody = async (req: IncomingMessage): Promise<any> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
};

/** 对外形状:gate 已经是规则自己的字段,界面据它说明这条规则怎么起作用。 */
const publicRule = (rule: any) => rule;

export const handlePermissionRoutes = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> => {
  const p = url.pathname;

  if (p === "/api/rules" && method === "GET") {
    json(res, 200, { rules: listRules().map(publicRule) });
    return true;
  }

  // 建规则:先把大白话编译成触发条件(编译不出来也照样建 —— 只剩提示词一个出口)
  if (p === "/api/rules" && method === "POST") {
    const body = await readBody(req);
    const compiled = await compileRule(body.text);
    if (!compiled.text) { json(res, 400, { error: compiled.note || "内容为空" }); return true; }
    const rule = createRule({ text: compiled.text, prompt: compiled.prompt, match: compiled.match, gate: compiled.gate });
    json(res, 201, { rule: publicRule(rule), note: compiled.note });
    return true;
  }

  if (p === "/api/rules" && method === "PATCH") {
    const body = await readBody(req);
    const id = url.searchParams.get("id") || body.id;
    const patch: any = { ...body };
    let note = "";
    if (typeof body.text === "string" && body.text.trim()) {
      const compiled = await compileRule(body.text);
      patch.text = compiled.text;
      patch.prompt = compiled.prompt;
      patch.match = compiled.match;
      patch.gate = compiled.gate;
      note = compiled.note;
    }
    const rule = updateRule(String(id), patch);
    if (!rule) { json(res, 404, { error: "没有这条规则" }); return true; }
    json(res, 200, { rule: publicRule(rule), note });
    return true;
  }

  // 重排:整份顺序一次发过来,服务端照单重写 position
  if (p === "/api/rules/order" && method === "POST") {
    const body = await readBody(req);
    json(res, 200, { rules: reorderRules(body.ids).map(publicRule) });
    return true;
  }

  if (p === "/api/rules" && method === "DELETE") {
    json(res, 200, { deleted: deleteRule(String(url.searchParams.get("id") || "")) });
    return true;
  }

  // 刷新页面后把还悬着的卡捞回来,否则用户永远等不到那张卡
  if (p === "/api/approvals" && method === "GET") {
    json(res, 200, { approvals: listApprovals(String(url.searchParams.get("chatId") || "")) });
    return true;
  }

  if (p === "/api/approvals" && method === "POST") {
    const body = await readBody(req);
    json(res, 200, { ok: respondApproval(String(body.id), String(body.answer)) });
    return true;
  }

  return false;
};
