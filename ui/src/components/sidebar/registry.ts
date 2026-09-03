// 侧边栏注册表。
//
// 活动栏原生 = 会话(AI)、文件(资产)、网站(浏览)、应用(跨宿主的 app 标准),焊死不可移;技能暂不上活动栏(见下),工具/任务在 PanelHost 里除。
// 其余一切都是**组件**:组件的家在 <家>/widgets/<id>/,目录即安装。
// 组件不占活动栏:全部收进「工具」面板(格子),点一个进入。
import { AppWindow, Files, Globe, MessageSquare } from "lucide-react";

/** 原生面板(宿主的一部分,不是组件)。 */
export type NativePanel = { id: "agents" | "files" | "sites" | "skills" | "apps"; title: string; icon: typeof MessageSquare };
export const NATIVE_PANELS: NativePanel[] = [
  { id: "agents", title: "会话", icon: MessageSquare },
  { id: "files", title: "文件", icon: Files },
  { id: "sites", title: "网站", icon: Globe },
  // 技能:产品家目录里的 SKILL.md 列表 + 开关,点开在标签页看
  // 技能先不上活动栏(功能留着:面板、标签页、API 都在),要显示时把这行放回来
  // { id: "skills", title: "技能", icon: Sparkles(lucide) },
  // 应用是启动器,不是面板:组件挂进侧栏,应用开在标签页 —— 所以这里列表 + 状态
  { id: "apps", title: "应用", icon: AppWindow },
];

/** 组件 = 一个目录,跑在自己的 origin 上(http://127.0.0.1:<组件端口>/)。 */
export type WidgetDef = {
  id: string;
  name: string;
  icon: string; // emoji
  description: string;
  permissions: string[];
};
