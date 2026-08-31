# 参与贡献

感谢你改进 Ramify。提交代码前，请先在 Issue 中说明较大的功能或架构调整；小型修复可以直接提交 Pull Request。

## 开发环境

- Node.js 22.5 或更新版本
- npm（使用仓库中的 `package-lock.json`）

```bash
git clone https://github.com/yanglongyun/ramify.git
cd ramify/app
npm ci
npm run dev
```

开发模式下，后端监听 `http://127.0.0.1:9519`，Vite 前端位于 `http://127.0.0.1:5173`。如果已启动发布版 Ramify，请先在仓库根目录执行 `node scripts/ramify.mjs stop`。

## 提交前检查

```bash
cd app
npm run check
git diff --exit-code -- dist
```

`app/dist/` 是 Skill 用户无需安装依赖即可运行的发布产物，因此源码变化必须同时提交重新构建后的产物。不要提交数据库、日志、运行状态、API Key 或其他个人数据。

运行时依赖变化还必须更新 `THIRD_PARTY_NOTICES.md`；`npm run check` 会验证锁定版本、许可证和告知文件保持一致。

## 设计约束

- Ramify 不内置模型，不接收或保存 Agent 服务的 API Key。
- 后端路由使用路径模板，不在业务代码中添加路由正则。
- 删除废弃实现，不保留无明确期限的兼容层。
- 大型作品内容通过文件或 stdin 进入 CLI。
- SQLite 保存统一节点的标题、正文、顺序和 artifact 元数据；HTML、Markdown、SVG 和媒体位于数据目录的 `artifacts/`。
- Artifact 使用稳定的 `<project-id>/<node-id>.<ext>` 路径，并允许 Agent 像源码一样直接编辑。
- CLI、HTTP API、直接 SQLite 和直接文件编辑都是一等接口；不要把便利层变成能力限制。
- 写请求失败后先读取当前树再决定是否重试；所有覆盖更新应支持乐观并发。
- 只有画布节点缩略图使用空 `sandbox` 并禁止脚本；详情预览和独立窗口保持完整网页能力，不添加 CSP 或 sandbox。

新增行为需要测试。修复缺陷时，优先加入能够复现问题的回归测试。

## Pull Request

请保持一次 PR 只解决一个主题，并在描述中写明：

- 用户可见的变化
- 设计选择及安全影响
- 已执行的验证命令
- 是否更新了 `app/dist/` 和文档

安全漏洞不要提交公开 Issue 或 PR，请遵循 [SECURITY.md](SECURITY.md)。
