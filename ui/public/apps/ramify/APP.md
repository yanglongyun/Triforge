# APP.md（应用契约文档）

给两类读者看：**要用 Ramify 的 agent**，和**将来要改 Ramify 这个 app 的 AI**。

这份文档只讲「作为契约 app 怎么用」。Ramify 作为独立开源产品的完整能力、心智模型和写作规范见
[`SKILL.md`](SKILL.md) 和 [`references/`](references) 下的四份文档（`workflow.md` / `data-model.md` /
`artifacts.md` / `api.md`）——两者共存，APP.md 不重复讲创作方法论，只讲宿主环境下的接线方式。

## 什么时候用

凡是「先看几个方向、比较之后再决定」的任务：落地页与官网、交互 Demo/原型、文案与传播稿、
品牌与视觉探索（Logo/海报/配色）、文档与知识创作（简历/教案/方案/报告）、图片/视频/音频的多方案比较。
用户说「做几个方向」「对比几版」「分叉试试」，或提到 Ramify、创意树时用它。

## 在契约宿主下怎么跑

- `manifest.json` 声明 `run.command = node`，`run.args = ["app/dist/server.mjs"]`，前台运行。
- 健康检查 `GET /api/health`，2xx 即就绪，返回体含 `service` / `version` / `pid` / `instanceId`。
  当前实现**不带 `busy` 字段**（见文末摩擦清单）——宿主按 `on-demand` 空闲回收前的二次探活，
  Ramify 目前总是允许被回收，不会推迟。
- 环境变量：`PORT`、`HOST`（未设时回落 `127.0.0.1`）、`APP_DATA_DIR`（数据目录，优先于仓库自带的
  `RAMIFY_DATA_DIR` 及各平台默认路径）。`APP_ID` 当前实现未使用。`HOST_URL` / `APP_TOKEN` 用于调
  `POST /host/ai/complete`（见下面「画布内直接生成」一节），`manifest.json` 的 `permissions` 声明为
  `["ai.complete"]`。两者任一缺失时，画布仍然完整可用（建项目、看树、CLI、直接写 artifact 都不受影响），
  只有「生成」「继续发散」这两个动作会收到 `501 HOST_AGENT_UNAVAILABLE`。
- `SIGTERM` / `SIGINT` 触发干净退出：停止接受新连接、关闭 SQLite 连接、最多等待 3 秒后强制退出。
- 这是**自运行**形态（有 `run`），不是宿主代管的静态 app：整站（页面、静态资源、API）都由这一个
  监听 `PORT` 的进程应答。

作为独立 Skill 使用时（`node scripts/ramify.mjs start` 等），行为与之前完全一致：`scripts/ramify.mjs`
维护自己的单实例后台进程和 `RAMIFY_PORT` / `RAMIFY_HOST` / `RAMIFY_DATA_DIR` 环境变量，
不经过、也不依赖 `manifest.json`。两条路径共享同一个 `app/dist/server.mjs`。

## HTTP API

Base URL 用宿主传入的 `PORT`/`HOST` 现拼，不要缓存。JSON body 限 10 MiB，本地无鉴权。

| 方法 | 路径 | 参数 | 返回 | 说明 |
|---|---|---|---|---|
| GET | `/api/health` | — | `{service,version,pid,instanceId,capabilities}` | 健康检查，即 manifest 里的 health |
| GET | `/api/settings` | — | 当前主题/语言设置 | |
| PUT | `/api/settings/theme` | `{theme:"light"\|"dark"\|"system"}` | 更新后的设置 | 立即通知已打开页面 |
| PUT | `/api/settings/locale` | `{locale:"zh-CN"\|"en"\|"ja"\|"es"\|"de"}` | 更新后的设置 | 立即通知已打开页面 |
| GET | `/api/projects` | — | 项目列表 | |
| GET | `/api/projects/version` | — | `{version}` | 列表的轻量轮询标记 |
| POST | `/api/projects` | `{prompt, title?, count?}` | 新项目，含 `rootId`、`nodeIds` | 创建项目与根节点；`count`(0–5)同时在根节点下建 N 个「生成中」占位节点 |
| PUT | `/api/projects/:id` | `{title, expectedUpdatedAt?}` | 更新后的项目 | 重命名 |
| GET | `/api/projects/:id/tree` | — | 有序节点树 | |
| GET | `/api/projects/:id/version` | — | `{version}` | 单棵树的轻量轮询标记 |
| DELETE | `/api/projects/:id` | — | — | **不可逆**：删除项目、全部节点和 artifact 文件 |
| POST | `/api/projects/:id/nodes` | `{parentId, title, position?, content?, artifactType?, artifact?}` | 新节点 | 创建单个节点 |
| POST | `/api/projects/:id/nodes/batch` | 数组，每项 `{key, parentId\|parentKey, ...}`，最多 100 条 | 新节点列表 | 一次事务内批量建树 |
| POST | `/api/projects/:id/generate` | `{prompt, count(1–5), nodeIds}` | `202 {accepted, nodeIds}` | 见下「画布内直接生成」。`nodeIds` 必须是该项目下已存在、且还是占位状态的节点 id |
| POST | `/api/nodes/:id/branch` | `{prompt, count(1–5), nodeIds}` | `202 {accepted, nodeIds}` | 同上，`:id` 是要继续发散的父节点，`nodeIds` 是该节点下新建的占位子节点 |
| PUT | `/api/nodes/:id` | `{title?, content?, parentId?, position?, expectedUpdatedAt?}` | 更新后的节点 | `content` 传 `null` 变为仅标题节点 |
| DELETE | `/api/nodes/:id` | — | — | **不可逆**：删除该节点（非根）及其全部子孙 |
| GET | `/api/nodes/:id/content` | — | `{content}` | |
| PUT | `/api/nodes/:id/artifact` | `{artifactType, artifact, expectedUpdatedAt?}` | 更新后的节点 | 创建/替换 artifact，**覆盖式，旧文件不保留** |
| PUT | `/api/nodes/:id/artifact/error` | `{error, expectedUpdatedAt?}` | 更新后的节点 | 标记生成失败 |
| DELETE | `/api/nodes/:id/artifact` | — | — | **不可逆**：删除 artifact 文件，节点退化为仅标题 |
| GET | `/api/nodes/:id/artifact/source` | — | artifact 源内容 | |
| GET | `/api/nodes/:id/artifact` | — | 原始字节流，真实 MIME | |
| GET | `/api/nodes/:id/html` | — | 预览用完整 HTML | |

`ArtifactType` = `html \| markdown \| svg \| image \| video \| audio`。`expectedUpdatedAt` 用于乐观并发，
版本不匹配返回 `409 VERSION_CONFLICT`。详细参数与边界见 [`references/api.md`](references/api.md)。

## 画布内直接生成

画布首页的创作票据（输入 + 数量）和节点上的发散按钮，都是先用上面的普通 API 建好项目/占位节点
（画布秒开、不等生成），再调 `POST /api/projects/:id/generate` 或 `POST /api/nodes/:id/branch` 启动
生成流水线。**全程没有 agent、没有工具**，只有两级普通补全：

1. 服务端校验 `project`/`node` 与 `nodeIds` 都存在，立即回 `202 {accepted, nodeIds}`，流水线转后台。
2. **计划**：一次 `POST ${HOST_URL}/host/ai/complete`（`Authorization: Bearer $APP_TOKEN`），body 里带
   `schema`（JSON Schema，宿主翻成协议原生的结构化输出约束），产出必然是
   `{"directions":[{"title","type":"html|markdown|svg","idea"}]}`，不靠提示词求格式。
   解析后逐个占位节点认领一个方向；方向数不足用最后一个补齐，完全解析不出则全部标失败。
3. **生成**：每个节点一次 `/host/ai/complete`，system 按 type 选（网页工程师 / 写作者 / 插画师），
   prompt 是该方向的 idea（分支时附父节点完整源码）。产出要求单文件、无外部资源;剥掉围栏后按
   type 校验（html 必须是完整文档、svg 不得带 script），合格就 `updateArtifact` 写入并把节点标题改成
   方向 title，不合格 / 补全失败则 `PUT /api/nodes/:id/artifact/error` 标记失败，不让占位节点转圈。
   并发上限 3;补全自带 8 分钟超时。
4. 画布照常轮询 `version` 端点看到内容变化 —— 前端不知道也不需要知道生成是怎么发生的。

`manifest.json` 的 `permissions` 声明为 `["ai.complete"]`。没有 `HOST_URL`/`APP_TOKEN`（在契约宿主外
独立跑 Ramify）时，这两个端点直接返回 `501 HOST_AI_UNAVAILABLE`；建项目、看树、CLI、直接用
API/CLI/SQL/文件写 artifact 等既有能力完全不受影响——画布内生成是唯一依赖宿主能力的功能。

## CLI

`node scripts/ramify.mjs <子命令>`，`start` 会先探活复用同一份 `runtime.json` 记录的实例，
不会重复起进程；在契约宿主下**不要用它启动**（它自己管理单实例后台进程、PID 文件和
`RAMIFY_PORT`/`RAMIFY_HOST`，和宿主的生命周期管理冲突）——宿主按 `manifest.json` 直接
`spawn app/dist/server.mjs`。CLI 仍是 agent 常规操作最省事的入口，命令与上表 API 的对应关系：

| 命令 | 对应 API |
|---|---|
| `project create --prompt <text> [--title <text>]` | `POST /api/projects` |
| `project tree <id> [--compact]` | `GET /api/projects/:id/tree` |
| `project rename <id> --title <text>` | `PUT /api/projects/:id` |
| `project delete <id>` | `DELETE /api/projects/:id`（**不可逆**） |
| `node add --project <id> --parent <id> --title <text> [--content] [--artifact-type] [--file\|--stdin]` | `POST /api/projects/:id/nodes` |
| `node batch --project <id> (--file\|--stdin)` | `POST /api/projects/:id/nodes/batch` |
| `node complete <id> --artifact-type <type> (--file\|--stdin\|--artifact)` | `PUT /api/nodes/:id/artifact` |
| `node update <id> [--title] [--content] [--parent] [--position]` | `PUT /api/nodes/:id` |
| `node error <id> (--message\|--file\|--stdin)` | `PUT /api/nodes/:id/artifact/error` |
| `node clear-artifact <id>` | `DELETE /api/nodes/:id/artifact`（**不可逆**） |
| `node delete <id>` | `DELETE /api/nodes/:id`（**不可逆**） |
| `theme [light\|dark\|system]` | `PUT /api/settings/theme` |
| `language [zh-CN\|en\|ja\|es\|de]` | `PUT /api/settings/locale` |

`--file` 传路径、`--stdin` 从标准输入读；创建/完成 artifact 时优先用这两个，避免把大段 HTML 塞进
shell 参数。批量建树用 `node batch`，避免 N 次单节点请求。

## 数据在哪、怎么改

- 运行时数据目录：`APP_DATA_DIR`（契约宿主下）或 `RAMIFY_DATA_DIR`（独立运行下）；两者都不设时按平台
  默认路径（macOS `~/Library/Application Support/Ramify/`，Windows `%APPDATA%\Ramify\`，Linux
  `${XDG_DATA_HOME:-~/.local/share}/ramify/`）。宿主已建好这个目录，不要往仓库目录写数据。
- 目录结构：`ramify.db`（SQLite，节点树）+ `artifacts/<project-id>/<node-id>.<ext>`（每个 artifact 一个
  稳定路径的文件，可以像源码一样直接编辑）。表结构、直接 SQL、直接改 artifact 文件的方法见
  [`references/data-model.md`](references/data-model.md)。
- **状态只有一份真相，在这个进程里**：无论人在画布上改，还是 agent 经 API/SQL/文件改，Ramify 的
  文件监听器和轮询版本号机制会让改动反映到已打开的页面上（详见下节「协同」）。

构建：在 `app/` 目录下

```bash
npm install
npm run check    # typecheck + test + check:licenses + build
```

`npm run build` 产出 `app/dist/`（含 `server.mjs` 和 `public/`），**这份产物已提交进仓库**——
改了 `app/src/**` 之后必须重新 `npm run build` 并把 `app/dist/**` 的变化一并提交，
否则 `manifest.json` 启动的是旧代码。`npm run verify:dist` 会用 `git diff --exit-code -- dist`
检查这件事有没有漏做。

## 协同（人和 agent 同时会动手）

Ramify 是画布类协同 app，人在浏览器里看/改，agent 经 CLI/API/SQL/文件改，契约要求补充三条：

1. **当前状态端点**：**没有**。服务端不暴露「当前打开的项目/选中节点/画布视口」——这些是纯前端
   React 状态（`app/src/ui/pages/Canvas.tsx` 里的 `selectedId` 和 `useCanvasViewport`），
   服务端拿不到。人说「把这段改得正式点」时，agent 无法反查用户当前选中的是哪个节点，
   只能靠对话上下文里明确提到的节点 id（如 `#4 标题 (node:xxxx)`）或最近一次自己创建的节点。
   这是当前实现的真实缺口，见文末摩擦清单。
2. **版本或撤销**：没有真正的版本历史/撤销栈。有的是乐观并发（`expectedUpdatedAt` 不匹配时
   `409 VERSION_CONFLICT`，防止互相覆盖）和一个约定俗成的工作流——「先归档再改」：
   有比较价值的改动开新子节点而不是原地覆盖，原节点保留在画布上作为可退回的版本
   （细节见 [`references/workflow.md`](references/workflow.md) 的 Revise 一节）。
   agent 改坏东西之后没有系统级"退回上一步"，只能人工再开一个分支修正。
3. **危险标注**：见上面 API 表和 CLI 表里加粗的「不可逆」标记——`DELETE` 项目/节点/artifact，
   以及用新内容整体替换 artifact（旧文件不保留）。这几类操作前 agent 应先向用户确认，
   而不是径直执行。

## 摩擦清单（本次改造过程中的发现）

以下是把 Ramify 接入应用契约时观察到的、契约或宿主侧尚显生涩/含糊/缺失的点，供契约演进参考：

1. **health 的三态在这里退化成两态**：契约允许非 2xx（如 503）表示"活着但还在初始化"，Ramify 的
   `initializeSchema()` 是同步执行、监听前完成的，进程一旦能应答端口，`/api/health` 就必然是
   ready，没有中间态可用。这对 Ramify 没问题（启动够快），但如果契约文档能补一句"同步初始化的
   app 不需要用到三态里的中间档"，能减少新接入者的困惑——目前读起来像是三态是强制要求。
2. **`busy` 字段是可选的，但契约没有说清楚"不声明等价于什么"**：Ramify 当前完全没有实现
   `busy` 语义，等价于"总是可以被回收"。这对一个本地画布类 app（用户可能正开着页面看）其实不太
   对——但契约把"闲置怎么判"完全留给宿主策略，app 侧没有"我现在有浏览器标签页开着"这个信号来源
   （宿主不一定看得到 app 的浏览器流量，契约文档自己也承认这点）。也就是说 on-demand 回收对
   "被人盯着看的本地画布"这类场景，理论上会出现"页面开着但进程被回收，下次操作要重新拉起"的体验
   顿挫，除非画布前端自己做好断线重连和回收后的静默恢复——契约层面没有给出这类"有人在看"的信号
   通道，只能 app 自己在 health 里主动汇报，而汇报什么时候该报 true、依据哪个信号，契约没有示例。
3. **协同型 app 要求的"当前状态端点"和 Ramify 现状之间有真实缺口**（见上节第 1 条）——这不是这次
   改造能顺手补的功能缺口，如实记录在这里，留给后续版本考虑是否要加一个
   `GET /api/ui-state`（当前项目、选中节点、视口）之类的只读端点，由前端定期上报自己的状态。
4. **`APP_DATA_DIR` 和 app 自带的类似变量（`RAMIFY_DATA_DIR`）共存时的优先级，契约没有明说**：
   本次实现按"宿主变量优先于 app 自己的历史变量"处理，这个判断是从"宿主环境变量存在时优先于
   它现有的配置方式"这句任务指令反推的，契约正典本身没有对"app 自带同名语义变量怎么和五件套
   共存"给出通用指导，如果不同 app 各自理解不同，行为会不一致。
5. **工作目录约定和"整站自己应答"的组合，容易踩 cwd 陷阱**：契约规定 `工作目录 = app 目录`
   （即 `manifest.json` 所在目录），但很多项目的构建产物、静态资源习惯用相对于自己构建脚本
   所在位置的路径去定位，而不是相对于进程 cwd。Ramify 原来的静态资源定位就依赖
   `process.cwd()`，这在"用契约标准方式启动"（cwd = 仓库根）和"用项目自己的 CLI 启动"
   （cwd = `app/`，且显式传了另一个定位变量）之间行为不一致，是本次改造中唯一一处需要动
   服务端逻辑（而不仅是接线）才能修好的地方。这提示：契约里"工作目录固定"这条约定，对于
   "本来就有自己一套构建产物定位方式"的现有项目，是一处不算小的迁移成本，值得在 APP.md
   撰写指南或契约正典里提醒一句"检查你的静态资源定位逻辑是否假设了 cwd"。
6. **（本条已过时，保留作对比）** 上一版接入时 `permissions: []`，`APP_ID`/`HOST_URL`/`APP_TOKEN`
   三个变量完全用不上；这次接上画布内生成后 `HOST_URL`/`APP_TOKEN` 变成刚需（见「画布内直接生成」
   一节），`APP_ID` 依然用不上——五件套里各变量的「用不用得上」完全取决于 app 声明了哪些权限，
   契约在这点上是自洽的，之前的记录只是刻舟求剑。
7. **`/host/ai/agent` 当「会话桥替代品」时，最大的落差是它开的是新轮次，不是插进用户当前正在看的
   那个会话**：dsh 版本的做法（`RamifySessionBridge` + `postMessage`）是把指令塞进用户当前对话框、
   模拟一次真实发送，模型的回复、思考过程、工具调用都在用户正看着的那个对话里发生，用户全程在场。
   `/host/ai/agent` 是另开一个不可见的独立轮次，事件流服务端静默吃掉，用户在宿主界面上完全看不到
   过程，只能通过画布轮询看到结果慢慢出现。对「画布是主界面，agent 是后台劳力」这个场景够用，但
   如果宿主以后想做「让用户看着 agent 怎么想」，这条能力目前给不了——它本质是一次性 headless 调用，
   不是「接进某个现有会话」。
8. **没有轮次超时、事件数上限、或「已完成多少节点」的进度信号**：SPEC 只定了事件词表
   （`message`/`reasoning`/`function_call`/`function_call_output`/`done`/`error`），没有约定轮次最长
   多久、`function_call` 事件里能不能看出「调用的是哪个端点、参数是什么」（还是只有笼统的
   函数名/文本）。本次实现只能自己在服务端兜一个 10 分钟的硬超时（`dispatchAgentTurn` 里的
   `TURN_TIMEOUT_MS`），超时或 `done` 后仍有占位节点未完成就标记失败——这个策略完全是猜的，
   契约没有给出「多久算异常」的参考值，不同 app 各自猜的数字大概率互不一致。
9. **子 agent 没有工具，只有 bash/curl，意味着「写入协议」必须编码进 prompt 文本本身**：dsh 版本靠
   给模型注册 `ramify_node_complete` 之类的强类型工具，参数由框架校验；换成 `/host/ai/agent` 后，
   子 agent 收到的只是一段自然语言 + curl 用法示例，节点 id、JSON 形状、转义方式全靠指令文本讲清楚、
   靠子 agent 自己老实执行 curl——本质上是把「类型安全的工具调用」降级成「但愿它照抄 curl 命令」。
   实测（假宿主 + 真实 curl 写回）证明可行，但这是本次改造里唯一一处「宿主能力形状变了，功能就得
   跟着降级」的地方，如果契约以后想让 `/host/ai/agent` 更好地替代「给子会话注册工具」这类场景，
   这里是个值得补的缺口。
