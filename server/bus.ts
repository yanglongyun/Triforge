// 极简事件总线:运行循环 emit,realtime 设置 broadcaster 把事件推给 WS 客户端。
// 避免 runs <-> realtime 循环依赖。
type Broadcaster = (payload: unknown) => void;
let broadcaster: Broadcaster = () => {};

const setBroadcaster = (fn: Broadcaster) => {
  broadcaster = typeof fn === "function" ? fn : () => {};
};

const emit = (payload: unknown) => {
  try {
    broadcaster(payload);
  } catch {
    // 广播失败不应影响运行
  }
};

export { setBroadcaster, emit };
