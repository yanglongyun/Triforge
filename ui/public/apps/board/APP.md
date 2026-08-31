# Board

本地项目看板:一个项目一张卡片，卡片并排横向排列，卡片里是条目，条目点开是详情（Markdown）。
人在手机上看和勾，agent 在这里写结论、证据、下一步。数据只有一份真相，在这个进程的 SQLite 里 ——
人经 GUI 改、agent 经 API/CLI 改，改的是同一份状态，且**经 API 的变更会通过 SSE 实时推到正在开着的页面**。

## 什么时候用

用户想追踪多个项目 / 工作流的状态和待办、要把调查结论和下一步记下来给自己以后看、
或提到「看板」「kanban」「Trello」时用它。也可以用来记录你刚查到或做完的事，留给用户在手机上读。

## API

宿主环境下先取址（`GET {HOST_URL}/host/... ` 或宿主界面里的地址），再对 origin 调；
独立产品用法下直接是 `http://127.0.0.1:7420`（或 `PORT`/`BOARD_PORT` 指定的端口）。

```text
GET    /health                健康检查 → { ok: true }

GET    /api/meta              状态词表 → { cardStatuses, itemStatuses }（id/label/hue，见下）

GET    /api/board[?board=id][&archived=1]   看板全貌，含全部卡片和条目 → 见「当前状态」
PATCH  /api/board             {"name":"..."} 看板改名 → board

POST   /api/cards             {boardId?,title,subtitle?,status?,link?,index?} 新建卡片 → card
PATCH  /api/cards/:id         {title?,subtitle?,status?,link?,archived?} 局部更新 → card
POST   /api/cards/:id/move    {"index":n} 移到第 n 位（0 是最左）→ card
DELETE /api/cards/:id         删除卡片，**级联删除它的全部条目，不可逆**（无撤销）→ { ok: true }

POST   /api/items             {cardId,title,detail?,status?,index?} 新建条目 → item
PATCH  /api/items/:id         {title?,detail?,status?} 局部更新 → item
POST   /api/items/:id/move    {cardId?,index?} 移动/搬家到别的卡片 → item
DELETE /api/items/:id         删除条目，**不可逆**（无撤销）→ { ok: true }

GET    /api/events            SSE，收到事件说明状态变了，自己重新 GET /api/board（不推增量）
```

`PATCH` 只认字段表里列出的键，传别的键直接 400（不会静默丢弃）。
`status` 是枚举，卡片：`idea/active/blocked/paused/shipped`；条目：`todo/doing/blocked/done`
（越权值也是 400，具体取值见 `/api/meta`）。

也有等价的 CLI（脚本/无网络场景用它更省事，见 `SKILL.md` 有完整参数和批量导入格式）：

```text
node bin/board.mjs show [--compact] [--archived]
node bin/board.mjs card add|set|move|rm ...
node bin/board.mjs item add|set|move|show|rm ...
node bin/board.mjs import (--file <路径> | --stdin)   # 一次灌一整块 JSON
node bin/board.mjs start|stop|status|doctor
```

CLI 默认写本机默认数据目录/端口（受 `BOARD_DATA_DIR` / `BOARD_PORT` 或宿主的
`APP_DATA_DIR` / `PORT` 影响，见「数据」）；宿主环境下优先用 HTTP API 对 `PORT` 说话，
CLI 只在同机、同一份 `APP_DATA_DIR` 时才和 HTTP API 是同一份数据。

## 当前状态

写之前先 `GET /api/board`（或 `board show`）—— 后面所有改动都要靠这里返回的 `id` 定位，别猜。
返回形状：

```json
{ "board": { "id": 1, "name": "..." },
  "cards": [ { "id": 1, "title": "...", "status": "active", "items": [ { "id": 1, "title": "...", "status": "todo", "detail": "..." } ] } ] }
```

默认不含已归档卡片，加 `?archived=1` 才带上。这就是「当前打开的看板」——没有单独的选区/视口概念，
条目详情本身就是 Markdown 正文，改哪条直接 PATCH 哪条的 `id`。

## 版本或撤销

**没有。** 删除是硬删除（`DELETE FROM cards/items`），级联，无回收站，无历史版本。
这是本次改造发现的一处缺口，不是设计成这样——协同型 app 按契约应该有撤销兜底，
board 目前没有，删之前务必想清楚，拿不准就先 `--archive true` 或改 `status`，别用 `rm`。

## 数据

SQLite，默认落在系统应用数据目录（`board doctor` 打印确切路径）。作为独立产品运行时：
`BOARD_DATA_DIR` 覆盖目录、`BOARD_PORT` 覆盖端口（默认 `7420`）。作为宿主 app 运行时，
宿主给的 `APP_DATA_DIR` / `PORT` 优先于上面两个，不给就退回原来的行为——两套变量名共存，互不冲突。

表结构（`src/store/schema.sql`，唯一真相，外键级联删）：

- `boards`：`id` / `name` / `created_at` / `updated_at`
- `cards`（= 项目）：`id` / `board_id` / `title` / `subtitle` / `status` / `link` /
  `position`（浮点数，决定横向顺序）/ `archived`(0|1) / `created_at` / `updated_at`
- `items`（= 条目）：`id` / `card_id` / `title` / `detail`（Markdown 正文）/ `status` /
  `position` / `created_at` / `updated_at`

## 怎么改

```bash
npm run setup     # 装依赖 + 构建 ui/（vite build，产物在 ui/dist，服务端直接托管）
npm run dev       # 前端热重载开发，API 反代到本机服务
npm run check     # typecheck + node:test（22 个用例）
```

改了 API 形状或表结构，同步更新本文档；`SKILL.md` 是给 agent 的操作手册，两者各管一段，都要顺手对齐。
