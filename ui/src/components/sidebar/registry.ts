// 侧边栏注册表。
//
// 侧栏三段固定 = 对话(AI)、文件(资产)、网站(浏览),横向切换,焊死不可移除。
// 其余一切都是**组件**:组件的家在 <家>/widgets/<id>/,目录即安装,住在侧栏下半的「工具箱」里。
// 应用、技能在「新标签页」进;任务在标签栏右端的小图标。
import { Files, Globe, MessageSquare } from "lucide-react";

/** 原生面板(宿主的一部分,不是组件)。 */
export type NativePanelId = "agents" | "files" | "sites";
export type NativePanel = { id: NativePanelId; title: string; icon: typeof MessageSquare };
export const NATIVE_PANELS: NativePanel[] = [
  { id: "agents", title: "对话", icon: MessageSquare },
  { id: "files", title: "文件", icon: Files },
  { id: "sites", title: "网站", icon: Globe },
];

/** 组件 = 一个目录,跑在自己的 origin 上(http://127.0.0.1:<组件端口>/)。 */
export type WidgetDef = {
  id: string;
  name: string;
  icon: string; // emoji
  description: string;
  permissions: string[];
};
