// 规则:用户写的一句话,加上系统为它派生的东西。
//
// 一条规则就是一个**触发条件**:命中了就停下来问用户。没有 deny/allow 的分档,
// 也没有类别 —— 该不该做,用户在弹窗那一刻自己判断。
//
// 两个出口,硬度不同:
//   prompt  写进提示词 —— 永远有,靠模型自觉
//   match   编译成拦截条件 —— 编译不出来就是空的,那条规则拦不住任何东西
//
// 用户维护的始终是自己那句 text,不是编译产物。
import { ACTIONS, TOOLS, type ToolRequest } from "./danger.js";

// 护盾模型:盾是开关,规则是内容。skip = 盾关,rules = 盾开;
// 旧「逐步确认」档收敛成内置规则「任何操作都问我」(ask 仅为老库兼容保留,启动时会被迁移掉)。
export const MODES = ["ask", "rules", "skip"] as const;
export type Mode = (typeof MODES)[number];

/** 内置规则:勾上 = 每次动手前都问。它不走条件编译,在 decide 里直判。 */
export const ASK_ALL_ID = "factory-ask-all";
export const ASK_ALL_TEXT = "任何操作都问我";

export type RuleMatch = { tools: string[]; actions: string[]; paths: string[] };
export type Rule = {
  id: string;
  text: string;
  prompt: string;
  match: RuleMatch;
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

/** 这条规则有没有真正的拦截条件。三个维度全空 = 拦不住任何东西。 */
export const hasMatch = (rule: Partial<Rule> | null | undefined) =>
  Boolean(rule?.match && (rule.match.tools?.length || rule.match.actions?.length || rule.match.paths?.length));

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
  enabled: raw.enabled !== 0 && raw.enabled !== false,
  origin: ["user", "factory", "agent"].includes(raw.origin) ? raw.origin : "user",
});

/** 这条规则管不管这次调用。维度之间是与,维度之内是或。 */
export const matches = (rule: Rule, request: ToolRequest, context: { home?: string; cwd?: string } = {}) => {
  if (!hasMatch(rule) || !rule.enabled) return false;
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
 *   ask   逐步确认 —— 每次都停下来
 *   rules 按照规则 —— 命中任意一条规则就停下来;都没命中就放行
 *   skip  完全跳过 —— 不问不拦
 */
export const decide = (
  { mode, rules = [], request, context = {} }:
  { mode: Mode; rules?: Rule[]; request: ToolRequest; context?: { home?: string; cwd?: string } },
): Verdict => {
  if (mode === "skip") return { effect: "allow", reason: "护盾已关", rule: null };
  // 内置「任何操作都问我」勾上 = 逐步确认:不看条件,每一次工具调用都停
  const askAll = rules.find((r) => r.id === ASK_ALL_ID && r.enabled);
  if (askAll) return { effect: "ask", reason: askAll.text, rule: askAll };
  if (mode !== "rules") return { effect: "ask", reason: "逐步确认", rule: null };

  const rule = rules.find((r) => matches(r, request, context));
  if (!rule) return { effect: "allow", reason: "没有规则说到这件事", rule: null };
  return { effect: "ask", reason: rule.text, rule };
};

/** 拼进系统提示词的那一段。 */
export const injection = (rules: Rule[] = [], mode: Mode = "rules") => {
  // 内置「任何操作都问我」不进规则清单 —— 它的全部含义就是下面那一行模式说明
  const askAll = rules.some((r) => r.id === ASK_ALL_ID && r.enabled);
  const live = rules.filter((r) => r.enabled && r.id !== ASK_ALL_ID);
  const lines: string[] = [];
  if (live.length) {
    lines.push("## 用户的规则", "用户对你提了这些要求,优先于你自己的判断:");
    for (const rule of live) {
      const soft = hasMatch(rule) ? "" : "(没有拦截条件兜底,全靠你自觉遵守)";
      lines.push(`- ${rule.prompt}${soft}`);
    }
  }
  if (mode === "skip") lines.push("", "当前护盾已关:没有任何拦截,你要自己为后果负责。");
  else if (askAll || mode === "ask") lines.push("", "用户开着「任何操作都问我」:你的每次工具调用都会先交给用户过目。");
  return lines.join("\n");
};
