// 钉在活动栏上的组件 id。
//
// 两个界面同时要读写它:侧栏的活动栏(PanelHost)与组件管理页(标签页)。
// 所以它不属于任何一个组件的 state —— 放这里当唯一事实源,改动经 window 事件广播,
// 谁在看谁就跟着变(在管理页取下,侧栏的标签立刻消失,反之亦然)。
import { useEffect, useState } from "react";

const KEY = "workbench.widgets.pinned";
const EVENT = "workbench:widget-pins-changed";

export const readPins = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const value = raw == null ? null : JSON.parse(raw);
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch { return []; }
};

const writePins = (ids: string[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* 隐私模式:本次会话内仍然生效 */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { ids } }));
};

/** 钉上/取下,返回操作后的完整列表。 */
export const togglePin = (id: string): string[] => {
  const current = readPins();
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  writePins(next);
  return next;
};

/** 组件被删掉时清掉它的钉。 */
export const dropPin = (id: string) => {
  const current = readPins();
  if (current.includes(id)) writePins(current.filter((x) => x !== id));
};

/** 订阅式读取:任何一处改动,所有在看的界面同步更新。 */
export const useWidgetPins = (): string[] => {
  const [pins, setPins] = useState<string[]>(readPins);
  useEffect(() => {
    const sync = () => setPins(readPins());
    window.addEventListener(EVENT, sync);
    // 另一个窗口改的也要跟上(storage 事件只在跨窗口时触发)
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return pins;
};

/** 「让 AI 造一个组件」:动作住在 PanelHost(要开对话、发提示词),
 *  管理页只管喊一声 —— 与 workbench:reveal-path 同一套路。 */
export const CREATE_WIDGET_EVENT = "workbench:create-widget";
export const requestCreateWidget = () => window.dispatchEvent(new Event(CREATE_WIDGET_EVENT));
