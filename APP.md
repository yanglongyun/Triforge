# Workbench 应用契约(v1,0.6.x)

活动栏三原生 = 产品的三个名词:**会话**(AI)、**文件**(资产)、**应用**(软件形态),焊死不可移除。
其余一切都是应用:预装的(网站/任务,可移除)、工作区里的、将来大多由 AI 生成的。
本文件是唯一正典:manifest 词汇表 = 能力清单 = SDK 文档,一份三用。

## 应用 = 工作区里的一个目录

```
<workspace>/apps/<id>/
  app.json      ← manifest
  index.html    ← 入口(iframe 沙箱,自包含)
  panel.html    ← 可选:侧栏挂载的紧凑视图
```

「安装」= 目录存在(server 扫描自动注册);「移除」= 删目录。AI 用 write 工具即可造应用。
预装应用随包发(`ui/public/apps/<id>/`),形制完全相同。

```json
{ "id": "notebook", "name": "笔记本", "icon": "📔",
  "mounts": { "tab": "index.html", "panel": "panel.html" },
  "capabilities": ["db", "ai"] }
```

- `id`:`[a-z0-9-]`,全局唯一;`icon`:emoji。
- `mounts`:`tab`(标签页,常驻挂载切换不重载)/ `panel`(侧栏,可钉到活动栏),至少一个。
  同一应用的两个挂载是**两个实例**:不共享内存,共享宿主侧数据 + 实例总线。

## 基础 SDK(`/apps/workbench-sdk.js`,免声明)

| API | 说明 |
|---|---|
| `await workbench.ready()` → `{appId, mount, route}` | 握手 + 实例上下文 |
| `workbench.context()` | 同上,随 route 推送更新 |
| `workbench.on(event, fn)` / `emit(event, payload)` | 同应用实例间事件(宿主转发,不回声);内置事件 `"route"` |
| `workbench.ui.toast(msg)` / `dialog.confirm(msg, {danger?, confirmText?})` | 宿主统一样式的提示/确认 |

## 能力清单(manifest `capabilities` 声明,未声明的调用被桥拒绝)

| 能力 | API | 说明 |
|---|---|---|
| `storage` | `storage.get()` / `set(v)` | KV 小状态(一应用一格) |
| `db` | `db.exec(sql, params?)` | **应用私有 SQLite**(一应用一库文件),自由建表增删改查;SELECT 返回 `{rows}`,写返回 `{changes, lastInsertRowid}`;无参多语句(建表脚本)整体执行。拦 `ATTACH`/`load_extension`,单库 50MB | 
| `tabs` | `tabs.open({url, title?})` / `tabs.openApp({route?})` | 开网页标签(宿主同站去重)/ 打开自己的标签页(已开则聚焦 + 推送 route) |
| `ai` | `ai.complete({summary, prompt, system?})` → `{text, tokens}` | **无状态**单次补全:不建智能体、不进邮箱;`summary` 必填,每次调用落一条**活动**(问责);每应用并发 2 |
| `agent` | `agent.run({summary, message, workdir?})` → `{agentId, text}` | 派活给真智能体(六工具、多轮):执行体是 **hidden 智能体**,会话面板不显示,活动流水可见、可点开审查全过程 |
| `fs:workspace` | `fs.read/write/list({path, content?})` | 工作区内受限文件读写;路径相对第一个工作区根(或绝对但必须在工作区内);**首次使用弹用户授权**;read≤2MB,write≤5MB |
| `system` | `system.openExternal(url)` / `copyText(text)` | 系统浏览器、剪贴板 |

## 数据产权(原语 vs 领域)

- **领域数据归应用**(书签、笔记、日程……):在自己的 storage/db 里自建 schema。宿主不提供任何域 API,不知道"书签"是什么 —— 这是 AI 能无限造应用的前提。
- **产品本体数据归宿主**(会话/文件树/标签页/智能体):只经能力网关按需开缝。
- **真实文件归用户**:`fs:workspace`,授权制。

## 安全模型

1. `sandbox="allow-scripts"`(无 same-origin):应用是**不透明源**,摸不到宿主 DOM/localStorage;
2. Origin 门卫拒绝字面 `"null"` 源的写请求:应用**不能直连本地端口**,宿主桥是唯一通道,也是能力网关与问责落点;
3. 敏感能力分级:`fs:workspace` 首次使用弹授权;`ai`/`agent` 靠活动流水全程可见 + `summary` 必填;
4. 桥只认 `e.source === iframe.contentWindow`。

## 线协议(0.6.1 起:Cap'n Web,宿主端 `components/apps/AppFrame.tsx`)

应用与宿主之间是一条 **Cap'n Web RPC 会话**(双向对象能力协议,跑在 MessageChannel 上):

- 握手:SDK 加载即 `new MessageChannel()`,把 port `postMessage` 给宿主;宿主校验
  `source === iframe.contentWindow && origin === "null"` 后在 port 上起会话;
- 宿主暴露 `HostApi`(每个方法自带能力网关),应用暴露 `ClientMain`(init/theme/route/appEvent);
  主题、路由、实例事件都是对桩的真调用,没有手刻报文;
- **函数可按引用传递**:回调/订阅是语言级能力 —— 这也是将来 workerd 后端应用
  (`workbench.gadget` 桩直通应用的 Durable Object)的同一条铁轨;
- SDK 源码在 `ui/sdk-src/workbench-sdk.mjs`,`npm run build:sdk` 打包(捆入 capnweb)到
  `ui/public/apps/workbench-sdk.js`;应用面向的 `workbench.*` 表面与 0.6.0 完全一致;
- 主题变量(`--color-*`)注入应用 `<html>` 并随明暗实时更新,应用 CSS 直接用 token(给浅色兜底值)。

## 应用后端(server,0.7.0)

应用可以有**真后端**:manifest 加 `"server": "server.js"`,该文件跑在随包的 **workerd**
(Cloudflare Workers 开源运行时)里 —— isolate 级隔离,毫秒级冷启动,按需装载,闲时零成本。

```js
// apps/<id>/server.js —— 与 Cloudflare OS 的 Gadget 同方言
import { WorkerEntrypoint } from "cloudflare:workers";
export class Gadget extends WorkerEntrypoint {
  async add(text) {
    return this.env.HOST.dbExec("INSERT INTO notes (t) VALUES (?)", [text]);
  }
}
```

前端经 `workbench.gadget.<方法>(…)` 直连(Cap'n Web 跨会话代理;懒连接,首调才装载)。

安全与运行模型:
- **物理断网**:`globalOutbound: null`,后端代码连 fetch 都没有;env 里只有 `HOST` 一个回环网关;
- `HOST.dbExec(sql, params)`(需 db 能力,与前端 `workbench.db` 同一张应用私有库)、`HOST.log(…)`(回流 Node 控制台,AI 调试用);
- **全按需**:首次调用才装载 worker,代码内容哈希做版本键 —— 改了 server.js 下次连接即新版;
- **内存只当缓存**:isolate 随时可能重启,真状态必须经 HOST 落库;
- workerd 端口凭每次启动随机生成的 secret 访问(`/g/<secret>/<appId>`),本机其他页面连不上;
- **服务端→客户端:回调随调用下传**(实测可用,穿透 capnweb + 原生 RPC 两跳)。
  前端把函数当参数传进去,后端边干边调它 —— 长任务进度、分步结果都靠它,前端零轮询:
  ```js
  // 前端
  await workbench.gadget.runBatch(5, (p) => render(p.i, p.total));
  // 后端 server.js
  async runBatch(times, onProgress) { …; if (onProgress) await onProgress({ i, total }); }
  ```
- **旁路推送做不到**(后端主动找一条不属于当前调用的会话推事件):workerd 判定跨请求上下文
  并取消该请求(实测报 "promise resolved from a different request context" + hang 取消)。
  回调必须留在同一条调用链上。真正的旁路推送要把会话搬进 Durable Object(有稳定上下文),
  连同 alarms 定时唤醒一起,是后续版本的事。

预装演示:「计数器」应用(应用面板 → 计数器)—— 前端一颗按钮,计数与持久化全在沙箱后端。
