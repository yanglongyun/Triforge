// 全局拖拽护栏。
//
// <webview> 与 iframe 是独立的事件世界:指针移到它们上方,宿主页面就收不到
// pointermove/pointerup —— 在网页上方松手,宿主以为你还按着,拖拽会话永不结束,
// 鼠标回到宿主区域继续跟手,表现为「松手了还一卡一卡地动」。
//
// 解法:任何拖拽会话开始时给 body 挂类,CSS 让 webview/iframe 对指针失明
// (pointer-events:none),事件全部回到宿主;会话结束摘类。计数支持嵌套/并发会话。
const CLASS = "wt-dragging";
let depth = 0;

export const beginGlobalDrag = () => {
  depth += 1;
  if (depth === 1) document.body.classList.add(CLASS);
};

export const endGlobalDrag = () => {
  depth = Math.max(0, depth - 1);
  if (depth === 0) document.body.classList.remove(CLASS);
};
