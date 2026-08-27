// 智能体服务:repo 之上的业务层 —— 富化未读、广播 agents_changed、校验工作目录。
import * as repo from "../repo/agents.js";
import { isAllowedPath } from "../repo/tree.js";
import { emit } from "../bus.js";

const changed = () => emit({ type: "agents_changed" });

// 注:repo/agents.ts 尚未脱 @ts-nocheck,推断类型过窄;边界处收口,repo 脱敏后移除。
type AgentPatch = { title?: string; system?: string | null; workdir?: string; pinned?: boolean };

const list = () => {
  const rows = repo.listAgents() as any[];
  const unread = repo.unreadMap(rows.map((r) => r.id)) as Record<string, boolean>;
  return rows.map((r) => ({ ...r, unread: !!unread[r.id] }));
};

const get = (id: string) => {
  const row = repo.getAgent(id) as any;
  if (!row) return null;
  return { ...row, unread: !!(repo.unreadMap([row.id]) as Record<string, boolean>)[row.id] };
};

const assertWorkdir = (workdir?: string) => {
  if (workdir === undefined) return;
  if (!isAllowedPath(String(workdir))) throw new Error(`工作目录必须在某个工作区内: ${workdir}`);
};

const create = ({ title, system = null, workdir }: AgentPatch = {}) => {
  if (workdir) assertWorkdir(workdir);
  const item = repo.createAgent({ title, system, workdir } as any);
  changed();
  return item;
};

const update = (id: string, patch: AgentPatch = {}) => {
  assertWorkdir(patch.workdir);
  const item = repo.updateAgent(id, patch as any);
  changed();
  return item;
};

const remove = (id: string) => {
  const ok = repo.deleteAgent(id);
  changed();
  return ok;
};

const markRead = (id: string) => repo.markRead(id);

/** 启动时:把磁盘上的历史 .agent.json 收进 SQLite,用户目录从此干净。 */
const migrateOnBoot = () => { try { repo.migrateAgentFiles(); } catch (e: any) { console.error("[agents] 迁移失败:", e?.message); } };

export { list, get, create, update, remove, markRead, migrateOnBoot };
