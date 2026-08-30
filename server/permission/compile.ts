// 编译:把用户的一句话变成拦截条件。
//
// 调模型做,但一次生成不当数 —— 两层校验:
//   硬校验  产出的动作/工具必须在闭集内,不在的直接丢
//   软校验  再问模型一次「这条条件是不是准确表达了那句话」,不通过就降级
//
// **降级不是失败**:编译不出来 → 只留提示词出口,界面照实说这条拦不住。
// 宁可告诉用户「这条拦不住」,也不能让他以为拦得住。
import { complete } from "../ai/index.js";
import { getSettings } from "../repo/settings.js";
import { ACTIONS, ACTION_LABELS, TOOLS } from "./danger.js";
import { normalizeRule, type Rule } from "./rules.js";

const VOCAB = ACTIONS.map((a) => `${a}(${ACTION_LABELS[a]})`).join("、");

const INSTRUCTIONS = [
  "用户写了一条规则,说明什么情况下要先问过他。把它翻译成结构化的触发条件。",
  "只输出 JSON,不要解释,不要代码围栏。",
  "",
  "字段:",
  "  prompt  用一句完整的话复述这条规则,给助理看",
  `  actions 触发的危险动作,只能从这些里选:${VOCAB};选不出就给空数组`,
  `  tools   涉及的工具,只能从这些里选:${TOOLS.join("、")};不限定就给空数组`,
  "  paths   涉及的路径,写成 glob,例如 ~/Downloads 或 /etc/**;不涉及就给空数组",
  "",
  "重要:三个数组都为空,意味着这条规则没法变成触发条件 —— 这是允许的,",
  "不要为了填满而硬凑一个不准确的条件。宁可空着,也不要编。",
].join("\n");

const parseJson = (text: unknown) => {
  const body = String(text || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(body); } catch { return null; }
};

const runtime = () => {
  const s = getSettings() as any;
  if (!s.apiUrl || !s.apiKey || !s.model) return null;
  return {
    driver: s.driver, responsesUrl: s.apiUrl, apiKey: s.apiKey, model: s.model,
    modelOptions: undefined, retry: undefined, errorMaxChars: 4000, signal: undefined,
  };
};

/**
 * 软校验:让模型自己判一次编译得准不准。判不准就降级,不硬撑。
 *
 * 问句必须是人话 —— 直接把 `动作=install;工具=bash` 丢过去,模型看不懂那是什么
 * 就一律答 no,正确的编译会被成批打回,比没有这道校验还糟。
 */
const verify = async (base: any, text: string, match: Rule["match"]) => {
  const parts: string[] = [];
  if (match.tools.length) parts.push(`助理调用 ${match.tools.join(" 或 ")} 工具`);
  if (match.actions.length) parts.push(`这次操作属于「${match.actions.map((a) => ACTION_LABELS[a] || a).join("」或「")}」`);
  if (match.paths.length) parts.push(`涉及路径 ${match.paths.join(" 或 ")}`);
  const description = [
    `用户立的规则:「${text}」`, "",
    `系统据此设定为:当${parts.join("、且")}时,暂停下来询问用户。`, "",
    "这个设定忠实于用户的规则吗?只要它会在用户真正在意的那些操作上触发,就算忠实;",
    "不必要求它一字不差,也不必挑剔它顺带覆盖了相近的情形。",
  ].join("\n");
  const result: any = await complete({
    ...base,
    instructions: "你在复核一条自动生成的规则设定。只回答 yes 或 no。",
    input: [{ role: "user", content: description }],
  }).catch(() => null);
  // 复核本身失败(网络、超时)不该连累编译结果 —— 拿不到答复就按通过算
  if (!result) return true;
  return /yes/i.test(String(result.text || ""));
};

export type CompiledRule = Rule & { compiled: boolean; note: string };

/** compiled=false 表示这条规则拦不住任何东西,只写进了提示词。 */
export const compileRule = async (text: unknown): Promise<CompiledRule> => {
  const raw = String(text || "").trim();
  const bare = {
    ...normalizeRule({ text: raw, prompt: raw }),
    compiled: false, note: "",
  };
  if (!raw) return { ...bare, note: "内容为空" };

  const base = runtime();
  if (!base) return { ...bare, note: "还没配置模型,这条只能靠助理自觉遵守" };

  const result: any = await complete({ ...base, instructions: INSTRUCTIONS, input: [{ role: "user", content: raw }] })
    .catch(() => ({ text: "" }));

  const parsed = parseJson(result.text);
  if (!parsed) return { ...bare, note: "没能理解成触发条件,这条只能靠助理自觉遵守" };

  // 硬校验:归一时闭集外的动作/工具会被直接丢掉
  const rule = normalizeRule({
    text: raw,
    prompt: parsed.prompt || raw,
    match: { tools: parsed.tools, actions: parsed.actions, paths: parsed.paths },
  });
  const empty = !rule.match.tools.length && !rule.match.actions.length && !rule.match.paths.length;
  if (empty) return { ...rule, compiled: false, note: "这句话落不成触发条件,只能靠助理自觉遵守" };

  if (!(await verify(base, raw, rule.match))) {
    return { ...rule, match: { tools: [], actions: [], paths: [] }, compiled: false, note: "条件没通过复核,已降级为只靠助理自觉" };
  }
  return { ...rule, compiled: true, note: "" };
};
