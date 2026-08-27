# Workbench 仓库约定

给在本仓库工作的所有智能体与人。行为规范只写"会被违反的",不写显然的。

## 结构地图

- `ui/src/components/sidebar/` — 侧边栏宿主:活动栏三原生(会话/文件/应用)+ 钉住的应用面板
- `ui/src/components/apps/` — 应用运行时:AppFrame(iframe 桥 + 能力网关)与实例总线;**应用契约见 APP.md(唯一正典)**
- `ui/src/components/workspace/` — 标签分组与内容区;网页/终端活在 `PersistentPanelLayer`(常驻层),分组只是投影位置,**不要把有生命周期的资源挂回分组子树**
- `server/` — 分层:`api/`(路由分发)→ `service/`(业务规则)→ `repo/`(纯存取:fs / sqlite / git 命令);`runs/` 智能体运行轮;`tools/` 六工具
- `ai/` — 内核,与 AGENT 仓库双向同步:**改它必须两边同步**,不在日常迭代范围

## 后端三规则(渐进还债,不搞运动)

1. **谁动谁摘**:任何改动碰到还挂着 `// @ts-nocheck` 的服务端文件,顺手摘掉并补类型再提交。
   调用尚未脱敏的 repo 文件时,允许在边界处 `as any` 收口并留注释,对方脱敏后移除。
2. **加资源即拆路由**:下次给 `server/api/index.ts` 增加一组新端点时,顺势按资源拆成
   `api/<资源>.ts`,index 只留分发;在那之前不专门拆。
3. **repo / service 边界**:repo = 纯存取(文件系统、SQLite、git 命令),不发事件、不做业务判断;
   service = 业务规则 + 事件广播(`emit`)。新代码不要摇摆,旧的不一致随触碰修正。

## 通用

- 行为冻结的重构与功能开发分开提交,不混。
- typecheck(`npm run typecheck`)与打包是每次交付的守门;交付 = 替换桌面 `Workbench.app`,由用户自测。
- 拖拽类交互必须接 `lib/drag.ts` 的全局护栏(webview/iframe 会吞 pointerup)。
- 应用/面板相关改动先读 `APP.md`;发版与平台服务(更新/公告/遥测)见 iimos 仓库 `platform/`。
