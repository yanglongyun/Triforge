import { newWebSocketRpcSession, RpcTarget } from "capnweb";
const g = newWebSocketRpcSession("ws://127.0.0.1:8788/gadget");
console.log("hello:", await g.hello("node-client"));
console.log("inc:", await g.increment(), await g.increment());
class Cb extends RpcTarget { tick(n) { console.log("tick←server推送:", n); } }
console.log(await g.subscribeTick(new Cb()));
await new Promise(r => setTimeout(r, 600));
process.exit(0);
