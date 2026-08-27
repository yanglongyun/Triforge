// 侧边栏注册表(见 APP.md)。
//
// 活动栏三原生 = 产品的三个名词:会话(AI)、文件(资产)、应用(软件形态),焊死不可移除。
// 应用全部来自工作区(<workspace>/apps/<id>/),由 server 扫描下发 —— 预装应用首次启动
// 落地到工作区后,与用户/AI 自己造的应用再无区别。
import { Files, LayoutGrid, MessageSquare } from "lucide-react";

/** 原生面板(宿主的一部分,非应用)。 */
export type NativePanel = { id: "agents" | "files" | "apps"; title: string; icon: typeof MessageSquare };
export const NATIVE_PANELS: NativePanel[] = [
  { id: "agents", title: "会话", icon: MessageSquare },
  { id: "files", title: "文件", icon: Files },
  { id: "apps", title: "应用", icon: LayoutGrid },
];

/** 应用 = 一个 Worker 网站;挂载点是它内部的路由路径。 */
export type AppDef = {
  id: string;
  name: string;
  icon: string; // emoji
  mounts: { panel?: string; tab?: string };
  capabilities: string[];
};
