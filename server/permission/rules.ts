// 规则:用户写给助手的一句话。只有一个出口 —— 写进提示词。
//
// 没有硬闸。正则和词表只能看命令字面,覆盖面小却要养一套编译器;
// 与其给人「拦得住」的错觉,不如把赌注明白地押在模型遵守规则上。
// 规则要求先问的,模型调 confirm 等用户答复;规则关掉时 confirm 也不在,提示词里明说没有任何拦截。
export type Rule = {
  id: string;
  text: string;
  enabled: boolean;
  position: number;
};

/** 拼进系统提示词的那段。rules 是启用的规则,顺序就是编号。on=false 表示规则整体关着。 */
export const rulesSection = (rules: Rule[], on: boolean) => {
  const lines: string[] = [];
  if (!on) {
    lines.push(
      "## 规则",
      "用户关掉了规则:没有任何拦截,也没有 confirm 工具。",
      "不要问「要不要继续」,用户选择了让你直接做。只做被交代的事;交代之外的不可逆操作留着不做,用一句话说明即可。",
    );
    return lines.join("\n");
  }
  const live = rules.filter((r) => r.enabled);
  lines.push("## 用户的规则", "用户对你提了这些要求,优先于你自己的判断:");
  live.forEach((rule, i) => lines.push(`- [${i + 1}] ${rule.text}`));
  if (!live.length) lines.push("(还没有规则)");
  lines.push(
    "",
    "凡是规则说要先问的,动手之前必须调用 confirm 工具,得到允许才做。",
    "规则没说到、但你自己觉得不可逆或拿不准的,也用 confirm 先问。",
    "普通的可逆步骤不要问,用户已经交代了的事直接做。",
  );
  return lines.join("\n");
};
