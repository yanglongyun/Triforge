# Changelog

## Unreleased

- 作品详情与独立窗口恢复完整网页能力，移除 CSP、sandbox、Host 白名单和媒体 URL 限制；仅画布节点缩略图继续禁用 JavaScript。
- 画布首次进入固定为 100%，根节点位于视口横向 25%、纵向 50%；仅点击“适配”时显示整棵树，超大树最低可缩放至 4%。
- 修复静态资源缺失时 SPA fallback 错误返回 200 HTML 的问题：带扩展名的路径缺失时如实返回 404，避免升级后旧缓存页面加载已替换的 hash 资源导致应用静默挂死。
- 静态响应补充缓存策略：HTML 发 `Cache-Control: no-cache`，带内容 hash 的 assets 发 `max-age=31536000, immutable`。

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的结构。

## [Unreleased]

### Added

- 全新统一节点模型：每个节点只有标题、可选正文、顺序和一个可选 artifact，不再存在 branch、note、instruction 或 direction 概念。
- Artifact 类型支持 HTML、Markdown、SVG、图片、视频和音频。
- 稳定的 `<project-id>/<node-id>.<ext>` artifact 路径，可由 Agent 像源码一样直接编辑。
- 外部 SQLite 和 artifact 文件变化监听，直接操作后画布自动刷新。
- SQLite、文件系统、CLI 和 HTTP API 均为一等 Agent 接口。
- 支持简体中文、英语、日语、西班牙语和德语界面，可由 Agent 通过 CLI 持久化切换并实时更新已打开页面。
- 支持浅色、深色和跟随系统的持久化主题设置。

### Security

- 媒体凭据不进入 Ramify；媒体预览只开放必要的资源加载，仍禁用脚本、连接、表单和对象。

## [0.2.0] - 2026-07-11

### Added

- 一等 Agent CLI，支持项目、节点、批量事务和文件/stdin 输入。
- 批量节点事务、覆盖更新乐观并发、服务端节点序号和紧凑树。
- 健康检查、稳定错误码、项目重命名和节点元数据更新。
- 持久化运行实例身份、端口与地址，并安全处理过期 PID。
- 首页预留画布并将项目身份交接给外部 Agent。

### Security

- Host allowlist 防护、作品 CSP、iframe sandbox 和通用安全响应头。

## [0.1.0] - 2026-07-10

### Added

- 本地树状创意画布、HTML/Markdown/SVG/便签预览与 ZIP 导出。
- 随 Skill 发布的前端静态产物和后端单文件运行时。

[Unreleased]: https://github.com/yanglongyun/ramify/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/yanglongyun/ramify/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/yanglongyun/ramify/releases/tag/v0.1.0
