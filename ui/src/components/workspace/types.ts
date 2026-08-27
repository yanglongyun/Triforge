import type { Node } from "../../api";
import type { AppDef } from "../sidebar/registry";

export const PROCESS_TAB_ID = "__process_preview__";
export const TERMINAL_TAB_PREFIX = "__terminal__";
export const GIT_TAB_PREFIX = "__git__";
export const GIT_DIFF_TAB_PREFIX = "__git_diff__";
export const SETTINGS_TAB_ID = "__settings__";
export const ACTIVITY_TAB_ID = "__activity__";

export type ProcessTab = {
  id: typeof PROCESS_TAB_ID;
  kind: "process";
  title: "Preview";
};

export type TerminalTab = {
  id: string;
  kind: "terminal";
  title: string;
  cwd: string;
  initialCommand?: string;
};

export type GitDiffTab = {
  id: string;
  kind: "git-diff";
  title: string;
  root: string;
  path: string;
  staged?: boolean;
};

export type GitTab = {
  id: string;
  kind: "git";
  title: string;
  root: string;
};

export type SettingsTab = {
  id: typeof SETTINGS_TAB_ID;
  kind: "settings";
  title: "设置";
};

export type ActivityTab = {
  id: typeof ACTIVITY_TAB_ID;
  kind: "activity";
  title: "活动";
};

export const APP_TAB_PREFIX = "__app__";

/** 应用标签页(tab 挂载的应用实例,AppFrame 装载)。id 按 appId 稳定 → 天然去重聚焦。 */
export type AppTab = {
  id: string;
  kind: "app";
  app: AppDef;
  title: string;
  route?: string;
};

export const appTab = (app: AppDef, route = ""): AppTab => ({
  id: `${APP_TAB_PREFIX}:${app.id}`,
  kind: "app",
  app,
  title: app.name,
  route,
});

export const isAppTab = (tab: WorkspaceTab | null | undefined): tab is AppTab =>
  tab?.kind === "app";

export const LAUNCHER_TAB_PREFIX = "__launcher__";

/** 新标签页(方案 C):一个全能输入框 —— 输入文字开对话,输入网址开网站;就地转身成目标标签。 */
export type LauncherTab = {
  id: string;
  kind: "launcher";
  title: string;
};

export const WEB_TAB_PREFIX = "__web__";

/** 网页标签:Electron 壳里的 <webview>,常驻挂载(卸载 = 断网重载,登录态全丢)。 */
export type WebTab = {
  id: string;
  kind: "web";
  title: string;
  url: string;
  /** browser open 的关联令牌:webview 注册时带上,server 以此兑现「打开标签」请求。 */
  token?: string;
  /** 页面上报的真实 favicon 地址(page-favicon-updated),标签栏优先用它。 */
  favicon?: string;
};

export type WorkspaceTab = Node | ProcessTab | TerminalTab | GitTab | GitDiffTab | SettingsTab | ActivityTab | WebTab | LauncherTab | AppTab;
export type WorkspaceGroupId = "main" | "side";

export type WorkspaceGroupState = {
  id: WorkspaceGroupId;
  tabs: WorkspaceTab[];
  activeId: string | null;
  previewId: string | null;
};

/** 标签操作合集:App 装一次包,贯穿 Layout → Group → TabBar,不再逐层点名 20 个回调。 */
export type TabActions = {
  focusGroup: (groupId: WorkspaceGroupId) => void;
  activate: (groupId: WorkspaceGroupId, id: string) => void;
  close: (groupId: WorkspaceGroupId, id: string) => void;
  reorder: (groupId: WorkspaceGroupId, tabs: WorkspaceTab[]) => void;
  moveFromGroup: (fromGroupId: WorkspaceGroupId, tabId: string, toGroupId: WorkspaceGroupId, toIndex?: number) => void;
  moveToOther: (groupId: WorkspaceGroupId, tabId: string) => void;
  toggleSideGroup: () => void;
  closeOthers: (groupId: WorkspaceGroupId, keepId: string) => void;
  closeToRight: (groupId: WorkspaceGroupId, afterId: string) => void;
  closeGroup: (groupId: WorkspaceGroupId) => void;
  /** 新标签页(方案 C):在指定分组开启动器。 */
  newTab: (groupId: WorkspaceGroupId) => void;
};

export const processTab = (): ProcessTab => ({
  id: PROCESS_TAB_ID,
  kind: "process",
  title: "Preview",
});

export const terminalTab = (cwd: string, title = "Terminal", initialCommand?: string): TerminalTab => ({
  id: `${TERMINAL_TAB_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  kind: "terminal",
  title,
  cwd,
  initialCommand,
});

export const gitTab = (root: string, title = "Git"): GitTab => ({
  id: `${GIT_TAB_PREFIX}:${root}`,
  kind: "git",
  title,
  root,
});

export const gitDiffTab = (root: string, filePath: string, staged = false): GitDiffTab => ({
  id: `${GIT_DIFF_TAB_PREFIX}:${root}:${filePath}:${staged ? "staged" : "worktree"}`,
  kind: "git-diff",
  title: `${filePath}${staged ? " (staged)" : ""}`,
  root,
  path: filePath,
  staged,
});

export const settingsTab = (): SettingsTab => ({
  id: SETTINGS_TAB_ID,
  kind: "settings",
  title: "设置",
});

export const activityTab = (): ActivityTab => ({
  id: ACTIVITY_TAB_ID,
  kind: "activity",
  title: "活动",
});

export const launcherTab = (): LauncherTab => ({
  id: `${LAUNCHER_TAB_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  kind: "launcher",
  title: "新标签页",
});

export const webTab = (url: string, title?: string, token?: string): WebTab => ({
  id: `${WEB_TAB_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  kind: "web",
  title: title || url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
  url,
  token,
});

export const isProcessTab = (tab: WorkspaceTab | null | undefined): tab is ProcessTab =>
  tab?.kind === "process";

export const isTerminalTab = (tab: WorkspaceTab | null | undefined): tab is TerminalTab =>
  tab?.kind === "terminal";

export const isGitTab = (tab: WorkspaceTab | null | undefined): tab is GitTab =>
  tab?.kind === "git";

export const isGitDiffTab = (tab: WorkspaceTab | null | undefined): tab is GitDiffTab =>
  tab?.kind === "git-diff";

export const isSettingsTab = (tab: WorkspaceTab | null | undefined): tab is SettingsTab =>
  tab?.kind === "settings";

export const isActivityTab = (tab: WorkspaceTab | null | undefined): tab is ActivityTab =>
  tab?.kind === "activity";

export const isWebTab = (tab: WorkspaceTab | null | undefined): tab is WebTab =>
  tab?.kind === "web";

export const isLauncherTab = (tab: WorkspaceTab | null | undefined): tab is LauncherTab =>
  tab?.kind === "launcher";

export const isNodeTab = (tab: WorkspaceTab | null | undefined): tab is Node =>
  !!tab && tab.kind !== "process" && tab.kind !== "terminal" && tab.kind !== "git" && tab.kind !== "git-diff" && tab.kind !== "settings" && tab.kind !== "activity" && tab.kind !== "web" && tab.kind !== "launcher" && tab.kind !== "app";

export const isOpenableSpace = (node: Node | null | undefined): node is Node =>
  !!node && node.kind !== "space";
