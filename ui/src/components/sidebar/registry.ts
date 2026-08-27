// 应用注册表(见 APP.md)。
//
// 活动栏三原生 = 产品的三个名词:会话(AI)、文件(资产)、应用(软件形态),焊死不可移除。
// 其余一切都是「应用」:有的预装(网站/任务,可移除),有的来自工作区(<workspace>/apps/<id>/),
// 将来大多由 AI 生成。挂载点(panel/tab)与能力(capabilities)都是 manifest 里的字段。
import { Files, LayoutGrid, MessageSquare } from "lucide-react";

/** 原生面板(宿主的一部分,非应用)。 */
export type NativePanel = { id: "agents" | "files" | "apps"; title: string; icon: typeof MessageSquare };
export const NATIVE_PANELS: NativePanel[] = [
  { id: "agents", title: "会话", icon: MessageSquare },
  { id: "files", title: "文件", icon: Files },
  { id: "apps", title: "应用", icon: LayoutGrid },
];

/** 应用定义:preset = 随包预装(ui/public/apps/<id>/);workspace = 工作区目录装载。 */
export type AppDef = {
  id: string;
  name: string;
  icon: string; // emoji
  mounts: { panel?: string; tab?: string };
  capabilities: string[];
  /** 应用后端入口(workerd 沙箱里跑的 server.js,导出 Gadget 类)。 */
  server?: string;
  source: "preset" | "workspace";
};

export const PRESET_APPS: AppDef[] = [
  {
    id: "sites",
    name: "网站",
    icon: "🌐",
    mounts: { panel: "index.html" },
    capabilities: ["storage", "tabs", "system"],
    source: "preset",
  },
  {
    id: "todo",
    name: "任务",
    icon: "☑️",
    mounts: { panel: "index.html" },
    capabilities: ["storage"],
    source: "preset",
  },
  {
    // 应用后端(workerd)的预装演示:前端只有一颗按钮,计数逻辑与持久化全在 server.js
    id: "counter",
    name: "计数器",
    icon: "🧮",
    mounts: { tab: "index.html" },
    capabilities: ["db"],
    server: "server.js",
    source: "preset",
  },
];

/** 应用某挂载入口的 iframe 地址。
 *  标签页是「打开应用」的统一落点:只声明了 panel 的应用(书签、任务这类窄栏视图),
 *  在标签页里退回用它的 panel 入口渲染 —— 宁可布局空旷,也不让点击落空。
 *  反向不退回:侧栏窄,tab 版布局塞不进去,没声明 panel 就不能钉。 */
export const appEntryUrl = (app: AppDef, mount: "panel" | "tab") => {
  const entry = app.mounts[mount] || (mount === "tab" ? app.mounts.panel : undefined);
  if (!entry) return null;
  return app.source === "preset" ? `/apps/${app.id}/${entry}` : `/workspace-apps/${app.id}/${entry}`;
};
