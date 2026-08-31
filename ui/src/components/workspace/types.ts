import type { Node } from "../../api";

export const TERMINAL_TAB_PREFIX = "__terminal__";
export const GIT_TAB_PREFIX = "__git__";
export const GIT_DIFF_TAB_PREFIX = "__git_diff__";
export const SETTINGS_TAB_ID = "__settings__";
export const WIDGETS_TAB_ID = "__widgets__";

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

/** 组件管理:装了哪些、钉/取下、删除、让 AI 造一个。
 *  走标签页而不是侧栏面板 —— 管理是「摊开来看」的事,侧栏那 260px 摆不下。 */
export type WidgetsTab = {
  id: typeof WIDGETS_TAB_ID;
  kind: "widgets";
  title: "组件";
};

export const APP_TAB_PREFIX = "__app__";

/** 应用标签:一个 iframe 指向 app 自己的 origin(每个 app 一个真端口)。
 *  地址不存在这里 —— 端口每次启动都变,打开时现向宿主取。 */
export type AppTab = {
  id: string;
  kind: "app";
  title: string;
  appId: string;
};

export const LAUNCHER_TAB_PREFIX = "__launcher__";

/** 新标签页:一个全能输入框 —— 输入文字开对话,输入网址开网站;就地转身成目标标签。 */
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
  /**
   * 从哪个标签点出来的。**Chrome 的规则**:从某个标签打开的新标签插在它后面
   * (以及它已经开出来的那些之后),不是丢到末尾 —— 丢到末尾会让你点开一个链接
   * 之后得横跨整条标签栏去找它。加号/⌘T 开的没有来源,才排末尾。
   */
  openerId?: string;
};

export type WorkspaceTab = Node | TerminalTab | GitTab | GitDiffTab | SettingsTab | WidgetsTab | AppTab | WebTab | LauncherTab;
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
  newTab: (groupId: WorkspaceGroupId, anchor?: HTMLElement) => void;
};

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

export const widgetsTab = (): WidgetsTab => ({
  id: WIDGETS_TAB_ID,
  kind: "widgets",
  title: "组件",
});

/** 同一个应用只开一个标签:id 由 appId 定,重复打开会聚焦到已有那个。 */
export const appTab = (appId: string, title: string): AppTab => ({
  id: `${APP_TAB_PREFIX}:${appId}`,
  kind: "app",
  title,
  appId,
});

export const launcherTab = (): LauncherTab => ({
  id: `${LAUNCHER_TAB_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  kind: "launcher",
  title: "新标签页",
});

export const webTab = (url: string, title?: string, token?: string, openerId?: string): WebTab => ({
  id: `${WEB_TAB_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  kind: "web",
  title: title || url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
  url,
  token,
  openerId,
});

export const isTerminalTab = (tab: WorkspaceTab | null | undefined): tab is TerminalTab =>
  tab?.kind === "terminal";

export const isGitTab = (tab: WorkspaceTab | null | undefined): tab is GitTab =>
  tab?.kind === "git";

export const isGitDiffTab = (tab: WorkspaceTab | null | undefined): tab is GitDiffTab =>
  tab?.kind === "git-diff";

export const isSettingsTab = (tab: WorkspaceTab | null | undefined): tab is SettingsTab =>
  tab?.kind === "settings";

export const isWidgetsTab = (tab: WorkspaceTab | null | undefined): tab is WidgetsTab =>
  tab?.kind === "widgets";

export const isAppTab = (tab: WorkspaceTab | null | undefined): tab is AppTab =>
  tab?.kind === "app";

export const isLauncherTab = (tab: WorkspaceTab | null | undefined): tab is LauncherTab =>
  tab?.kind === "launcher";

export const isWebTab = (tab: WorkspaceTab | null | undefined): tab is WebTab =>
  tab?.kind === "web";

export const isNodeTab = (tab: WorkspaceTab | null | undefined): tab is Node =>
  !!tab && tab.kind !== "terminal" && tab.kind !== "git" && tab.kind !== "git-diff" && tab.kind !== "settings"
  && tab.kind !== "widgets" && tab.kind !== "app" && tab.kind !== "web" && tab.kind !== "launcher";

export const isOpenableSpace = (node: Node | null | undefined): node is Node =>
  !!node && node.kind !== "space";
