// 树服务:repo 之上的业务层 —— 负责事件广播(tree_changed)+ 把 update+move 收拢。
// 树上只有文件夹和文件;对话在 service/chats.ts。
import * as repo from "./tree.js";
import * as agents from "../chat/chats.js";
import { searchContent } from "./search.js";
import { emit } from "../bus.js";

// 注:repo/tree.ts 尚未脱 @ts-nocheck,推断签名过窄;边界处以 as any 收口,repo 脱敏后移除。
const listChildren = (parentId?: string | null) => repo.listChildren(parentId || null);
const listAll = () => repo.listAll();
const getItem = (id: string) => repo.getItem(id);

const create = ({ kind, parentId = null, title = "", content = null }: { kind?: string; parentId?: string | null; title?: string; content?: string | null } = {}) => {
  const item = repo.createItem({ kind: kind || "space", parentId: parentId || null, title, content } as any);
  emit({ type: "tree_changed", item, reason: "created" });
  return item;
};

// 改名/改内容 + 移动(都可选),最后返回最新项;overwrite 透传给重名守卫
const update = (id: string, { title, content, parentId, position, overwrite }: { title?: string; content?: string | null; parentId?: string | null; position?: number; overwrite?: boolean } = {}) => {
  let moved = null;
  if (title !== undefined || content !== undefined) {
    moved = repo.updateItem(id, { title, content, overwrite } as any);
  }
  if (parentId !== undefined || position !== undefined) {
    const currentId = moved?.id || id; // 改名后 id(路径)已变
    const cur = repo.getItem(currentId);
    moved = repo.moveItem(currentId, parentId !== undefined ? parentId : cur?.parent_id, position as any, overwrite);
  }
  const item = getItem(moved?.id || id);
  emit({ type: "tree_changed", item, reason: "updated" });
  return item;
};

const importFile = (body: { parentId?: string | null; relPath?: string; dataBase64?: string } = {}) => {
  const item = repo.importFile(body as any);
  emit({ type: "tree_changed", item, reason: "imported" });
  return item;
};

const remove = (id: string) => {
  repo.deleteItem(id);
  emit({ type: "tree_changed", id, reason: "deleted" });
  emit({ type: "chats_changed" }); // 子树上的对话可能被塌缩搬家
};

const copy = (id: string, targetParentId: string | null = null) => {
  const item = repo.copyItem(id, targetParentId as any);
  emit({ type: "tree_changed", item, reason: "copied" });
  return item;
};

const listWorkspaces = () => repo.listWorkspaces();

const addWorkspace = (body: { path?: string } = {}) => {
  const item = repo.addWorkspace(body as any);
  emit({ type: "tree_changed", item, reason: "workspace_added" });
  return item;
};

const removeWorkspace = (id: string) => {
  const workspace = repo.removeWorkspace(id);
  emit({ type: "tree_changed", id, reason: "workspace_removed" });
  return workspace;
};

const ancestry = (id: string) => repo.ancestry(id);
const search = (q: string) => (q ? searchContent(q) : []);
const fileRawAbs = (id: string) => repo.resolveFileAbs(id);
const pathForId = (id: string) => repo.pathForId(id);

/** 终端的 cwd:id 可能是对话 uuid(在它的工作目录开终端)或路径 id。 */
const terminalCwd = (id: string) => {
  const chat = agents.getChat(id);
  if (chat) return agents.resolveWorkdir(chat);
  return repo.terminalCwd(id);
};

export { listChildren, listAll, getItem, create, update, remove, copy, importFile, ancestry, search, fileRawAbs, pathForId, listWorkspaces, addWorkspace, removeWorkspace, terminalCwd };
