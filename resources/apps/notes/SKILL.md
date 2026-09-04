---
name: notes
description: Local notes with an infinite page tree — ProseMirror (Tiptap) + Yjs, synced live across devices. Use when the user wants to write, organize, or find long-form notes, docs, or a personal wiki, or mentions 笔记 / notes / Notion / 文档树. Provides a local browser app plus a CLI for creating and reorganizing pages.
---

# Notes

无限层级的页面树 + 协同正文。**你负责搭结构、找内容，用户在界面里写。**

## 启动

```bash
node "<skill-directory>/bin/notes.mjs" start
```

返回一个回环地址，立刻给用户。首次使用先 `npm run setup`。起不来跑 `doctor`。

**保持默认只听回环。** 要在手机上看，让用户自己套隧道 —— 这个应用没有鉴权。

## 你能做和不能做的

**能做**:建页、改标题/图标、换父、排序、删页、搜索。

**不能做**:写正文。正文是一份 Yjs 文档（CRDT），要在服务端跑一遍 ProseMirror schema
才能安全构造 —— CLI 不碰它。**别去改数据库里的 `docs` 表**，那会写坏文档状态。

想给用户一段内容,两条路:
1. 建好页,把内容贴在对话里让用户粘进去;
2. 内容本身属于「记录/台账」而不是「文稿」,那它可能更适合 board(看板)那个 skill。

**读是安全的**:`find` 搜的是落盘时抽出来的纯文本镜像,`page show` 能看到正文开头。

## 命令

```bash
notes tree                                     # 整棵树,带 id
notes find <关键词>                             # 搜标题和正文
notes page add <标题> [--parent id] [--icon emoji] [--index n]
notes page set <id> [--title t] [--icon emoji] [--collapse true|false]
notes page move <id> [--parent id|root] [--index n]
notes page show <id>
notes page rm <id>                             # 连带删掉整棵子树
notes start | stop | status | doctor
```

所有命令加 `--json` 输出 JSON。

## 怎么搭结构

- 动结构前先 `tree` —— 后面的命令靠 id 定位,别猜。
- **一层放 3–7 个**。超过就该分组;只有一两个的分组不如摊平。
- 顶层是领域(项目、领域、日志),不是单篇文档。
- `--icon` 给顶层和分组用一个 emoji,扫起来快;叶子页不用。
- 删除是连带整棵子树的,`page rm` 之前先 `tree` 看清楚下面挂了什么。

## 数据

SQLite,落在系统应用数据目录(`notes doctor` 打出确切路径)。
`NOTES_DATA_DIR` 可覆盖,`NOTES_PORT` 改端口(默认 7430)。
