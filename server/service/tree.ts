// @ts-nocheck
// 树服务:repo 之上的业务层 —— 负责事件广播(tree_changed)+ 把 update+move 收拢。
// 树上只有文件夹和文件;智能体在 service/agents.ts。
import * as repo from "../repo/tree.js";
import * as agents from "../repo/agents.js";
import { searchContent } from "../repo/search.js";
import { emit } from "../bus.js";

const listChildren = (parentId) => repo.listChildren(parentId || null);
const listAll = () => repo.listAll();
const getItem = (id) => repo.getItem(id);

const create = ({ kind, parentId = null, title = "", content = null } = {}) => {
  const item = repo.createItem({ kind: kind || "space", parentId: parentId || null, title, content });
  emit({ type: "tree_changed", item, reason: "created" });
  return item;
};

// 改名/改内容 + 移动(都可选),最后返回最新项;overwrite 透传给重名守卫
const update = (id, { title, content, parentId, position, overwrite } = {}) => {
  let moved = null;
  if (title !== undefined || content !== undefined) {
    moved = repo.updateItem(id, { title, content, overwrite });
  }
  if (parentId !== undefined || position !== undefined) {
    const currentId = moved?.id || id; // 改名后 id(路径)已变
    const cur = repo.getItem(currentId);
    moved = repo.moveItem(currentId, parentId !== undefined ? parentId : cur?.parent_id, position, overwrite);
  }
  const item = getItem(moved?.id || id);
  emit({ type: "tree_changed", item, reason: "updated" });
  return item;
};

const importFile = (body = {}) => {
  const item = repo.importFile(body);
  emit({ type: "tree_changed", item, reason: "imported" });
  return item;
};

const remove = (id) => {
  repo.deleteItem(id);
  emit({ type: "tree_changed", id, reason: "deleted" });
  emit({ type: "agents_changed" }); // 子树上的智能体可能被塌缩搬家
};

const copy = (id, targetParentId = null) => {
  const item = repo.copyItem(id, targetParentId);
  emit({ type: "tree_changed", item, reason: "copied" });
  return item;
};

const listWorkspaces = () => repo.listWorkspaces();

const addWorkspace = (body = {}) => {
  const item = repo.addWorkspace(body);
  emit({ type: "tree_changed", item, reason: "workspace_added" });
  return item;
};

const removeWorkspace = (id) => {
  const workspace = repo.removeWorkspace(id);
  emit({ type: "tree_changed", id, reason: "workspace_removed" });
  return workspace;
};

const ancestry = (id) => repo.ancestry(id);
const search = (q) => (q ? searchContent(q) : []);
const fileRawAbs = (id) => repo.resolveFileAbs(id);
const pathForId = (id) => repo.pathForId(id);

/** 终端的 cwd:id 可能是智能体 uuid(在它的工作目录开终端)或路径 id。 */
const terminalCwd = (id) => {
  const agent = agents.getAgent(id);
  if (agent) return agents.resolveWorkdir(agent);
  return repo.terminalCwd(id);
};

export { listChildren, listAll, getItem, create, update, remove, copy, importFile, ancestry, search, fileRawAbs, pathForId, listWorkspaces, addWorkspace, removeWorkspace, terminalCwd };
