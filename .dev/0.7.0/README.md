# 0.7.0 — 应用后端:workerd 进舱

「AI 写的后端」的唯一专业解:嵌入 Cloudflare Workers 开源运行时(workerd),
isolate 级隔离 + 物理断网 + 能力 binding,与 Cloudflare OS 的 Gadget 同方言。

## 架构

Node 侧车 ──spawn──▶ workerd(runtime/overseer-src.mjs 编译产物,~100 行监理 worker)
  - 动态装载 apps/<id>/server.js(workerLoader,--experimental;globalOutbound: null)
  - env.HOST = ctx.exports.HostGate({props:{appId, caps}}) 回环能力网关 → 经 NODE 外部服务绑定回 Node 执行
  - /g/<secret>/<appId> WS → Cap'n Web 会话,把 Gadget entrypoint 门面桩交给宿主
UI:HostApi.gadget() 把 workerd 会话桩跨会话代理给应用 → workbench.gadget.<方法>()

## POC 实证(.dev/0.7.0-poc/,全部通过)

workerLoader 动态装载 / globalOutbound 断网 / ctx.exports 回环 props / isolate 状态保持 /
capnweb 门面代理(原生桩需 CF OS 同款 Proxy 手法)/ secret 拦截 / db 持久化跨会话 / 日志回流。
已知缺口:capnweb 回调经原生 RPC 转发不达(服务端→客户端推送 v1 缺席,如实记入 APP.md)。

## 取舍

- 存储走 HOST→Node appdb(一应用一 SQLite),暂不用 DO/facets —— 少一层未知,语义已够;
- workerd 随 Workbench 启动而启动(常驻但空载零负担),应用 worker 全按需;
- 二进制 136MB 进 extraResources,dmg 体积显著增大 —— 为"AI 可安全写后端"付的地价。
