// 原子操作:点、填、选、按键、滚动、悬停。
//
// 关键在于**真实输入**:走 CDP 的 Input 域派发,事件 isTrusted=true,和用户自己
// 动手没有区别。从前靠页面里 el.click() 派发的是假事件 —— 文件选择、拖放、部分
// 框架的手势判定都不认。这是「能操作」和「操作得了」的分界线。
//
// 一次只做一个动作,做完报页面有没有变。协议简单,好调试也好重试。
import { send } from "./cdp.js";
import { resolveRef } from "./snapshot.js";
import { escortCursor, pulseCursor } from "./cursor.js";

/** 在这个节点上跑一段函数。比按坐标操作精确,用于设值这类没有「点哪儿」的动作。 */
const callOnNode = async (target, node, functionDeclaration, args = []) => {
  const sessionId = node.sessionId || undefined;
  const { object } = await send(target, "DOM.resolveNode", { backendNodeId: node.backendNodeId }, sessionId);
  if (!object?.objectId) throw new Error("拿不到这个元素的句柄");
  const result = await send(target, "Runtime.callFunctionOn", {
    objectId: object.objectId,
    functionDeclaration,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
    awaitPromise: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(String(result.exceptionDetails.exception?.description || "操作失败").slice(0, 500));
  }
  return result.result?.value;
};

/** 节点在视口里的中心点。顺带滚进视野 —— 不在视野里的坐标点了也没用。 */
const centerOf = async (target, node) => {
  const { backendNodeId, sessionId } = node;
  await send(target, "DOM.scrollIntoViewIfNeeded", { backendNodeId }, sessionId || undefined).catch(() => {});
  const box = await send(target, "DOM.getBoxModel", { backendNodeId }, sessionId || undefined);
  const quad = box?.model?.border;
  if (!quad || quad.length < 8) throw new Error("这个元素没有可见的位置(可能被隐藏了)");
  const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
  const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("算不出这个元素的位置");
  return { x, y, sessionId: sessionId || undefined };
};

const mouse = (target, type, x, y, { button = "left", clickCount = 1, sessionId } = {}) =>
  send(target, "Input.dispatchMouseEvent", {
    type, x, y, button, clickCount, buttons: type === "mouseReleased" ? 0 : 1,
  }, sessionId);

const clickAt = async (target, x, y, sessionId, { button = "left", clickCount = 1 } = {}) => {
  await mouse(target, "mouseMoved", x, y, { button: "none", clickCount: 0, sessionId });
  await mouse(target, "mousePressed", x, y, { button, clickCount, sessionId });
  await mouse(target, "mouseReleased", x, y, { button, clickCount, sessionId });
};

/** 键名 → CDP 要的那几个字段。只覆盖操作页面真正用得上的键。 */
const KEYS = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", keyCode: 9, text: "\t" },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
};

const pressKey = async (target, name, sessionId) => {
  const spec = KEYS[name];
  if (!spec) throw new Error(`不认识的键:${name}(支持:${Object.keys(KEYS).join(" / ")})`);
  await send(target, "Input.dispatchKeyEvent", { type: "keyDown", ...spec }, sessionId);
  if (spec.text) await send(target, "Input.dispatchKeyEvent", { type: "char", ...spec }, sessionId);
  await send(target, "Input.dispatchKeyEvent", { type: "keyUp", ...spec }, sessionId);
};

/** 执行一个动作。input: { action, ref, pageVersion, value, x, y, key, deltaY, button } */
export const act = async (target, input = {}) => {
  const action = String(input.action || "");
  const before = target.getURL();

  // 按坐标操作是**兜底**:结构化定位不到时才用(比如 canvas 里的东西)
  const byPoint = input.ref == null && Number.isFinite(Number(input.x)) && Number.isFinite(Number(input.y));
  const node = byPoint ? null : resolveRef(target, input.ref, input.pageVersion);
  const point = byPoint
    ? { x: Number(input.x), y: Number(input.y), sessionId: undefined }
    : await centerOf(target, node);

  // 虚拟光标先行,**到了才动手**(没人看就瞬移,零等待)。
  // 顺序不能换:centerOf 已经把目标滚进视野,坐标是滚动之后的新值。
  // scroll 不配光标(跟着滚动飞没有意义),press 没有落点。
  if (["click", "doubleClick", "fill", "select", "hover"].includes(action)) {
    await escortCursor(target, point.x, point.y);
  }

  switch (action) {
    case "click":
      await clickAt(target, point.x, point.y, point.sessionId, { button: input.button || "left" });
      break;

    case "doubleClick":
      await clickAt(target, point.x, point.y, point.sessionId, { clickCount: 2 });
      break;

    case "hover":
      await mouse(target, "mouseMoved", point.x, point.y, { button: "none", clickCount: 0, sessionId: point.sessionId });
      break;

    case "fill": {
      // **少给 value 必须当场报错**,不能当成空串照常执行:那会清空输入框、返回成功,
      // 而调用方以为填进去了,下一步点发送就发出一条空的。真要清空显式给 value: ""。
      if (input.value == null) throw new Error('fill 要 value(要填什么)。清空请显式写 value: ""');
      // 先点进去拿焦点,再全选清空,再逐字送 —— 逐字送才会触发 input/change,
      // 直接改 value 有些框架根本不认
      await clickAt(target, point.x, point.y, point.sessionId);
      if (node) {
        await send(target, "DOM.focus", { backendNodeId: node.backendNodeId }, node.sessionId || undefined).catch(() => {});
      }
      for (const type of ["keyDown", "keyUp"]) {
        await send(target, "Input.dispatchKeyEvent", {
          type, key: "a", code: "KeyA", keyCode: 65, modifiers: 4, // Cmd+A 全选
        }, point.sessionId);
      }
      await send(target, "Input.insertText", { text: String(input.value ?? "") }, point.sessionId);
      break;
    }

    case "select": {
      // 下拉框没有「点哪儿」可言:直接在节点上设值再派发事件。
      // 按 value 找不到就按可见文字找 —— 模型看到的是快照里的文字,不是 value
      if (!node) throw new Error("select 需要 ref(要知道是哪个下拉框)");
      const picked = await callOnNode(target, node, `function (wanted) {
        if (this.tagName !== 'SELECT') {
          this.value = wanted;
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
          return wanted;
        }
        const options = [...this.options];
        const hit = options.find((o) => o.value === wanted)
          || options.find((o) => (o.label || o.text || '').trim() === wanted)
          || options.find((o) => (o.label || o.text || '').includes(wanted));
        if (!hit) return null;
        this.value = hit.value;
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return hit.label || hit.text || hit.value;
      }`, [String(input.value ?? "")]);
      if (picked == null) throw new Error(`下拉框里没有「${input.value}」这一项`);
      break;
    }

    case "press":
      await pressKey(target, String(input.key || "Enter"), point.sessionId);
      break;

    case "scroll":
      await send(target, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: point.x, y: point.y,
        deltaX: Number(input.deltaX) || 0,
        deltaY: Number(input.deltaY) || 400,
      }, point.sessionId);
      break;

    default:
      throw new Error(`不认识的动作:${action}(支持:click / doubleClick / hover / fill / select / press / scroll)`);
  }

  // 落点涟漪:真实动作已经发生,「点了哪里」要看得见
  if (["click", "doubleClick", "fill"].includes(action)) pulseCursor(target, point.x, point.y);

  // 给页面一点反应时间再报状态 —— 模型据此决定要不要重新 snapshot
  await new Promise((resolve) => { setTimeout(resolve, 120); });
  const after = target.getURL();
  return {
    ok: true,
    navigated: after !== before,
    url: after,
    note: after !== before ? "地址变了,快照已作废,重新 snapshot" : undefined,
  };
};
