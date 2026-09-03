// 技能面板:产品家目录里的技能(出厂的 + 用户自己放的),一行一条 + 开关。
// 关掉 = 不进提示词,文件不动。点一行在标签页看 SKILL.md。
import { useCallback, useEffect, useState } from "react";
import { api, type SkillInfo } from "../../../api";
import { Switch } from "../../ui";

export function SkillsPanel({ onOpenSkill }: { onOpenSkill: (id: string, title: string) => void }) {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const load = useCallback(() => { void api.listSkills().then(setSkills).catch(() => setSkills([])); }, []);
  useEffect(() => { load(); }, [load]);

  const toggle = async (skill: SkillInfo, enabled: boolean) => {
    setSkills((list) => (list || []).map((s) => (s.id === skill.id ? { ...s, enabled } : s)));
    try { await api.toggleSkill(skill.id, enabled); } catch { load(); }
  };

  if (!skills) return <div className="flex-1 px-3 py-6 text-center text-[12.5px] text-text-faint">读取中…</div>;
  if (!skills.length) {
    return (
      <div className="flex-1 px-4 py-10 text-center">
        <div className="text-[13px] text-text-dim">还没有技能</div>
        <div className="mt-1 text-[11.5px] text-text-faint leading-relaxed">往 ~/.worktop/skills/&lt;名字&gt;/SKILL.md 放一份,就会出现在这里。</div>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto py-1">
      {skills.map((skill) => (
        <div
          key={skill.id}
          onClick={() => onOpenSkill(skill.id, skill.name)}
          title={skill.path}
          className="group flex items-center gap-2.5 py-2 pl-3 pr-2 cursor-pointer select-none hover:bg-bg-hover"
        >
          <div className="flex-1 min-w-0">
            <div className={`text-[13.5px] truncate ${skill.enabled ? "text-text" : "text-text-faint"}`}>{skill.name}</div>
            <div className="text-[11.5px] text-text-faint truncate">{skill.description || "没有描述"}</div>
          </div>
          <div onClick={(e) => e.stopPropagation()} className="shrink-0">
            <Switch on={skill.enabled} onChange={(next) => void toggle(skill, next)} label={`${skill.enabled ? "停用" : "启用"} ${skill.name}`} />
          </div>
        </div>
      ))}
    </div>
  );
}
