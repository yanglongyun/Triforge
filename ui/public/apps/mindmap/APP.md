# 思维导图（mindmap）

本地、离线的交互式思维导图。浏览器画布负责展示与人手编辑，agent 用命令行读写同一份数据 ——
两边改的是同一个 JSON 文件，没有隐藏状态。本文档给「要用这个 app 的 agent」和
「将来要改这个 app 的 AI」看；面向对话技能调用方式的说明见仓库根的 `SKILL.md`（未改动，继续按原样生效）。

## 什么时候用

用户要把一堆想法、一篇文章、一个项目拆解整理成层级结构，或明确提到「思维导图」
「脑图」「概念图」「大纲树」时用它。创建、增删节点、挪动分支、把大纲复制成 Markdown
都在这个 app 里做。

## 怎么用：命令行是主接口

这是给 agent 的**真正**接口，不是 HTTP —— 用 `node scripts/mindmap.mjs <command>`
（工作目录任意，脚本用 `import.meta.url` 定位自身）：

```text
map list                                              列出全部导图（按 updated_at 倒序）
map create --name <name> [--root <text>]              新建导图，自动建根主题
map import (--file <path>|--stdin)                    整棵树一次性导入（推荐，见下）
map tree <map-id> [--compact]                          读出整棵树；--compact 是缩进文本，其余是 JSON
map rename <map-id> --name <name>
map delete <map-id>                                    ⚠️ 不可逆：连带删除这张图的全部主题
topic add --map <id> --parent <topic-id> --text <text> [--side left|right] [--position <n>]
topic update <topic-id> [--text <t>] [--collapsed true|false] [--side left|right] [--position <n>] [--parent <new-parent-id>]
                                                        --parent 把整条子树移到新父节点下（不能挪根，不能挪进自己的子孙）
topic delete <topic-id>                                ⚠️ 不可逆：连带删除这个节点的整棵子树；根节点不可删
```

`map create` / `map import` / `topic add` 会把新建对象的 JSON（含 `id`）打印到 stdout，
agent 应保留这些 id 用于后续操作。批量建图用 `map import`，一次性写完整棵树：

```json
{
  "name": "项目规划",
  "root": "项目规划",
  "topics": [
    { "key": "goal", "parentKey": "root", "text": "目标", "side": "right", "position": 0 },
    { "key": "users", "parentKey": "goal", "text": "用户价值", "position": 0 },
    { "key": "delivery", "parentKey": "root", "text": "交付", "side": "left", "position": 1 }
  ]
}
```

`root` 是根主题文字；保留字 `parentKey: "root"` 指向它。其余每条 topic 需要唯一 `key`、
一个已存在的 `parentKey`、非空 `text`。根的直接子主题可设 `side`（`left`/`right`，
大致左右均分）；更深层不用管 `side`，跟着所在分支走。布局建议、更完整的示例见
`references/workflow.md`（未改动）。

大文件用 `--file` 或 `--stdin`，不要把大段 JSON 塞进 shell 参数。

## HTTP 接口（宿主 / 浏览器用，agent 一般不需要直接调）

`manifest.json` 声明了 `run`，宿主会用 `node scripts/mindmap.mjs _serve` 把它当自运行 app
拉起，监听 `PORT`/`HOST`，数据写 `APP_DATA_DIR`：

```text
GET  /health              健康检查，2xx 即活。返回 { service, version, pid, instanceId }
GET  /                    浏览器画布（同一份 index.html，SPA）
POST /api/sql             浏览器前端用的内部读写通道，见下方「危险」
```

`/api/sql` 是画布前端的私有实现细节：请求体 `{query, params}`，但服务端**不是真正的
SQL 引擎**，而是对着一份 JSON 文件、按固定字符串模式匹配几条写死的语句
（源码见 `scripts/mindmap.mjs` 里的 `execute()`）。表面上是 `app_mindmap_maps` /
`app_mindmap_topics` 两张表，实际认识的查询只有源码里那几条，传别的字符串会直接
抛 `Unsupported query`。**agent 不要直接拼 SQL 字符串去调这个接口** —— 命令行覆盖了
所有需要的读写操作，且不依赖这份实现细节。

## 数据

单个 JSON 文件，原子写入（先写临时文件再 rename）：

- 被宿主以 `manifest.json` 的 `run` 拉起时：`$APP_DATA_DIR/mindmaps.json`
- 独立技能用法（`mindmap.mjs start`，未改动）：平台默认目录，
  或 `MINDMAP_DATA_DIR` 覆盖 —— 见 `references/workflow.md`

这两种运行方式**数据互不共享**（宿主每次都给一个新的 `APP_DATA_DIR`）。结构：

```text
{
  nextMapId, nextTopicId,               自增计数器
  maps:   [{ id, name, created_at, updated_at }],
  topics: [{
    id, map_id, parent_id,              parent_id = null 时是该图的根，一张图有且仅有一个根
    text, side,                         side: 'left' | 'right'，只对根的直接子主题有意义
    sort_order,                         同一父节点下的排序
    collapsed,                          0 / 1
    created_at, updated_at
  }]
}
```

## 协同：人和 agent 同时在改

- **当前状态没有专门的查询端点** —— 这是已知缺口，不是遗漏未写。浏览器里"现在打开的是哪张图"
  只活在地址栏 `?map=<id>` 和 React 组件状态里，服务端不追踪。要判断用户说的「这张图」
  「这一段」是哪个，用 `map list`（按 `updated_at` 倒序，最近改动的排最前，是最好的猜测依据）
  配合 `map tree <id> --compact` 读出文字定位到具体节点，拿不准就直接问用户。
- **没有版本历史，没有撤销**。所有写操作直接落盘覆盖，不留旧值。做有一定破坏性的改动前，
  先 `map tree <id>` 把现状读一遍存下来，改坏了只能凭这份记录手工写回去，没有系统级回退。
- **浏览器不会自动感知 agent 的改动**。CLI 写完数据后，如果用户当时正开着这张图的画布，
  界面不会自动刷新（没有轮询 / SSE / WebSocket，只在打开一张图、或切换"画布/大纲"视图时
  从数据文件重新读取）。CLI 改完图之后，告诉用户切一下右上角"画布/大纲"，或刷新页面，
  才能看到最新内容；不要默认用户会自动看到。
- **危险操作**：`map delete`、`topic delete` 都不可逆（后者级联删整棵子树）。执行前，
  除非用户已经明确要求删除这个具体对象，否则先确认。

## 怎么改

- `scripts/mindmap.mjs`：零依赖、零构建的单文件 CLI + server，改完直接生效。
- 浏览器画布 UI 源码在 `assets/client/apps/mindmap/src/`（React 外壳 + 原生 DOM/SVG 画布引擎），
  改完要重新构建：`cd assets/client/apps/mindmap && node build.mjs`，产物写到 `dist/`，
  `scripts/mindmap.mjs` 直接把 `dist/` 当静态站点根来发。构建细节、目录说明见
  `assets/client/apps/mindmap/APP.md`（ChatNext 内部约定的文档，和本文件是两回事，互不影响，
  不要混着改）。
- 改了 CLI 的子命令、参数或 JSON 数据结构，同步更新本文件和 `references/workflow.md`。
