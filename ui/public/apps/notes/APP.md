# APP.md —— 笔记

本文档给两类读者看：**要用这个 app 的 agent**（照下面的表 curl / 敲命令），
以及**将来要改这个 app 的 AI**（改完同步更新本文档）。产品说明见 [`README.md`](README.md)，
在宿主里当技能用见 [`SKILL.md`](SKILL.md) —— 两者内容有重叠，因为读者不同（人 / 独立 agent 技能 / 宿主里的 agent）。

## 是什么

本地笔记：左侧无限层级的页面树，正文是 ProseMirror（Tiptap）+ Yjs，多端实时同步、离线能写。

## 什么时候用

用户说「记一下」「笔记理一理」「建个知识库」「整理文档」，或提到笔记 / 文档树 / 个人 wiki 时用它。
**你负责搭结构、找内容，正文交给用户在界面里写**（原因见下面「正文怎么写」）。

## API

被宿主拉起时，地址是 `http://{HOST}:{PORT}`；独立使用时是 CLI 打印出的 `http://127.0.0.1:7430`。

### HTTP

| 方法 | 路径 | 参数 | 返回 | 备注 |
|---|---|---|---|---|
| GET | `/health` | — | `{"ok":true}` | 探活 |
| GET | `/api/tree` | — | 页面树（含 children） | |
| GET | `/api/search` | `?q=关键词` | 命中数组，每条带 `snippet` | 搜标题和正文纯文本镜像 |
| GET | `/api/pages/:id` | — | 单页 | 不存在返回 404 |
| POST | `/api/pages` | `{title, parentId?, icon?, index?}` | 新建的页 | |
| PATCH | `/api/pages/:id` | `{title?, icon?, cover?, collapsed?}` | 更新后的页 | 不接受其它字段 |
| GET | `/api/pages/:id/body` | | `{body}` | 正文，Markdown 文本 |
| PUT | `/api/pages/:id/body` | `{body}` | `{pageId, length}` | 整篇覆盖 |
| POST | `/api/pages/:id/move` | `{parentId?, index?}` | 移动后的页 | `parentId` 传 `null` 挪到根 |
| DELETE | `/api/pages/:id` | — | `{"ok":true}` | **不可逆**：连带删除整棵子树和其正文，删前先 `GET /api/tree` 看清楚挂了什么 |
| GET | `/api/events` | — | SSE，`event: changed` | 结构或正文变了就推一条，前端收到后自己重新 `GET /api/tree`。协同的地基：agent 经 API 改的东西，正在看界面的人马上能看见 |

除 `GET /health` 外所有路径都在 `/api/*` 下；未命中的路径回落到界面（SPA）。

### CLI

等价于上表，另加进程管理：

```bash
node bin/notes.mjs tree                                       # 整棵树，带 id
node bin/notes.mjs find <关键词>                                # 搜标题和正文
node bin/notes.mjs page add <标题> [--parent id] [--icon emoji] [--index n]
node bin/notes.mjs page set <id> [--title t] [--icon emoji] [--cover gradient:dusk|https://…] [--collapse true|false]
node bin/notes.mjs page move <id> [--parent id|root] [--index n]
node bin/notes.mjs page show <id>
node bin/notes.mjs page write <id> <markdown…> [--append]                              # 看标题 + 正文开头
node bin/notes.mjs page rm <id>                                # 不可逆：连带删除整棵子树
node bin/notes.mjs start | stop | status | doctor
```

所有命令加 `--json` 输出 JSON。**独立使用**（不是被宿主拉起）时，`start` 默认后台常驻；
被宿主拉起走的是 `manifest.json` 里的 `run`，即 `start --foreground`，不需要也不应该再手动 `start`。

## 正文怎么写（重要）

正文不是 HTML，是一份 Yjs（CRDT）文档的二进制状态，存在 `docs` 表的 `state` 字段里。
**CLI 和 HTTP API 都不提供写正文的接口** —— 安全构造它要在服务端跑一遍 ProseMirror schema，
现在没有这条通路。**绝对不要直接写 `docs` 表**：那只是最后一次落盘的快照，
不经过 Yjs 的合并逻辑直接改字节，轻则不会同步、重则把文档状态写坏（其它端再打开可能白屏或丢内容）。

想给用户塞一段内容，两条路：

1. 建好页（`page add`），把内容贴在对话里让用户自己粘进编辑器；
2. 内容其实是「记录 / 台账」而不是「文稿」，可能更适合看板类的 app。

**读是安全的**：落盘时会抽一份纯文本镜像进 `search` 表，`find` 和 `page show` 读的是这份镜像，
不碰 Yjs 状态本身。

## 协同状态（现状缺口）

服务端**不知道用户当前打开的是哪一页、选区在哪、视口在哪**——这些状态目前只活在浏览器里，
没有查询接口。所以 agent 做不到「把这段改得正式点」这类需要先定位「这段」的协同；
只能退化成让用户明确报页面 id。这是产品原有设计留下的缺口，本次改造未新增，也未修补。

## 版本或撤销（现状缺口）

页面结构的增删改（`move` / `set` / `rm`）**没有撤销栈**。`rm` 是 SQL 层面的真删除，
级联删掉整棵子树和对应的 `docs` 记录，删完拿不回来。正文那边 Yjs 理论上留有可合并的历史，
但没有暴露"回退到某个时间点"的接口。结论：结构性改动前先 `tree` 摸清现状，
`rm` 前务必确认清楚子树范围——**没有物理删除之外的安全网**。

## 数据

SQLite 单文件，三张表（定义见 `src/store/schema.sql`）：

| 表 | 内容 |
|---|---|
| `pages` | 页面树：`parent_id` 自引用、`title`、`icon`、`cover`、`position`（浮点排序）、`collapsed` |
| `docs` | 正文：一页一行，`body` 是 Markdown 文本。搜索直接搜它，不另存镜像 |
| `docs` | 正文：`page_id → Y.encodeStateAsUpdate` 的字节。**不要直接改，见上一节** |
| `search` | 正文的纯文本镜像，只为 `find` 用 |

数据目录优先级：`APP_DATA_DIR`（宿主注入）＞ `NOTES_DATA_DIR`（独立使用时的环境变量覆盖）＞
按平台的系统应用数据目录默认值。`node bin/notes.mjs doctor` 打出当前实际生效的路径。

## 怎么改

```bash
npm run setup      # 装依赖 + 构建界面（ui/dist），改动前先跑一次
npm run dev         # vite 开发服务器，API 和 WebSocket 反代到 :7430
npm run check       # typecheck + 测试（node:test，含真实 y-websocket 客户端对拍的同步测试）
npm run build        # 只构建界面，等价于 setup 里的第二步
```

改了 API 形状、CLI 命令、数据表结构，或者「正文怎么写」「协同状态」「版本或撤销」这几节描述的能力，
要同步改本文档 —— 这几节是 agent 唯一的说明书。

## 跑起来

`node bin/notes.mjs start --foreground`。**服务端零运行时依赖**，不需要 `node_modules`。

改前端要重新构建：`npm install && npm run build`（产物进 `ui/dist`）。
改服务端（`src/`）改完直接跑，没有构建这一步。

## 封面（`cover`）

一个字符串，两种取值：

- `gradient:<名>` —— 内置渐变，名在 `dawn` `dusk` `moss` `ember` `slate` `bloom` `citrus` `deep` 里选
- `http(s)://…` —— 直接当图片地址

空字符串 = 没有封面。**不收上传的文件**：那要一整套存储、配额与清理，
而封面的价值几乎全在「一眼把这页和别的页分开」。
