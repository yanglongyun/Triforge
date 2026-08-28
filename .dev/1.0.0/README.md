# 1.0.0 — Triforge:名字、语义、数据库全部对齐

0.9.0 把产品收敛成「三原生 + 组件」,但**代码和数据库还说着上一代的话**:
表叫 `agents`、有一张记录「智能体互调」的 `calls`、侧栏挂着没人看的活动流水、
标签页里躺着一个「预览」面板。这一版把它们全部对齐,并给产品定了名。

一句话:**0.9.0 定了产品是什么,1.0.0 让它从里到外都这么说话。**

## 一、定名 Triforge

试水名。三角之力(塞尔达)× 锻造台 —— 接住「三合一」的意象,也接住工作台的意象。

- **Triforce 本体已被占**:Infini-AI-Lab 的推理加速项目(COLM 2024)、一门编程语言、
  一个 DeFi 协议;`Triforge` 干净。同批查过并放弃的:Prism(Google Cloud 2026 有同名
  agent eval 工具 + Prisma/PrismJS/Stoplight 一堆)、Kiln(kiln.tech,自称
  "a workbench for the AI development loop",正面撞)、Flint(微软研究院 + Flint AI)、
  Jig(有人用了**同一个比喻**:夹持工件、导引刀具的工装)、Inkstone(三个同名仓库)。
- **结论比名字本身重要**:英文里短的矿物/工具类名词,在 AI 工具赛道已被打光。
  取名思路照 Obsidian —— **不描述功能,描述气质**(黑曜石跟笔记毫无关系),
  这样产品迭代不会让名字过期。真名以后再换。

### 名字分两层(这才是这一节的重点)

| | 值 | 变不变 |
|---|---|---|
| SLUG | `workbench` | **永不**。appId `ai.iimos.workbench`(反向 DNS 对齐 iimos.ai)、userData 目录、更新通道 `dl.iimos.ai/workbench` 全用它 |
| APP_NAME | `Triforge` | 随时。只出现在人眼可见处:窗口标题、`.app` 名、侧栏标题、空白页、`~/Documents/Triforge/` |

前端收进 `ui/src/lib/brand.ts` 一个常量,壳侧收进 `desktop/main.js` 顶部两行。
**将来换真名 = 改一行**,而不是又一次全仓重构。

**顺手拆掉一颗雷**:`WORKBENCH_HOME` 取的是 `app.getPath("userData")`,而 Electron 的
userData 路径**跟着 productName 走** —— 只改显示名,数据库就"凭空消失"。
现在显式 `app.setPath("userData", appData/workbench)` 钉死。
工作区目录相反,跟着显示名走(用户要在 Finder 里看见),带一次性 rename 搬迁。

## 二、数据库语义换血:6 张表

`chats / messages / compactions / settings / workspaces / sites`

- `agents` → `chats`,`agent_id` → `chat_id`;删 `hidden` 列(workerd 时代的孤儿);
- **删 `calls`**。它名义上是「智能体之间的异步通信」,实测 6 条记录 **caller_id 全为空** ——
  也就是普通对话轮。运行状态本就不该落库:跑到一半重启恢复不了,而发生过什么
  已逐条记在 `messages` 里。现在只在内存 Map + 事件广播;
- 删 `activities`(活动面板退出)、`panel_kv`(0.5 面板体系遗物);
- messages / compactions 加**外键 ON DELETE CASCADE**,顺手修掉旧代码删对话时
  漏删 compactions 的泄漏。

**不兼容、不迁移、从新开始** —— 老库改名留在原地(`workbench.db.pre-0.10`),不做迁移代码。

## 三、砍掉的东西

- **`agent` 工具**(六工具 → 五工具:bash / read / edit / write / browser)。
  异步派活整套语义依赖 `calls` 持久化,一并退出;system prompt 的「协作(多智能体)」段同去;
- **活动面板**:最老的 Arbor 遗留,产品已不主打多智能体互调,名存实亡;
- **预览机制**(ProcessPanel / process 标签 / `/api/processes`):产品本身就是浏览器,
  dev server 的地址在 bash 返回里,开个网页标签即可 —— 单独一层预览是多余的中间物;
- **历史工具名映射**(0.2.0 之前的 shell / run_process / *_file / web_fetch / cdp …):
  不留老数据就不需要它们;
- **`.agent.json` 迁移逻辑**、`migrateOnBoot`、`isAgentFile`;
- workerd 时代的残渣:lockfile 里的 workerd/capnweb(fresh clone 会白下 136MB)、
  `service/panels.ts`、`PANEL.md`。

## 四、README 重写

原来的三个「亮点」(对话即 agent 彼此通讯 / 异步调用 / 树形组织)已全部退出产品,
留着就是骗人。新版按现在的样子讲:三原生 + 组件 + 五工具 + 六张表。

## 待办

- **图标未定**:候选见本目录 `图标候选.html`(12 个,含 64/32/16 实际像素对照 ——
  16px 还认得出来才是能用的图标)。定了写进 `desktop/icon.svg` 重新生成 icns;
- **仓库名未改**(还叫 Workbench),等正式发布时连同真名一起;
- 组件的 `ui` 权限(toast/confirm)与 `fs` 权限未实现;
- **宿主 API 对外访问**未做:组件的 `/_wb/*` 不带凭据是因为「端口即身份」,
  外部应用不成立,必须显式发 token + 开 CORS。待定:开哪些能力(倾向 sql/ai,不开 fs)、
  外部应用的库落在哪、token 粒度。
