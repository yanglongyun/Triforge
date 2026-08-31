# Board

一个本地跑的项目看板。**项目并排成卡片，卡片里是条目，条目点开是详情。**

为一件具体的事做的：你在外面，用手机和一个 AI agent 对话推进好几个项目 ——
对话是线性的，看不出全貌。这个看板补上那一半：agent 在终端里写，你在手机上看和勾。

- **一个项目一张卡片**，卡片头挂状态徽章（想法 / 进行中 / 阻塞 / 搁置 / 已发布），一眼扫完
- **横向滚动**，手机上左右滑，卡片吸附对齐
- **条目点开看详情**，Markdown 正文 —— 结论、证据、下一步都能写进去
- **实时推送**：agent 在 CLI 里改完，你手上开着的页面立刻变，不用刷新
- **本地优先**：SQLite 落在你自己机器上，不联网，没有账号

## 跑起来

需要 Node ≥ 22.5（用了内置的 `node:sqlite`）。

```bash
npm run setup     # 装依赖 + 构建界面
npm start         # 前台跑，或者 node bin/board.mjs start 后台常驻
```

打开它给出的 `http://127.0.0.1:7420`。

**要在手机上看**，自己在外面套一层隧道：

```bash
ngrok http 7420
```

> ⚠️ 这个看板**没有任何鉴权**，拿到 URL 的人就能读能改。
> 服务默认只监听 `127.0.0.1`，别改成对外监听 —— 要给别人看就走隧道，并且知道自己在做什么。

## 给 agent 用

[`SKILL.md`](SKILL.md) 是给 AI agent 的说明书。把这个目录作为 skill 装进 Claude Code
（或任何认 `SKILL.md` 的 agent），它就知道怎么往看板里写东西了。

也可以直接用 CLI：

```bash
node bin/board.mjs card add "我的项目" --subtitle "一句话说明" --status active
node bin/board.mjs item add 1 "要做的事" --detail-file notes.md
node bin/board.mjs show
```

完整命令见 `node bin/board.mjs --help` 或 SKILL.md。

## 结构

```
bin/board.mjs        CLI 入口
src/shared/          状态词表 —— 前端后端 CLI 共用这一份，不两边各写
src/store/           schema.sql + 仓储层（node:sqlite，真 SQL，外键级联）
src/server/          HTTP API + SSE + 静态服务，零运行时依赖
src/cli/             子命令
ui/                  React + Vite + TypeScript
test/                node:test，22 个
```

几条自己给自己定的规矩：

- **不变量下沉到 schema**（NOT NULL / CHECK / 外键），应用层不重复校验
- **认不出来的字段直接抛错**，绝不静默丢弃 —— 静默丢弃会让调用方以为存上了
- **SSE 只说「有东西变了」**，界面自己重取整棵树。不推增量，就没有增量合并那一类同步 bug
- **位置是浮点数**，插队取相邻两个的中点，移动一张卡只写一行

## 开发

```bash
npm run dev        # vite 开发服务器，API 反代到 7420
npm run check      # typecheck + 测试
npm test
```

数据目录用 `BOARD_DATA_DIR` 覆盖，端口用 `BOARD_PORT`。

## License

MIT
