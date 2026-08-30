// 护盾开箱即有的部分:内置规则「任何操作都问我」+ 老三档设置的收敛迁移。
//
// 旧模型有三档:逐步确认 / 按照规则 / 完全跳过。新模型只剩「盾是开关,规则是内容」:
// skip = 盾关,rules = 盾开,而「逐步确认」= 盾开 + 内置规则勾上。
// 老库里存着 permissionMode='ask' 的,启动时翻译成新形状 —— 行为一丝不变,只是换了说法。
import { getSettings, saveSettings } from "../repo/settings.js";
import { seedAskAllRule, updateRule } from "../repo/rules.js";
import { ASK_ALL_ID } from "./rules.js";

export const seedShield = () => {
  seedAskAllRule();
  const settings = getSettings() as { permissionMode?: string };
  if (settings.permissionMode === "ask") {
    updateRule(ASK_ALL_ID, { enabled: true });
    saveSettings({ permissionMode: "rules" });
  }
};
