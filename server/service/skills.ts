// 出厂技能:随包播种到产品家目录 ~/.worktop/skills/<name>/SKILL.md,和出厂组件一个套路 ——
// 落地之后就是用户自己的文件,可改可删,已存在的目录绝不覆盖。
// 提示词里每条技能只占一行(名称 + 描述 + 路径),模型要用时自己 read。
import fs from "fs";
import path from "path";
import { REPO_ROOT } from "../home.js";
import { parseSkill, productHome } from "../repo/tree.js";

const UI_DIST = process.env.WORKTOP_UI_DIST || path.join(REPO_ROOT, "ui/dist");

export const skillsHome = () => path.join(productHome(), "skills");

export const seedPresetSkills = () => {
  const home = skillsHome();
  const presetDir = path.join(UI_DIST, "skills");
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(presetDir, { withFileTypes: true }); } catch { return; }
  fs.mkdirSync(home, { recursive: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(home, entry.name);
    if (fs.existsSync(target)) continue;
    try {
      fs.cpSync(path.join(presetDir, entry.name), target, { recursive: true });
      console.log(`[skills] 出厂技能已落地:skills/${entry.name}`);
    } catch (e: any) {
      console.error(`[skills] 落地失败 ${entry.name}:`, e?.message);
    }
  }
};

export type ProductSkill = { name: string; description: string; path: string };

/** 产品家目录里的技能(出厂的 + 用户自己放进去的),给所有对话用。 */
export const listProductSkills = (): ProductSkill[] => {
  const home = skillsHome();
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(home, { withFileTypes: true }); } catch { return []; }
  const out: ProductSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const file = path.join(home, entry.name, "SKILL.md");
    try {
      const meta = parseSkill(fs.readFileSync(file, "utf8"), entry.name);
      out.push({ name: meta.name, description: meta.description, path: file });
    } catch { /* 没有 SKILL.md 的目录不算技能 */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
};
