// 虚拟光标的主进程侧:发指令、等到达、门控要不要演。
//
// 时序是这套东西的全部意义:**光标真到了,才发真实的 CDP 点击**。
// 动画不是事后表演,是动作序列里的一环 —— 否则你看到的是「先点了,光标才慢慢飘过去」。
//
// 两条铁律:
//   · **有人看才演**:窗口可见且聚焦才走动画,否则瞬移 —— 后台任务零减速,
//     代价只在被观看时花。
//   · **动画永不阻塞正确性**:到达回执 800ms 兜底 —— 页面把覆盖层搞坏(CSP、异常)
//     时动作照常执行。动画层挂了等于退回从前,不是功能故障。
import { BrowserWindow, ipcMain } from "electron";

const ARRIVAL_TIMEOUT_MS = 800;

let seq = 0;
const waiters = new Map(); // seq → resolve

export const bindCursor = () => {
  ipcMain.on("worktop:cursor-arrived", (_event, arrivedSeq) => {
    const resolve = waiters.get(arrivedSeq);
    if (resolve) { waiters.delete(arrivedSeq); resolve(); }
  });
};

const watched = () => {
  const win = BrowserWindow.getAllWindows()[0];
  return Boolean(win && win.isVisible() && win.isFocused());
};

/** 让光标去到 (x, y)。演的话等它到(封顶 800ms);不演立刻返回。 */
export const escortCursor = (target, x, y) => {
  const animate = watched();
  const mySeq = (seq += 1);
  try {
    target.send("worktop:cursor", { x, y, seq: mySeq, animate });
  } catch {
    return Promise.resolve(); // 页面没了,别把动作卡住
  }
  if (!animate) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.set(mySeq, resolve);
    setTimeout(() => { if (waiters.delete(mySeq)) resolve(); }, ARRIVAL_TIMEOUT_MS).unref?.();
  });
};

/** 落点涟漪:真实动作发生**之后**画。「点了哪里」要看得见,哪怕光标是瞬移过去的。 */
export const pulseCursor = (target, x, y) => {
  try { target.send("worktop:cursor-pulse", { x, y }); } catch { /* 页面没了就算了 */ }
};
