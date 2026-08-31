// 编译:看这句话能不能再落一道硬闸,以及闸的作用范围有多大。
//
// **规则本身不需要编译就已经生效**(它会写进提示词)。这里做的是附加的一步:
// 先定作用范围 —— 该拦哪些工具的调用;再按危险动作和路径往下收窄。
// 范围可以是「全部」(三维留空 + gate),那就是每次工具调用都停。
//
// 调模型做,但一次生成不当数 —— 两层校验:
//   硬校验  产出的动作/工具必须在闭集内,不在的直接丢
//   软校验  再问模型一次「这个范围是不是准确表达了那句话」,不通过就撤掉闸
//
// 撤掉闸不是失败,只是回到主路。但**不能让用户以为有闸而其实没有** ——
// 界面必须如实说明这条是怎么起作用的。
import { complete } from "../ai/index.js";
import { getSettings } from "../repo/settings.js";
import { ACTIONS, ACTION_LABELS, TOOLS } from "./danger.js";
import { normalizeRule, type Rule } from "./rules.js";

const VOCAB = ACTIONS.map((a) => `${a}(${ACTION_LABELS[a]})`).join("、");

const INSTRUCTIONS = [
  "用户写了一条规则,说明什么情况下要先问过他。这条规则一定会写进助理的提示词约束它;",
  "你要判断的是:能不能在此之上再加一道硬闸 —— 命中就暂停、等用户点头 —— 以及闸管多大范围。",
  "只输出 JSON,不要解释,不要代码围栏。",
  "",
  "字段:",
  "  prompt  用一句完整的话复述这条规则,给助理看",
  "  gate    要不要加硬闸,true / false。判断标准见下",
  `  tools   闸的作用范围:哪些工具的调用要停。只能从这些里选:${TOOLS.join("、")};`,
  "          **留空 = 不限工具**(gate 为 true 且三个数组都留空 = 任何一次工具调用都停)",
  `  actions 再按危险动作收窄,只能从这些里选:${VOCAB};不收窄就留空`,
  "  paths   再按路径收窄,写成 glob,例如 ~/Downloads 或 /etc/**;不收窄就留空",
  "",
  "gate 怎么判:",
  "  规则指明了「哪一类操作」要停 —— 哪怕宽到「所有编辑操作」「任何操作」 ——",
  "  就给 true,把范围写进上面三个数组(可以全留空表示不限)。",
  "  规则只是态度、风格、偏好上的要求(例如「别自作主张」「回答简洁点」),",
  "  没有可判定的操作边界,就给 false,三个数组留空。",
  "  **false 不是失败**:这条规则照样进提示词生效,只是没有硬闸兜底,不要为了给出",
  "  一个闸而硬凑不准确的范围。",
  "",
  "工具的含义:bash 执行命令(它也能改文件),read 读文件,write 新建或整体重写,edit 精确替换。",
  "用户说「编辑类工具」通常指 write 和 edit;说「所有会动我东西的操作」要把 bash 一起带上。",
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
  // 三维全空 = 不限范围,那句话得说成人话,不能拼出一个空的「当…时」
  const scope = parts.length ? `当${parts.join("、且")}时` : "在助理每一次工具调用时";
  const description = [
    `用户立的规则:「${text}」`, "",
    `系统据此设定为:${scope},暂停下来询问用户。`, "",
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

/** note 只在「有话要说」时非空 —— 没有硬闸是常态,不该拿 note 吓人。 */
export type CompiledRule = Rule & { note: string };

export const compileRule = async (text: unknown): Promise<CompiledRule> => {
  const raw = String(text || "").trim();
  const bare = { ...normalizeRule({ text: raw, prompt: raw }), note: "" };
  if (!raw) return { ...bare, note: "内容为空" };

  const base = runtime();
  if (!base) return { ...bare, note: "未配置模型,无法生成拦截条件" };

  const result: any = await complete({ ...base, instructions: INSTRUCTIONS, input: [{ role: "user", content: raw }] })
    .catch(() => ({ text: "" }));

  const parsed = parseJson(result.text);
  if (!parsed) return { ...bare, note: "" };

  // 硬校验:归一时闭集外的动作/工具会被直接丢掉
  const rule = normalizeRule({
    text: raw,
    prompt: parsed.prompt || raw,
    gate: parsed.gate === true,
    match: { tools: parsed.tools, actions: parsed.actions, paths: parsed.paths },
  });
  if (!rule.gate) return { ...rule, note: "" };

  if (!(await verify(base, raw, rule.match))) {
    return { ...rule, gate: false, match: { tools: [], actions: [], paths: [] }, note: "拦截条件未通过复核,已撤销" };
  }
  return { ...rule, note: "" };
};
