// 面板注册表:侧边栏 = 可扩展的面板宿主(见 PANEL.md)。
// 双轨制:会话/文件是原生 React(深度集成:拖拽/多选/快捷键);
// 「网站」是预置的 iframe 面板示例;从 + 安装的扩展面板一律 iframe 沙箱。
import { Files, Globe, ListTodo, MessageSquare } from "lucide-react";

export type PanelDef = { id: string; title: string; icon: typeof MessageSquare; ext?: boolean };

export const BUILTIN_PANELS: PanelDef[] = [
  { id: "agents", title: "会话", icon: MessageSquare },
  { id: "files", title: "文件", icon: Files },
  { id: "sites", title: "网站", icon: Globe }, // 预置,但载体是 iframe —— 面板契约的白老鼠
];

export const EXT_PANELS: Record<string, PanelDef> = {
  todo: { id: "todo", title: "任务", icon: ListTodo, ext: true },
};
