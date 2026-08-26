# Arbor 0.3.0 — 六个工具,一个不多;仓库迁至 Workbench

## 仓库迁移(重大决定)

开发从 arbor 仓库平移到本仓库(Workbench):arbor@d04e480(0.2.0 全量)整树
`git archive` 进来,落在 GitHub 初始提交之上;arbor 仓库随后用一个 revert 提交把
工作树回滚到 ea3de54(0.2.0 之前),**历史在 arbor 完整保留,状态回到从前** ——
0.2.0 起的故事在那边可考,往后的开发在这边继续。产品名不变,仍是 Arbor。

## 工具体系重梳:11 → 6

`bash / read / edit / write / cdp / agent`。这套命名恰是模型被训练得最熟的协议,
零学习成本;每个工具仍必填 summary(界面可见)。

| 新 | 吃掉谁 | 说明 |
|---|---|---|
| **bash** | shell + run_process / read_process_output / list_processes / stop_process | `background:true` 转进程注册表:返回 id / pid / **日志文件路径**;读日志用 read/tail,停止用 `kill <pid>` —— 不需要任何附加工具就闭环。长驻命令忘了 background 仍会被自动识别转后台。 |
| **read / edit / write** | read_file / edit_file / write_file | 原样收窄命名 |
| **cdp** | web_fetch(退役) | 操作工作区里的网页标签(真浏览器、真登录态):list / open / navigate / back / read / js / click / type / screenshot |
| **agent** | create_agent + call_agent | 带 agent_id 发消息;带 title 派生新智能体并派活。异步邮箱语义不变 |

## cdp 的架构:宿主就是 UI 渲染进程

原设想「server → Electron 主进程 → webContents」要给主进程加 ws 客户端与桥;
实际上 **`<webview>` 元素在渲染进程里原生就有** `executeJavaScript / capturePage /
loadURL / getWebContentsId` —— 宿主就是 UI 自己,零新依赖,`desktop/main.js` 一行未动:

- `ui/src/lib/webviewHost.ts`:wcId → 元素注册表 + `useCdpHost(socket)`
  (声明宿主身份、应答 `cdp_request`、重连后触发全体重注册);
- WebPanel 在 dom-ready 把 `getWebContentsId()` 注册到本地与 server
  (`web_tab_register`,标题/地址变更走 `web_tab_update`,卸载出册);
- `server/browserHost.ts`:标签注册表 + 在途请求表;指令广播出去,
  **拥有该标签的窗口**应答(多窗口互不打架),超时按操作类型给;
- `open`:server 广播 `web_tab_open{url, token}` → UI 开标签 → webview 注册时带
  token 兑现 —— 智能体开的每个页面都是用户界面里**看得见**的真实标签;
- 纯浏览器/dev(无 Electron)下 cdp 诚实报错;screenshot 落成工作目录里的 PNG
  文件(进树,用户可点开;喂给模型的 input_image 留到多模态版本)。
- onUpdate 必须是恒定引用(useCallback):注册 effect 依赖它,内联箭头会让
  webview 每渲染掉册一次 —— 这类「引用抖动毁事件」与 0.2.0 的 useSocket 病根同源。

## 进程注册表的配套改动(server/processes.ts)

- 输出同时落 `$ARBOR_HOME/logs/processes/<id>.log`(bash background 的文件视角);
- 被信号杀掉(包括模型 `kill <pid>`)算 **stopped**,不再误报 error;
- 进程面板、端口/preview URL 探测、`process_changed` 广播全部原样保留 ——
  工具表面从 4 个并成 1 个,底下的账一分不少。

## 兼容与留痕

- UI 的工具行渲染新旧两套名字都认(0.2.0 前的历史对话不破相);
- agent / cdp 永不进「执行了 N 步」分组 —— 多智能体与浏览器操作是招牌,永远单独可见;
- system prompt 全文重写为六工具口径。

## 验证(2026-08-26)

- 工具层直调冒烟:六定义装配、bash 前台/后台、日志文件落盘含输出、外部 kill 后
  状态 stopped、read/edit/write、cdp 无宿主诚实报错、agent 参数校验 —— 全过;
- 假宿主回路:list / read / js 错误透传 / 不存在标签 / open(token 兑现)/
  screenshot 落文件 / 客户端断开自动出册 —— 全过(顺手修掉 open 返回形状 bug);
- `npm run typecheck` 全绿;server 单文件重打包后独立拉起,health / processes 正常。

## 已知限制 / 下一步

- cdp 的 click/type 走 executeJavaScript(DOM 语义),不是 Input.dispatch 的真实
  输入事件;复杂站点(canvas、防自动化)可能不吃 —— 需要时上 webContents.debugger(真 CDP);
- screenshot 只落文件不进上下文,模型看不到画面;多模态(input_image)是下一步;
- 运行中的智能体收到新邮箱消息仍是下轮才带上;/api/messages 未分页(同 0.2.0)。
