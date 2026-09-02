// 技能详情:把 SKILL.md 渲染出来看。改它就去文件面板改那个文件,这里只读。
import { useEffect, useState } from "react";
import { api } from "../../../api";
import { renderMarkdown } from "../../../lib/markdown";
import type { SkillTab } from "../types";

export function SkillPanel({ tab }: { tab: SkillTab }) {
  const [state, setState] = useState<{ content: string } | { error: string } | null>(null);
  useEffect(() => {
    let gone = false;
    setState(null);
    api.skillDoc(tab.skillId)
      .then((r) => { if (!gone) setState({ content: r.content }); })
      .catch((e: any) => { if (!gone) setState({ error: e?.message || "读不到这份技能" }); });
    return () => { gone = true; };
  }, [tab.skillId]);

  if (!state) return <div className="flex-1 flex items-center justify-center text-[12.5px] text-text-faint">读取中…</div>;
  if ("error" in state) return <div className="flex-1 flex items-center justify-center text-[12.5px] text-danger">{state.error}</div>;
  // frontmatter 是给机器看的,正文才是给人看的
  const body = state.content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-bg">
      <div className="px-6 py-6">
        <div className="prose max-w-3xl mx-auto" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
        <div className="max-w-3xl mx-auto mt-8 text-[11.5px] text-text-faint font-mono">{tab.skillId} · ~/.worktop/skills/{tab.skillId}/SKILL.md</div>
      </div>
    </div>
  );
}
