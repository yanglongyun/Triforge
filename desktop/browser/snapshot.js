// 页面快照:把一页东西压成模型读得懂、又不烧 token 的一张清单。
//
// 为什么不直接把 DOM 给模型:那是给程序用的,不是给 token 预算用的 ——
// 走一遍 DOM.getDocument 是好几个来回加巨大 JSON。这里用**无障碍树**
// (Chromium 自己算好的 role/name),裁到「能交互的 + 有信息的」,一行一个:
//
//     [n37-12] button "登录"
//     [n37-18] textbox "邮箱"
//
// ref 里带页面版本(n37):页面一变版本就跳,拿旧 ref 来点会被挡下并要求重读。
// 但版本**只在导航或显式重读时才变** —— 每次 DOM 抖动都作废会把模型逼进
// 「过期→重读→再过期」的循环,那比点错更烧钱。
import { send, sessionsOf, stateOf } from "./cdp.js";

/** 能交互的:模型点得动、填得进去的东西。 */
const ACTIONABLE = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox", "option",
  "checkbox", "radio", "switch", "slider", "spinbutton", "menuitem",
  "menuitemcheckbox", "menuitemradio", "tab", "treeitem",
]);

/** 不能交互但对「这是什么页面」很关键的:标题、提示、报错。 */
const INFORMATIVE = new Set(["heading", "alert", "status", "dialog", "article", "img"]);

const textOf = (node, key) => {
  const value = node?.[key]?.value;
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
};

const propOn = (node, name) => node.properties?.find((p) => p.name === name)?.value?.value;

const lineFor = (node, ref) => {
  const role = textOf(node, "role") || node.role?.value || "";
  const name = textOf(node, "name");
  const value = textOf(node, "value");
  const bits = [`[${ref}]`, role];
  if (name) bits.push(JSON.stringify(name.slice(0, 120)));
  if (value && value !== name) bits.push(`= ${JSON.stringify(value.slice(0, 80))}`);
  // 状态里只留会改变「该不该点」的那几个
  const flags = [];
  if (propOn(node, "disabled")) flags.push("disabled");
  if (propOn(node, "checked")) flags.push("checked");
  if (propOn(node, "expanded") === false) flags.push("collapsed");
  if (propOn(node, "focused")) flags.push("focused");
  if (flags.length) bits.push(`(${flags.join(",")})`);
  return bits.join(" ");
};

/**
 * 取一页的快照。同时把 ref → { backendNodeId, sessionId } 记进这条 webContents
 * 的状态里 —— act 靠它把 ref 还原成能下命令的节点。
 */
export const observe = async (target, { maxNodes = 400 } = {}) => {
  const state = stateOf(target);
  const version = (state.snapshotSeq = (state.snapshotSeq || 0) + 1);
  const refs = new Map();
  const lines = [];

  for (const session of sessionsOf(target)) {
    const sessionId = session.sessionId || undefined;
    let tree;
    try {
      await send(target, "Accessibility.enable", {}, sessionId);
      tree = await send(target, "Accessibility.getFullAXTree", {}, sessionId);
    } catch {
      continue; // 某个 iframe 拿不到就跳过,别让整页快照失败
    }

    // iframe 那行把 sessionId 打出来:act 用 ref 就够了(ref 自带对话),
    // 但要对这个 iframe 直接 eval 就得拿到它
    if (sessionId) lines.push(`--- iframe sessionId=${sessionId} ${session.url || ""} ---`);

    for (const node of tree.nodes || []) {
      if (lines.length >= maxNodes) break;
      if (node.ignored) continue;
      const role = textOf(node, "role") || node.role?.value || "";
      const name = textOf(node, "name");
      const actionable = ACTIONABLE.has(role);
      if (!actionable && !(INFORMATIVE.has(role) && name)) continue;
      // 没名字也没值的可交互元素给不了模型任何线索,跳过;textbox 例外(空输入框本来就没值)
      if (actionable && !name && !textOf(node, "value") && role !== "textbox") continue;
      if (!node.backendDOMNodeId) continue;

      const ref = `n${version}-${refs.size + 1}`;
      refs.set(ref, { backendNodeId: node.backendDOMNodeId, sessionId: sessionId || null });
      lines.push(lineFor(node, ref));
    }
  }

  state.snapshot = { version, refs };
  return {
    pageVersion: version,
    url: target.getURL(),
    title: target.getTitle(),
    lines,
    truncated: lines.length >= maxNodes,
  };
};

/** act 用:把 ref 还原成一个可下命令的节点。版本对不上就明确要求重读。 */
export const resolveRef = (target, ref, pageVersion) => {
  const snapshot = stateOf(target).snapshot;
  if (!snapshot) throw new Error("还没有快照 —— 先用 action=snapshot 读一次页面");
  if (pageVersion != null && Number(pageVersion) !== snapshot.version) {
    throw new Error(`快照过期(你拿的是 ${pageVersion},现在是 ${snapshot.version})—— 重新 snapshot 一次再操作`);
  }
  const node = snapshot.refs.get(String(ref));
  if (!node) throw new Error(`快照里没有 ${ref} —— 重新 snapshot 一次看看它还在不在`);
  return node;
};
