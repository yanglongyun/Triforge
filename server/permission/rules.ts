// 规则:用户写的一句话,加上系统为它派生的东西。
//
// **规则的本职是约束模型**:每一条都会写进提示词,这是主路,对所有规则都成立。
// 在此之上,如果这句话能落成明确的作用范围,系统再加一道硬闸(gate)——
// 命中就停下来等用户点头。**硬闸是附加的,没有硬闸不是失败。**
//
//   prompt  写进提示词 —— 永远有
//   gate    有没有硬闸 —— 显式的事实,不从 match 推断
//   match   硬闸的作用范围 —— 先看工具,再按动作和路径收窄;空维度 = 不设限
//
// 没有 deny/allow 的分档,也没有类别 —— 该不该做,用户在弹窗那一刻自己判断。
// 用户维护的始终是自己那句 text,不是编译产物。
import { ACTIONS, TOOLS, type ToolRequest } from "./danger.js";

// 护盾模型:盾是开关,规则是内容。skip = 盾关,rules = 盾开。
export const MODES = ["rules", "skip"] as const;
export type Mode = (typeof MODES)[number];

/** 硬闸的作用范围。维度之间是与,维度之内是或;**留空 = 该维度不设限**。 */
export type RuleMatch = { tools: string[]; actions: string[]; paths: string[] };
export type Rule = {
  id: string;
  text: string;
  prompt: string;
  match: RuleMatch;
  /**
   * 这条规则有没有硬闸。
   *
   * **必须显式存,不能从 match 三维是否为空推断** —— 三维全空既可能是
   * 「拦住任何一次工具调用」,也可能是「这句话落不成条件」,推断不出来。
   * 从前就是这个歧义逼出了一条内置的特例规则(见 .dev/1.3.0)。
   *
   * false 是常态,不是失败:规则的本职是写进提示词约束模型,硬闸是附加的。
   */
  gate: boolean;
  enabled: boolean;
  origin: "user" | "factory" | "agent";
};

const unique = (values: unknown) =>
  [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];

/** glob → 正则。支持 ** / * / ?,其余字符原样。 */
const globToRegex = (glob: string) => {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") { out += ".*"; i += 1; if (glob[i + 1] === "/") i += 1; }
      else out += "[^/]*";
    } else if (char === "?") out += "[^/]";
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
};

/** 路径归一到绝对形式,~ 展开,相对路径按工作目录解析。 */
export const absolutize = (value: unknown, { home = "", cwd = "" } = {}) => {
  let p = String(value || "").replace(/\/+$/, "") || "/";
  if (p.startsWith("~")) p = `${home}${p.slice(1)}`;
  else if (!p.startsWith("/")) p = `${cwd}/${p}`.replace(/\/+/g, "/");
  const parts: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { parts.pop(); continue; }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
};

/** 校验并归一。闭集外的动作和工具直接丢掉 —— 编译产物必须落在词汇表内。 */
export const normalizeRule = (raw: any = {}): Rule => ({
  id: String(raw.id || ""),
  text: String(raw.text || "").trim(),
  prompt: String(raw.prompt || raw.text || "").trim(),
  match: {
    tools: unique(raw.match?.tools).filter((t) => (TOOLS as readonly string[]).includes(t)),
    actions: unique(raw.match?.actions).filter((a) => (ACTIONS as readonly string[]).includes(a)),
    paths: unique(raw.match?.paths),
  },
  gate: raw.gate === true || raw.gate === 1 || raw.match?.gate === true,
  enabled: raw.enabled !== 0 && raw.enabled !== false,
  origin: ["user", "factory", "agent"].includes(raw.origin) ? raw.origin : "user",
});

/**
 * 这条规则的硬闸管不管这次调用。维度之间是与,维度之内是或,**空维度 = 不设限**。
 * 所以 `gate` 开着而三维全空 = 拦住任何一次工具调用 ——「所有编辑工具都先问我」
 * 只是 tools 填了两个值的普通情形,不需要任何特例。
 */
export const matches = (rule: Rule, request: ToolRequest, context: { home?: string; cwd?: string } = {}) => {
  if (!rule.gate || !rule.enabled) return false;
  const { tools, actions, paths } = rule.match;
  if (tools.length && !tools.includes(request.tool)) return false;
  if (actions.length && !actions.some((a) => (request.actions as string[]).includes(a))) return false;
  if (paths.length) {
    const candidates = request.paths.map((p) => absolutize(p, context));
    const hit = paths.some((glob) => {
      const pattern = globToRegex(absolutize(glob, context));
      // 「~/Downloads/**」必须连 ~/Downloads 自己一起罩住 ——
      // 否则 rm -rf ~/Downloads 反而漏过,而那恰恰是最该拦的一下
      const base = absolutize(String(glob).replace(/\/\*\*$/, ""), context);
      return candidates.some((p) => pattern.test(p) || p === base || p.startsWith(`${base}/`));
    });
    if (!hit) return false;
  }
  return true;
};

export type Verdict = { effect: "allow" | "ask"; reason: string; rule: Rule | null };

/**
 * 判这次调用怎么走。
 *   盾关(skip)  不问不拦
 *   盾开(rules) 命中任意一条规则就停下来问;都没命中就放行
 */
export const decide = (
  { mode, rules = [], request, context = {} }:
  { mode: Mode; rules?: Rule[]; request: ToolRequest; context?: { home?: string; cwd?: string } },
): Verdict => {
  if (mode === "skip") return { effect: "allow", reason: "护盾已关", rule: null };

  const rule = rules.find((r) => matches(r, request, context));
  if (!rule) return { effect: "allow", reason: "没有规则说到这件事", rule: null };
  return { effect: "ask", reason: rule.text, rule };
};

/** 拼进系统提示词的那一段。 */
export const injection = (rules: Rule[] = [], mode: Mode = "rules") => {
  const live = rules.filter((r) => r.enabled);
  const lines: string[] = [];
  if (live.length) {
    lines.push("## 用户的规则", "用户对你提了这些要求,优先于你自己的判断:");
    for (const rule of live) lines.push(`- ${rule.prompt}`);
  }
  if (mode === "skip") lines.push("", "当前护盾已关:没有任何拦截,你要自己为后果负责。");
  return lines.join("\n");
};
