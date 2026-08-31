# 画布

无限画布,内核是 Excalidraw。数据在自己的 SQLite 里,和宿主无关。
agent 负责管场景、读内容,画图交给用户 —— 元素格式由 Excalidraw 定
(seed、versionNonce、绑定关系、点集等一堆内部字段),手工构造极易产出
画不出来或打开就报错的元素,**不要直接拼 `elements` 写回去**。

## 什么时候用

用户说「画个架构图」「开张画布」「白板」「Excalidraw」时用它。正确做法:
建一张场景、把地址给用户,再用文字把结构(有哪些框、怎么连)讲清楚让用户自己摆;
如果用户只要一张图而不是一块可编辑的画布,考虑直接产出 Mermaid/SVG。

## API

HTTP,在自己的 origin 上。先取址(`GET {宿主}/api/apps/canvas/address` → `{ origin }`,
没起会被顺手拉起),再对 origin 调下面这些。仓库自带的 CLI
(`node bin/canvas.mjs <命令>`)也能用,和 HTTP API 读写同一份数据库、互相可见 ——
但用 CLI 时必须带上和这个实例相同的 `APP_DATA_DIR`,否则会连到独立产品
默认的数据目录,跟宿主里正在跑的这份对不上(见文末摩擦清单)。

```text
GET    /health                 健康检查 → { ok, busy }。busy 由是否有页签正连着 SSE 决定
GET    /api/scenes             列出全部场景 → [{id,name,position,element_count,updated_at,...}]
POST   /api/scenes             {"name"?, "index"?} 新建一张 → 场景
GET    /api/scenes/:id         读一张的全部内容 → {scene, version, elements, appState, files}
PATCH  /api/scenes/:id         {"name"} 改名 → 场景
PUT    /api/scenes/:id         {elements, appState, files, version} 整份覆盖式存盘 → {version}
                                带的 version 要对得上当前版本,对不上返回 409(乐观并发,见下)
DELETE /api/scenes/:id         删场景,连带内容和图一起删。此操作不可逆
POST   /api/scenes/:id/prune   清理没人引用的图片。此操作不可逆
GET    /api/events             SSE:有改动就推一条 {reason, at},收到后重新 GET 该场景
```

对应的 CLI:`canvas list|add|rename|show|rm|prune`(`--json` 输出结构化数据,
`show --json` 给出和 `GET /api/scenes/:id` 一样的完整内容)。**没有画元素的命令**——
理由同上,CLI 也不能拼 `elements`。

## 数据

`$APP_DATA_DIR/canvas.db`(SQLite,WAL 模式),三张表:

- `scenes`:一行 = 一张画布。`id`、`name`、`position`(排序用的浮点数)、
  `created_at`/`updated_at`
- `scene_data`:场景内容。`elements`(Excalidraw 元素数组,原样存不解释)、
  `app_state`(只留视图相关的少数几个键:滚动位置、缩放、背景色、网格、主题 ——
  当前工具、选中项、菜单开合这类本机 UI 状态不存)、`version`(乐观并发用的整数版本号)
- `scene_files`:场景里贴的图,按 `file_id` 存,和元素分表(图片远比元素大,
  列表页不该顺带读出来)

`$APP_DATA_DIR/runtime.json`:当前实例的 pid/port/url,CLI 靠它找到正在跑的服务、
并在自己改完后 ping 一下让开着的界面刷新。

## 怎么改

```bash
npm run setup      # 装依赖 + 构建界面(ui/dist)。Excalidraw 比较大,首次会慢,耐心等
npm run build      # 只重新构建界面
npm test           # node:test,覆盖存取/冲突/裁剪等 API 行为
npm run typecheck
```

后端(`src/`)改完即生效,下次进程起来自动用新代码;前端(`ui/`)改完要
`npm run build` 才会反映到 `/`。改了 API 形状或表结构,同步更新本文档。

## 当前状态端点

`GET /api/scenes` 按 `updated_at` 能看出最近改过哪张;`GET /api/scenes/:id`
给出该场景当下的完整视图状态(滚动位置、缩放、背景、网格)和全部元素。

**但服务端不知道用户当前正打开哪一张场景**——界面把「上次打开的场景」存在浏览器
自己的 localStorage 里,不上报服务端,SSE 广播也只说「变了」不说「谁在看」。
人说「把这张图上的某某改一下」时,agent 区分不出"这张"是哪张,只能:
拿最近更新的那张当猜测,或者直接问用户画布 id/名字。这是已知缺口,见摩擦清单。

## 版本或撤销

`scene_data.version` 是乐观并发用的版本号,存盘时带上读到的 version,
对不上就 409、不覆盖——防的是"两台设备同时改,后到的把先到的整块盖掉",
不是撤销历史。

**没有历史记录,也没有撤销**:`PUT` 是整份覆盖式存盘,`DELETE`/`prune` 直接删,
都不可逆。agent 动手改之前若拿不准,应该先 `GET` 一份当前内容留在自己手上——
存盘出问题时至少能报告丢了什么,让人工把内容找补回去。

## 危险标注

- `DELETE /api/scenes/:id`(CLI:`canvas rm`)——删场景,连带内容和图一起删,**不可逆**
- `POST /api/scenes/:id/prune`(CLI:`canvas prune`)——删掉没人引用的图,**不可逆**
- `PUT /api/scenes/:id` 传空的 `elements` 数组——会把这张画布清空。技术上人可以再画回来,
  但这一步操作本身**不可逆**,动手前最好先确认这确实是用户想要的
