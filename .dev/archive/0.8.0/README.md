# 0.8.0 — 应用即网站:workerd 成为应用的全栈

## 这一版回答的问题

0.7.0 上了 workerd,但九成应用用不到后端 —— 那 175MB 岂不是白付?
答案不是砍掉它,而是**让它成为每个应用的全栈**:应用不再是"前端 + 可选后端",
而是**一个完整的 Cloudflare Worker 网站**,静态资源与 API 都由它自己应答。
workerd 使用率从 10% 变成 100%。

## 定案(讨论结论,详见 APP.md)

1. **应用 = Worker 网站**:`server.js` 的 fetch handler 处理一切;iframe 直接指向
   `http://127.0.0.1:<workerdPort>/app/<token>/`,前端与自己的后端同源,`fetch("/api/…")` 即可;
2. **资源即 binding**(与 CF 平台同构):`env.DB`(D1 接口)/ `env.ASSETS` / `env.HOST`。
   **API 对齐 D1 意味着应用代码能原样部署到 Cloudflare** —— 本地开发、云端跑 7×24 的路打通;
3. **数据落工作区**:`apps/<id>/data.db`,和代码做邻居。不用 workerd 的 DO 存储,因为它按
   DO id 哈希命名文件,AI 和用户都摸不到 —— 而"AI 能管自己造的应用"是硬需求;
4. **预装应用落地**:随包的三个应用首次启动复制进工作区,之后与用户自己造的应用无差别,可改可删;
5. **隔离不降级**:iframe 仍是 `sandbox="allow-scripts"` 不透明源(所有应用同端口,给真 origin
   就会互读 localStorage);每应用一个访问 token。

## 落地

- `runtime/overseer`:路由 `/app/<token>/*` → 应用自己的 fetch handler;注入 D1/ASSETS 垫片与入口包装;`/_wb/sdk.js` 转发
- `service/apps.ts`:应用扫描、token、静态资源读取、数据库定位、预装落地
- `service/appdb.ts`:库落应用目录,新增 D1 `batch`(事务)
- UI:AppFrame 指向应用网站(异步取 URL),SDK 瘦身为「宿主 UI 能力」,`workbench.gadget`/`storage`/`db` 退役
- 三个预装应用按新形制重写:网站(双挂载)、任务(最小完整应用)、笔记(演示后端调 AI)

## 实测

注册表下发、应用网站首页/静态资源/D1 读写、SDK 路由、错 token 403、
预装落地、`sqlite3 apps/todo/data.db` 直接可查 —— 全通过。

## 已知边界

旁路推送与 alarms 仍需 Durable Object(见 APP.md);Windows/Linux 需各带一份 workerd 二进制。
