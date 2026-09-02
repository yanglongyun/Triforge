// CDP 接入。
//
// Chromium 的原生控制协议(Puppeteer 本质上是它的薄封装)。走 `webContents.debugger`
// 是**进程内直连** —— 不开端口、不走 socket。
//
// 它给的、webview 自带 API 给不了的关键几样:
//   · 隔离世界执行 JS —— 页面 hook 不到也篡改不了我们的脚本
//   · 完整无障碍树 —— Chromium 自己算好的 role/name,不用爬 DOM 猜
//   · 跨源 iframe(OOPIF)—— 靠 Target 自动附加 + sessionId
//   · **真实输入** —— Input 域派发的事件 isTrusted=true,和用户自己动手无区别
//
// 一个已知代价:附加调试器后用户打不开该页的开发者工具(反之亦然),Chromium 的限制。
import { webContents } from "electron";

const attached = new Map(); // webContentsId → { sessions, isolated, snapshot }

/** 按 webContents id 拿到目标。标签可能已经关了,拿不到就是拿不到。 */
export const targetOf = (wcId) => {
  const target = webContents.fromId(Number(wcId));
  if (!target || target.isDestroyed()) throw new Error("这个标签已经不在了");
  return target;
};

/** OOPIF:子对话由 Target 自动附加送上来,记下来才能对跨源 iframe 下命令。 */
const trackSessions = (target, state) => {
  target.debugger.on("message", (_event, method, params, sessionId) => {
    if (method === "Target.attachedToTarget") {
      state.sessions.set(params.sessionId, {
        targetId: params.targetInfo?.targetId,
        type: params.targetInfo?.type,
        url: params.targetInfo?.url,
      });
    } else if (method === "Target.detachedFromTarget") {
      state.sessions.delete(params.sessionId);
    } else if (method === "Page.frameNavigated" || method === "Page.loadEventFired") {
      // 页面换了:之前建的隔离世界和快照 ref 全部作废
      state.isolated.clear();
      state.snapshot = null;
    }
    if (sessionId && !state.sessions.has(sessionId)) state.sessions.set(sessionId, { type: "unknown" });
  });
};

/** 懒附加:第一次用到才 attach,附加过就复用。 */
const ensureAttached = (target) => {
  const known = attached.get(target.id);
  if (known) return known;

  try {
    target.debugger.attach("1.3");
  } catch (error) {
    const message = String(error?.message || error);
    // 最常见的一种:用户自己开着这个页的开发者工具
    if (/already attached/i.test(message)) throw new Error("这个标签的调试器已被占用(开发者工具开着?先关掉)");
    throw error;
  }

  const state = { sessions: new Map(), isolated: new Map(), snapshot: null };
  attached.set(target.id, state);
  trackSessions(target, state);
  target.once("destroyed", () => attached.delete(target.id));
  target.debugger.on("detach", () => attached.delete(target.id));

  // 跨源 iframe 自动进来;flatten 让子对话共用这一条连接(用 sessionId 区分)
  void target.debugger.sendCommand("Target.setAutoAttach", {
    autoAttach: true, waitForDebuggerOnStart: false, flatten: true,
  }).catch(() => {});
  void target.debugger.sendCommand("Page.enable").catch(() => {});

  return state;
};

export const stateOf = (target) => attached.get(target.id) || ensureAttached(target);

/** 发一条 CDP 命令。给了 sessionId 就发给那个子目标(跨源 iframe)。 */
export const send = async (target, method, params = {}, sessionId = undefined) => {
  ensureAttached(target);
  return target.debugger.sendCommand(String(method), params || {}, sessionId || undefined);
};

/** 当前页面 + 所有子目标的对话清单。跨 iframe 操作要先知道有哪些对话。 */
export const sessionsOf = (target) => {
  const state = stateOf(target);
  return [
    { sessionId: null, type: "page", url: target.getURL() },
    ...[...state.sessions.entries()]
      .filter(([, info]) => info.type === "iframe" || info.type === "page")
      .map(([sessionId, info]) => ({ sessionId, ...info })),
  ];
};

/**
 * 在**隔离世界**里执行表达式并取回结果。
 *
 * 和 executeJavaScript 的区别是决定性的:那个跑在页面主世界里,页面可以 hook 掉
 * querySelector、改原型,骗了我们也看不出来;这里的脚本页面根本看不见。
 */
export const evaluate = async (target, expression, { sessionId = null, world = true } = {}) => {
  const state = ensureAttached(target);
  let contextId;

  if (world) {
    const frameKey = sessionId || "main";
    if (!state.isolated.has(frameKey)) {
      const tree = await send(target, "Page.getFrameTree", {}, sessionId);
      const created = await send(target, "Page.createIsolatedWorld", {
        frameId: tree.frameTree.frame.id,
        worldName: "worktop",
        grantUniveralAccess: true,
      }, sessionId);
      state.isolated.set(frameKey, created.executionContextId);
    }
    contextId = state.isolated.get(frameKey);
  }

  const result = await send(target, "Runtime.evaluate", {
    expression: String(expression),
    contextId,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, sessionId);

  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text || "页面里的 JS 抛错了";
    throw new Error(String(text).slice(0, 2000));
  }
  return result.result?.value;
};
