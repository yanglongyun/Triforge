# 0.9.0 — 收敛为组件:砍掉 workerd 应用机制,活动栏三原生换回 会话/文件/网站

## 这一版回答的问题

0.6.0 → 0.8.0 用三个版本把「AI 造应用」推到了完整形态:应用 = 一个标准 Cloudflare
Worker 网站,跑在嵌入的 workerd 里。技术上跑通了,**但它对这个产品来说太重了**。

真正让这条线站不住的是一个观察:**拔掉 workerd 并不影响用户建立复杂的应用。**
AI 本来就能在工作目录里建一个完整项目、`bash background` 跑起来;而 Workbench
本身就是浏览器 —— 网址存进「网站」面板,下次一点就开。体验与「内置应用」没有差别,
但少了 136MB 运行时、少了一整套 manifest / token / binding 契约、
少了一整类只在我们这儿存在的 bug(见 0.8.0 的 origin 事故)。

于是分工变成:
- **复杂应用** → 走通用路径(AI 建项目 + bash 跑 + 网站面板存地址),不需要产品特设机制;
- **不值得单独起一个进程的小东西**(打卡 / 计数 / 速记)→ **组件**,这是本版新增的形态。

workerd 那条线的完整技术沉淀移交下一个产品,归档在 `.dev/archive/`(0.6.0 ~ 0.8.0)
与 `workerd-应用路线-技术沉淀.md`。

## 定案(详见 WIDGET.md,唯一正典)

1. **组件 = 一个目录**:`<家>/widgets/<id>/`,`widget.json` + `index.html` 必需,
   其余随便几个 js/css。写出目录即安装,删除 → 回收站(`.trash/`,保留 30 天);
2. **零构建**:ESM + 原生 CSS,浏览器直接吃。**禁止任何构建步骤** ——
   一旦允许,「目录即安装」就不成立(目录里的东西不再是运行的东西,AI 改完还得跑构建);
3. **每组件一个 loopback 端口 = 一个真 origin**:绝对路径与相对路径都对。
   路径前缀方案会让 `/style.css` 解析到 origin 根然后 404 —— 这个坑刚在 0.8.0 踩过,
   不再踩第二次。副产品:不同端口 = 不同 origin,localStorage 天然隔离,不用 sandbox 兜;
4. **宿主 API = 同源 HTTP `/_wb/*`,没有 SDK**。做成 HTTP 端点而不是「前端能调的宿主对象」,
   是为了与挂载方式正交 —— 0.8.0 的 postMessage 桥换个挂载方式就当场失效;
5. **一组件一个 SQLite**,落在组件目录里。物理隔离让「AI 随便写 SQL」安全
   (不需要解析 SQL 判断它碰了哪张表,那条路永远有绕过);
6. **CSP `connect-src 'self'`** = 轻量版的物理断网,对应 workerd 的 `globalOutbound: null`;
7. **活动栏三原生 = 会话 / 文件 / 网站**。网站回归原生(它的后端一直完整活着,只是补了面板 UI);
   组件默认不占位,用户钉上去才出现 —— 装了 ≠ 常用。

## 落地

- `service/widgets.ts` 注册表(扫描 / 家目录 / 回收站 / 预装落地)
- `service/widgetsite.ts` 每组件一个端口(静态文件 + `/_wb/*` + CSP + 主题变量注入)
- `service/widgetdb.ts` 一组件一库(WAL / 拦 ATTACH / 50MB / batch 事务 / 5000 行封顶)
- `api/widget.ts` 注册表、地址、卸载、活动流水
- UI:`SitesPanel`(原生网站)、`WidgetsPanel`(管理 + 让 AI 造一个)、`WidgetFrame`
- 预装三个组件:待办 / 计数器 / 速记(速记演示 `ai` 权限),同时是给 AI 抄的样板
- system prompt 换成组件契约 —— **机制与「AI 知道机制」是两件独立的工程**

## 砍掉的

`runtime/`(workerd + overseer)、`gadgets.ts`、`service/app*.ts`、`api/app.ts`、
AppFrame、应用标签页、SDK 构建、`workerd`/`capnweb` 依赖、`APP.md`。
后续两次清理还删了:0.5.x 面板体系遗物(`service/panels.ts` / `panel_kv` / `/api/panel/storage`)、
`PANEL.md`,以及**预览机制**(ProcessPanel / process 标签 / `/api/processes`)——
产品本身就是浏览器,dev server 的地址在 bash 返回里,开个网页标签即可,
再单独做一层预览是多余的中间物。

包体 **565MB → 407MB**。

## 实测

服务端:注册表、三组件 index/css/js、SQL 建表写读、batch 事务、跨组件隔离
(counter 查 todo 的表 → `no such table`)、未声明权限被拒、ATTACH 被拒、
`data.db` 不当静态文件发、路径穿越 404、预装落地、打包版全通。

**浏览器级**(WIDGET.md 第 10 节要求,用无头 Chrome 跑):待办组件渲染出
「未完 1 · 共 1」→ ESM 加载 + 同源 fetch + DOM 渲染全通;临时组件 `fetch("https://example.com")`
→ **外网被拦(TypeError)**,CSP 真的生效。

## 已知边界 / 开放问题

- `ui` 权限(toast / confirm)与 `fs` 权限**尚未实现**;
- **宿主 API 对外访问**未做:组件的 `/_wb/*` 不带凭据是因为「端口即身份」,
  外部应用不成立(它是用户自己跑的进程),必须显式发 token + 开 CORS。
  待定:开哪些能力(倾向 sql/ai/agent,**不开 fs**)、外部应用的库落在哪
  (倾向按 token 给独立库)、token 粒度(倾向一应用一个 + 能力勾选);
- 组件间通信没有设计。真要做应经宿主,不能让组件互相发现。
