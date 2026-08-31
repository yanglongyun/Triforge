---
name: canvas
description: A local infinite canvas built on Excalidraw — diagrams, sketches, and freeform boards stored on the user's own machine and synced live across devices. Use when the user wants to draw, diagram, sketch an architecture, or mentions 画布 / canvas / whiteboard / Excalidraw / 白板. Provides a local browser canvas plus a CLI for managing scenes and reading what is on them.
---

# Canvas

无限画布,内核是 Excalidraw。**你负责管场景、读内容,用户负责画。**

## 启动

```bash
node "<skill-directory>/bin/canvas.mjs" start
```

返回一个回环地址,立刻给用户。首次使用先 `npm run setup`。起不来跑 `doctor`。

**保持默认只听回环。** 要在手机上看,让用户自己套隧道 —— 这个应用没有鉴权。

## 你能做和不能做的

**能做**:建场景、改名、删除、列出、读出画布里的文字和元素构成。

**不能画。** 元素格式由 Excalidraw 定(每个元素有 seed、versionNonce、绑定关系、
点集等一堆内部字段),手工构造极易产出画不出来或打开就报错的元素。
**别直接往 `scene_data` 表里写元素。**

用户说「帮我画个架构图」,正确的做法是:
1. 建一张场景并给出地址;
2. 把图的**结构**用文字讲清楚(有哪些框、怎么连),让用户自己摆 ——
   或者如果只是要一张图而不是一块可编辑的画布,考虑用 Mermaid/SVG 直接产出。

## 命令

```bash
canvas list                  # 所有画布,带 id、元素数、最近改动
canvas add <名字> [--index n]
canvas rename <id> <新名字>
canvas show <id>             # 元素构成 + 画布里的文字
canvas rm <id>
canvas prune <id>            # 回收没人引用的图片
canvas start | stop | status | doctor
```

所有命令加 `--json` 输出 JSON。`show --json` 会给出完整的元素数组 ——
读它来理解用户画了什么是可以的,写回去不行。

## 数据

SQLite,落在系统应用数据目录(`canvas doctor` 打出确切路径)。
`CANVAS_DATA_DIR` 可覆盖,`CANVAS_PORT` 改端口(默认 7440)。
