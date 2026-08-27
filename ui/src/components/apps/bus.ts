// 应用实例总线:同一应用的多个挂载实例(侧栏面板 + 标签页)之间,事件经宿主转发;
// 也承载 route 推送(tabs.openApp 聚焦已开标签时,把新 route 送给标签页实例)。
// 数据真身永远在宿主侧(storage/db),事件只是「去重读一下」的招呼 —— 不搬数据。

export type AppBusMessage =
  | { type: "event"; event: string; payload: unknown }
  | { type: "route"; route: string };

type Listener = (msg: AppBusMessage) => void;

const listeners = new Map<string, Set<Listener>>();

export const subscribeApp = (appId: string, fn: Listener) => {
  let set = listeners.get(appId);
  if (!set) { set = new Set(); listeners.set(appId, set); }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) listeners.delete(appId);
  };
};

/** 广播事件给该应用的其他实例(except = 发起者自己,不回声)。 */
export const broadcastAppEvent = (appId: string, event: string, payload: unknown, except?: Listener) => {
  for (const fn of listeners.get(appId) || []) {
    if (fn !== except) fn({ type: "event", event, payload });
  }
};

/** 把 route 推给该应用的所有实例(标签页实例据此切视图)。 */
export const pushAppRoute = (appId: string, route: string) => {
  for (const fn of listeners.get(appId) || []) fn({ type: "route", route });
};
