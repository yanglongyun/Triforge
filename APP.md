# Workbench 应用契约(v2,0.8.0)

活动栏三原生 = 产品的三个名词:**会话**(AI)、**文件**(资产)、**应用**(软件形态),焊死不可移除。
其余一切都是应用。本文件是唯一正典:manifest 词汇表 = 能力清单 = SDK 文档,一份三用。

## 应用 = 工作区里的一个目录,本身是一个标准 Cloudflare Worker 网站

```
<workspace>/apps/<id>/
  app.json     manifest
  server.js    Worker:export default { async fetch(req, env) {…} }
  public/      静态资源(env.ASSETS 读这里)
  data.db      数据(env.DB 落这里 —— 就在代码旁边,你和 AI 都能 sqlite3 撬开)
```

「安装」= 目录存在(扫描自动注册);「移除」= 删目录。AI 用 write 工具即可造应用。
预装应用随包发,**首次启动落地到第一个工作区** —— 之后与用户自己造的应用再无区别,可改可删。

```json
{ "id": "notebook", "name": "笔记本", "icon": "📔",
  "mounts": { "tab": "/", "panel": "/panel.html" },
  "capabilities": ["db", "ai"] }
```

- **挂载点是路由路径,不是文件名**:`tab` 在标签页打开、`panel` 可钉到活动栏;至少一个,
  缺省为 `tab: "/"`。同一应用的两个挂载是两个实例,共享后端与数据。
- **打开语义**:在「应用」面板里点应用 = 在标签页打开;「钉到侧栏」是图钉按钮/右键菜单的独立动作。

## 架构:workerd 只负责计算,一切资源是 binding

与 Cloudflare 平台同构 —— 这不是比喻,是同一套写法:

| binding | 本地 | 上云对应 |
|---|---|---|
| `env.DB` | `apps/<id>/data.db`(Node 管的 SQLite) | **D1**(接口一致,代码一行不改) |
| `env.ASSETS` | `apps/<id>/public/` | Workers Assets |
| `env.HOST` | Workbench 专有能力(ai / agent / log) | 无,上云时降级 |

```js
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/notes") {
      const { results } = await env.DB.prepare("SELECT * FROM notes ORDER BY id DESC").all();
      return Response.json(results);
    }
    return env.ASSETS.fetch(req);
  },
};
```

- `env.DB`:D1 接口 —— `prepare(sql).bind(…).all() / .first() / .run() / .raw()`、`exec(建表脚本)`、`batch([…])`(一个事务);
- `env.ASSETS`:`fetch(req)` 读 public/,未命中且不像文件名时回落 index.html(SPA);
- `env.HOST`:`ai({summary, prompt, system})`(需 ai 能力,summary 必填,落活动流水)、
  `agent({summary, message})`(需 agent 能力,hidden 智能体执行)、`log(…)`(回流控制台,免声明)。

**前端与自己的后端同源**,直接 `fetch("/api/…")`,不需要任何 SDK。

## 宿主 UI 能力(可选,`<script src="/_wb/sdk.js">`)

只有要碰 Workbench 界面本身时才用:

| API | 能力 |
|---|---|
| `workbench.ui.toast(msg)` / `dialog.confirm(msg, opts)` | 免声明 |
| `workbench.tabs.open({url})` / `openApp({route})` | `tabs` |
| `workbench.system.openExternal(url)` / `copyText(text)` | `system` |
| `workbench.fs.read/write/list({path, content?})` | `fs:workspace`(首次使用弹用户授权) |
| `workbench.context()` / `on(event, fn)` / `emit(event, payload)` | 免声明:实例信息、路由推送、同应用实例间事件 |

## 隔离与安全

1. **物理断网**:`globalOutbound: null` —— 应用后端连 `fetch()` 外网都没有,只能经三个 binding;
2. **不透明源**:iframe `sandbox="allow-scripts"`(无 same-origin)。所有应用同在一个 workerd
   端口上,给了真 origin 就能互读 localStorage —— 所以坚持不给,数据一律走 `env.DB`;
3. **每应用一个 token**:`/app/<token>/…`,token 只绑一个 appId(应用甲拿不到应用乙的);
4. **能力网关**:manifest 没声明的能力,`env.HOST` 和宿主桥两侧都拒。

## 数据产权

- **领域数据归应用**:自己的 `data.db` 里自建 schema;宿主不提供任何域 API,不知道"书签"是什么 —— 这是 AI 能无限造应用的前提;
- **产品本体数据归宿主**(会话/文件树/标签页/智能体):只经能力网关按需开缝;
- **真实文件归用户**:`fs:workspace`,授权制。

## 已知边界

- **服务端→客户端推送**:同一条 HTTP 请求内可用(流式响应/SSE);后端主动找别的连接推事件做不到 ——
  普通 worker 里 workerd 会判定跨请求上下文并取消。要旁路推送与定时唤醒(alarms),
  需把会话搬进 Durable Object,列入后续版本。
- 应用后端**按需装载**(首个请求才起),按 server.js 内容哈希做版本键 —— 改完下次请求即新版。
