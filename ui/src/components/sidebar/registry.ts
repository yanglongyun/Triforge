// 侧边栏注册表(见 WIDGET.md)。
//
// 活动栏三原生 = 产品的三个名词:会话(AI)、文件(资产)、网站(浏览),焊死不可移除。
// 其余一切都是**组件**:组件的家在 <家>/widgets/<id>/,目录即安装。
// 组件默认不占活动栏位置 —— 用户在「组件」里把它钉上去才出现。
import { Files, Globe, MessageSquare } from "lucide-react";

/** 原生面板(宿主的一部分,不是组件)。 */
export type NativePanel = { id: "agents" | "files" | "sites"; title: string; icon: typeof MessageSquare };
export const NATIVE_PANELS: NativePanel[] = [
  { id: "agents", title: "会话", icon: MessageSquare },
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
