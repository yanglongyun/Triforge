---
name: board
description: A local project board — projects side by side as cards, items inside each card, a detail pane one tap away. Use when the user wants to see or track the status of their projects, work streams, or anything with per-project to-do items, or mentions 看板 / kanban / Trello / board. Also use to record what you just found or did so the user can read it later on their phone. Provides a local browser board plus a CLI for agent-authored cards and items.
---

# Board

对话是线性的，看板不是。用户在手机上打开这个看板，一眼就能看到每个项目什么状态、还欠什么。
**你负责往里写，用户负责看和勾。**

## 启动

```bash
node "<skill-directory>/bin/board.mjs" start
```

返回一个回环地址，立刻给用户。首次使用先跑一次 `npm run setup`（装依赖 + 构建界面）。
起不来就跑 `doctor`，把它报的具体问题说出来。

**保持默认只听回环。** 用户要在手机上看，让他自己在外面套隧道（ngrok 之类），
你不要把服务改成对外监听 —— 这个看板没有任何鉴权。

## 形状

```
看板
└── 卡片 = 一个项目        状态:idea / active / blocked / paused / shipped
    └── 条目 = 一件事      状态:todo / doing / blocked / done
        └── 详情           点开看到的正文,写具体信息
```

一个项目一张卡片。卡片并排横向滚动，手机上左右滑。

## 写什么

**卡片** = 用户真正在推进的东西（一个仓库、一条产品线、一件长期的事）。标题短，
`--subtitle` 一句话说清它是干嘛的。

**条目** = 这个项目下一件具体的事。标题是「这件事是什么」，
详情是「为什么、卡在哪、下一步怎么做」。

**详情才是这个看板的价值所在。** 只写标题等于没写 —— 用户在手机上点开，
要看到的是他离开电脑之后能读懂的完整上下文：结论、证据（文件路径、行号、命令）、
你的判断。用 Markdown：`#` 标题、`-` 列表、`**粗**`、`` `码` ``、``` 代码块、`>` 引用。

长文本**不要塞进命令行参数**，用 `--detail-file <路径>` 或 `--detail-stdin`。

阻塞的事一定要标 `--status blocked` 并在详情里写清楚**在等什么** —— 卡片上会显红。

## 命令

```bash
board show [--compact] [--archived]     # 看当前全貌,带 id
board rename <看板名>

board card add <标题> [--status s] [--subtitle t] [--link url] [--index n]
board card set <id> [--title t] [--status s] [--subtitle t] [--link url] [--archive true|false]
board card move <id> <位置>              # 0 是最左
board card rm <id>                       # 连带删掉它的条目

board item add <卡片id> <标题> [--status s] [--detail t | --detail-file f | --detail-stdin]
board item set <id> [--title t] [--status s] [--detail t | --detail-file f | --detail-stdin]
board item move <id> [--card 卡片id] [--index n]
board item show <id>
board item rm <id>

board import (--file <路径> | --stdin)   # 一次灌一整块,见下
board start | stop | status | doctor
```

所有命令加 `--json` 输出 JSON。

## 批量导入

第一次建看板、或者一次要写很多内容时用这个，别一条条 `add`：

```json
{
  "name": "我的项目",
  "cards": [
    { "title": "项目名", "subtitle": "一句话说明", "status": "active", "link": "https://…",
      "items": [
        { "title": "一件事", "status": "blocked", "detail": "**在等什么**\n\n具体说明。" }
      ]}
  ]
}
```

```bash
board import --file plan.json
```

## 工作方式

- 动结构之前先 `board show` —— 后面的命令要靠 id 定位，别猜。
- 改完不用告诉用户"去刷新" —— 页面自己会变（SSE 实时推送）。
- 事情有进展就顺手改状态。用户看到 `done` 是**你确认做完了**，不是"应该做完了"。
- 用户勾掉的、改过的，下次 `show` 会读到 —— 那是他的输入，别覆盖。
- 一个项目的条目别堆到几十条。做完的可以删，或者把整张卡 `--archive true` 归档。

## 数据

SQLite，落在系统的应用数据目录（`board doctor` 会打出确切路径）。
`BOARD_DATA_DIR` 可覆盖，`BOARD_PORT` 改端口（默认 7420）。
