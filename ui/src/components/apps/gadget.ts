// 应用后端(gadget)会话管理:每应用一条到 workerd 的 Cap'n Web WebSocket 会话。
// 懒建(首次调用才连,后端 worker 也在那一刻才被 overseer 按需装载)、断了自愈(下次调用重连)。
// 地址与 secret 由 Node 侧车下发(同源 GET,外源页面读不到;secret 防本机其他页面乱连 workerd 端口)。
import { newWebSocketRpcSession } from "capnweb";
import { api } from "../../api";

const sessions = new Map<string, any>();
let endpointPromise: Promise<{ port: number; secret: string } | null> | null = null;
const endpoint = () => (endpointPromise ??= api.gadgetEndpoint().catch(() => null));

export const getGadgetStub = async (appId: string): Promise<any> => {
  const cached = sessions.get(appId);
  if (cached) return cached;
  const ep = await endpoint();
  if (!ep) throw new Error("应用后端运行时不可用(workerd 未启动)");
  const stub: any = newWebSocketRpcSession(`ws://127.0.0.1:${ep.port}/g/${ep.secret}/${appId}`);
  try { stub.onRpcBroken?.(() => sessions.delete(appId)); } catch { /* 可选 API */ }
  sessions.set(appId, stub);
  return stub;
};
