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

## 补记:CPU 空转事故(同版本内修复)

首次实测(智能体跑 cdp 测试)后,四个进程一起烧:渲染 90% / 网络 Helper 55% /
主进程 12% / sidecar 15%,run 结束后依旧。取证(/api/runs 空、消息尾正常、逐进程采样)
定位到 **「fetch+渲染」死循环**,0.2.0 取名功能带入:

- `updateNodeTab` 无条件造新 state(哪怕补丁无变化、哪怕没命中标签);
- App 的 syncTitles effect 把 `tabGroups.activeTab` 放进依赖;
- 于是:listAgents 回来 → set() → setState(必然新引用)→ activeTab 引用变 →
  effect 重跑 → 再 listAgents → …… 全速循环,四个进程的占用全部对上。
  只在**开着对话标签**时触发 —— 0.2.0 没被发现,首次真实测试就踩响。

修法(和 0.2.0 的 useSocket 病根同一门课:**引用稳定性**):
- `updateNodeTab` / `updateWebTab` 无变化返回 prev(不造渲染);`pinPreviewTab` 同款守卫;
- syncTitles effect 改用 activeTabRef 读当前标签,依赖收窄为 [socket, updateNodeTab]。

验证:浏览器里复现原触发场景(开对话标签静置 4s),fetch 计数 0(修复前每秒几十发)。

顺手修掉实测暴露的两个 cdp 真 bug:
- **screenshot 超时**:display:none 的 <webview> 画不出图,capturePage 挂死 ——
  截图前广播 arbor:web-activate 把目标标签翻到前台(用户正好看得见 agent 在拍什么),等 450ms 再拍;
- **navigate 误报 ERR_ABORTED**:首次加载被重定向/二次导航顶掉时 loadURL 会 reject,
  页面其实在正常加载 —— 识别为成功返回。

## 已知限制 / 下一步

- cdp 的 click/type 走 executeJavaScript(DOM 语义),不是 Input.dispatch 的真实
  输入事件;复杂站点(canvas、防自动化)可能不吃 —— 需要时上 webContents.debugger(真 CDP);
- screenshot 只落文件不进上下文,模型看不到画面;多模态(input_image)是下一步;
- 运行中的智能体收到新邮箱消息仍是下轮才带上;/api/messages 未分页(同 0.2.0)。
