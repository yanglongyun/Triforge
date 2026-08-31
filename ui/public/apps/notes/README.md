# Notes

本地跑的笔记。**左侧无限层级的页面树，正文是 ProseMirror + Yjs，多端实时同步。**

- **无限树形结构** —— 页面套页面，深到几层都行。拖到一行的上/下边缘是同级插队，拖到行中间是变成它的子页
- **正文是 CRDT，不是 HTML** —— 手机和电脑同时开着同一页，两边都能改，合并不需要冲突解决
- **离线能写** —— 改动先落 IndexedDB，联上自动合并
- **Markdown 记号直接生效** —— `# ` 标题、`- ` 列表、`> ` 引用、``` 代码块、`[ ] ` 待办；选中文字出浮动格式条
- **搜索标题和正文** —— `⌘K`
- **本地优先** —— SQLite 落在你自己机器上，没有账号，不联外网

## 跑起来

需要 Node ≥ 22.5（用了内置的 `node:sqlite`）。

```bash
npm run setup     # 装依赖 + 构建界面
npm start         # 或 node bin/notes.mjs start 后台常驻
```

打开它给出的 `http://127.0.0.1:7430`。要在手机上看，自己在外面套隧道：`ngrok http 7430`。

> ⚠️ **没有任何鉴权**，拿到 URL 就能读能改。服务只监听 `127.0.0.1`，别改成对外监听。

## 技术选型

| 选择 | 为什么 |
|---|---|
| **Tiptap 3** | 它就是 ProseMirror —— 把 schema、input rules、keymap、node view 那堆样板写好的一层。MIT |
| **Yjs** | 正文存成 CRDT。多端同时改不需要冲突解决，撤销栈也归它管（所以 StarterKit 的 `undoRedo` 必须关掉，两套历史会打架） |
| **自己实现 y-websocket 服务端** | 官方的 `@y/websocket-server` 依赖 `yjs@14` 预发布版，而客户端全家在 13.x —— 一个进程两个大版本会破坏 Yjs 的 `instanceof` 检查。协议只有 sync / awareness 两类消息，自己写反而把持久化的控制权拿了回来（`src/server/yjs.mjs`） |
| **node:sqlite** | 零原生依赖。正文存 `Y.encodeStateAsUpdate` 的字节，不存 HTML —— HTML 是渲染结果，不是真相 |

落盘策略是防抖 800ms。「每个按键都写盘」没必要，「只在最后一个连接断开时写」又太晚 —— 手机切后台时那次断开可能永远等不到。

## 结构

```
bin/notes.mjs        CLI
src/store/           schema.sql + 仓储层
src/server/yjs.mjs   Yjs WebSocket 服务端 + SQLite 持久化
src/server/          HTTP API + SSE + 静态服务
ui/                  React + Tiptap + Vite + TypeScript
test/                node:test，15 个 —— 含两个真实 y-websocket 客户端对拍的同步测试，
                     以及 jsdom 里跑一遍真实组件树的渲染冒烟测试
```

## 给 agent 用

[`SKILL.md`](SKILL.md) 是给 AI agent 的说明书。CLI：

```bash
node bin/notes.mjs page add "标题" --parent 2 --icon 📁
node bin/notes.mjs page move 5 --parent root --index 0
node bin/notes.mjs tree
node bin/notes.mjs find 关键词
```

**正文 CLI 不写** —— 那是一份 Yjs 文档，要在服务端跑一遍 ProseMirror schema 才能安全构造。
CLI 负责建页和搭结构，内容在界面里写。读是安全的：落盘时抽好的纯文本镜像就在库里，`find` 能搜到。

## 开发

```bash
npm run dev      # vite 开发服务器，API 和 WebSocket 都反代到 7430
npm run check    # typecheck + 测试
```

测试用 `--test-force-exit`：y-websocket 的客户端 `destroy()` 之后仍留一个定时器，
Node 进程因此不会自己退。服务端侧已验证干净（关闭后活动句柄为空）。

`test/render.test.mjs` 会用 esbuild 把真实组件树打成一个 IIFE，在 jsdom 里挂载一遍。
它存在的原因很具体：曾经因为 `useEditor` 在 early return 之前拿到空的 extensions，
ProseMirror 的 schema 里没有 `doc` 节点，整页白屏 —— 而所有接口层测试都是绿的。
这条测试把修复撤回去会立刻变红。

数据目录用 `NOTES_DATA_DIR` 覆盖，端口用 `NOTES_PORT`。

## License

MIT
