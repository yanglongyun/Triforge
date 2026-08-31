# Canvas

本地跑的无限画布。**基于 [Excalidraw](https://github.com/excalidraw/excalidraw)，场景存在你自己机器上，多端实时同步。**

- **成熟的画布内核** —— 手绘风格、图形/箭头/文字/图片/自由画、多选对齐、库、快捷键，都是 Excalidraw 现成的
- **多张场景** —— 顶栏切换，各存各的
- **实时同步** —— 一台设备改完，另一台开着的立刻跟上
- **乐观并发** —— 两台同时画不会互相整块覆盖：带版本号提交，冲突时按元素 `version` 合并再存
- **本地优先** —— SQLite 落在你自己机器上，没有账号，不联外网

## 跑起来

需要 Node ≥ 22.5（用了内置的 `node:sqlite`）。

```bash
npm run setup
npm start          # 或 node bin/canvas.mjs start 后台常驻
```

打开它给出的 `http://127.0.0.1:7440`。手机上看就套隧道：`ngrok http 7440`。

> ⚠️ **没有任何鉴权**，拿到 URL 就能读能改。服务只监听 `127.0.0.1`。

## 为什么是 Excalidraw 而不是 tldraw

tldraw 的画布做得更强，但它**不是标准开源许可**（`SEE LICENSE IN LICENSE.md`，商用要付费或挂水印），
放进一个 MIT 仓库会埋雷。Excalidraw 是 MIT，可嵌入，功能对个人用足够。

## 存盘策略

| 问题 | 做法 |
|---|---|
| Excalidraw 每次指针移动都回调 | 防抖 700ms 再写库 |
| 两台设备同时画 | 提交带 `version`，对不上服务端返回 409 —— 不静默覆盖 |
| 冲突了怎么办 | 把远端读回来，按元素 id 合并，同一元素取 `version` 更高的那个（Excalidraw 自己的调和规则），再存 |
| 自己存的会广播回自己 | 每个页签带一个随机 `origin`，广播里带上，认出来就忽略，否则会自己刷自己 |
| 手机切走就回不来 | `pagehide` 和 `visibilitychange` 上强制落盘 |
| appState 里大半是本机 UI 状态 | 只存视图相关的几个键（滚动、缩放、背景、网格、主题），当前工具/选中项/菜单开合一律不存 |

## 结构

```
bin/canvas.mjs     CLI
src/store/         schema.sql + 仓储层（元素、图片分表：图比元素大得多，列表页不该顺带读出来）
src/server/        HTTP API + SSE + 静态服务
ui/                React + Excalidraw + Vite + TypeScript
test/              node:test，10 个（含 jsdom 渲染冒烟）
```

## 给 agent 用

[`SKILL.md`](SKILL.md)。CLI 能建/改名/删/看，**不画** —— 元素格式由 Excalidraw 定，
手工构造很容易产出画不出来的元素。`canvas show` 会把画布里的文字读出来，这对
「看看用户在图上写了什么」是够的。

```bash
node bin/canvas.mjs add "架构图"
node bin/canvas.mjs list
node bin/canvas.mjs show 1
```

## 测试覆盖到哪儿

`test/render.test.mjs` 在 jsdom 里挂载一遍真实组件树，**但 Excalidraw 本体被替身换掉了**
（`test/fixtures/excalidraw-stub.tsx`）—— jsdom 缺一整套 canvas / 字体 API，补齐是打地鼠，
补出来的测试还脆。所以这条测试保证的是「外面那一圈接线正确」（场景切换、载入、存盘接线、
空态），不保证画布本身画得对。画布是成熟的第三方组件，风险在接线上。

## License

MIT。Excalidraw 亦为 MIT。
