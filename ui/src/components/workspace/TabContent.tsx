import type { Settings, Node } from "../../api";
import { ChatPanel } from "../chat";
import { FilePanel } from "../files";
import { SettingsPanel } from "../settings";
import { WidgetsManager } from "../widgets/WidgetsManager";
import { AppPanel, AppsPanel, EmptyPanel, GitDiffPanel, GitView, LauncherPanel, ListPage, SkillPanel, SkillsPanel, TaskPanel, TasksPanel } from "./panels";
import { requestCreateApp } from "../../lib/createRequests";
import { isAppTab, isAppsTab, isGitDiffTab, isGitTab, isLauncherTab, isSettingsTab, isSkillTab, isSkillsTab, isTaskTab, isTasksTab, isWidgetsTab, isNodeTab, type WorkspaceGroupId, type WorkspaceTab } from "./types";

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

export function TabContent({
  tab,
  groupId,
  socket,
  drafts,
  fileRefreshKeys,
  pendingGoto,
  gitRefreshKey,
  onFileChange,
  onFileSaved,
  onSelect,
  onOpenAgent,
  onOpenNav,
  onOpenSettings,
  onSettingsSaved,
  onGitChanged,
  onOpenGitDiff,
  onOpenApp,
  onOpenTask,
  onOpenSkill,
}: {
  tab: WorkspaceTab | null;
  groupId: WorkspaceGroupId;
  socket: Socket;
  drafts: Record<string, string>;
  fileRefreshKeys: Record<string, number>;
  pendingGoto: { id: string; line: number } | null;
  gitRefreshKey: number;
  onFileChange: (id: string, value: string) => void;
  onFileSaved: (id: string) => void;
  onSelect: (n: Node) => void;
  onOpenAgent?: (id: string) => void;
  onOpenNav?: () => void;
  onOpenSettings: () => void;
  onSettingsSaved?: (settings: Settings) => void;
  onGitChanged?: () => void;
  onOpenGitDiff: (root: string, path: string, staged?: boolean, commit?: string) => void;
  onOpenApp: (appId: string, name: string) => void;
  onOpenTask: (taskId: string, title: string) => void;
  onOpenSkill: (skillId: string, title: string) => void;
}) {
  if (!tab) return <EmptyPanel />;

  // 终端不在这里:它和网页标签一样常驻挂载在 WorkspaceGroup(卸载 = 杀 PTY)

  if (isGitTab(tab)) {
    return (
      <GitView
        repoPath={tab.root}
        repoTitle={tab.title}
        refreshKey={gitRefreshKey}
        onOpenDiff={onOpenGitDiff}
        onChanged={onGitChanged}
      />
    );
  }

  if (isGitDiffTab(tab)) {
    return <GitDiffPanel tab={tab} refreshKey={gitRefreshKey} onChanged={onGitChanged} />;
  }

  if (isLauncherTab(tab)) {
    return <LauncherPanel tab={tab} groupId={groupId} />;
  }

  if (isSettingsTab(tab)) {
    return <SettingsPanel onSaved={onSettingsSaved} />;
  }

  if (isAppTab(tab)) {
    return <AppPanel tab={tab} socket={socket} />;
  }

  if (isTaskTab(tab)) {
    return <TaskPanel tab={tab} socket={socket} />;
  }

  if (isSkillTab(tab)) {
    return <SkillPanel tab={tab} />;
  }

  if (isAppsTab(tab)) {
    return (
      <ListPage title="应用" hint="开在标签页里的本地应用,AI 也能调它们的 API。" action={{ label: "让 AI 创建", onClick: requestCreateApp }}>
        <AppsPanel socket={socket} onOpenApp={(app) => onOpenApp(app.id, app.name)} onCreate={requestCreateApp} />
      </ListPage>
    );
  }

  if (isSkillsTab(tab)) {
    return (
      <ListPage title="技能" hint="~/.worktop/skills/ 里的 SKILL.md;开着的会介绍给 AI。">
        <SkillsPanel onOpenSkill={onOpenSkill} />
      </ListPage>
    );
  }

  if (isTasksTab(tab)) {
    return (
      <ListPage title="任务" hint="应用在后台替你干的活,点一条看过程。">
        <TasksPanel socket={socket} onOpenTask={onOpenTask} />
      </ListPage>
    );
  }

  if (isWidgetsTab(tab)) {
    return (
      <WidgetsManager />
    );
  }

  if (isNodeTab(tab) && tab.kind === "chat") {
    return (
      <ChatPanel
        key={tab.id}
        node={tab}
        onSelect={onSelect}
        socket={socket}
        onOpenNav={onOpenNav}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  if (isNodeTab(tab) && tab.kind === "file") {
    return (
      <FilePanel
        key={tab.id}
        node={tab}
        draft={drafts[tab.id]}
        refreshKey={fileRefreshKeys[tab.id] || 0}
        gotoLine={pendingGoto?.id === tab.id ? pendingGoto.line : undefined}
        onChange={(value) => onFileChange(tab.id, value)}
        onSaved={() => onFileSaved(tab.id)}
      />
    );
  }

  return <EmptyPanel />;
}
