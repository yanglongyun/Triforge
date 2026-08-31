# Open-source release checklist

代码仓库已经包含许可证、第三方告知、贡献与安全政策、CI、依赖更新和 Issue/PR 模板。首次切换为公开仓库前，仓库所有者还需要完成以下 GitHub 设置。

## 必须完成

- [ ] 确认 `main` 最新 CI 在 Linux、macOS、Windows 全部通过。
- [ ] 在 Settings → Code security 中启用 **Private vulnerability reporting**，确认 `SECURITY.md` 中的私密报告链接可用。
- [ ] 为 `main` 设置分支保护或 Ruleset：要求 PR、要求 CI、禁止强制推送。
- [ ] 设置仓库描述，例如：`Local creative branching canvas driven by your own AI agent.`
- [ ] 设置 topics：`ai-agent`、`canvas`、`codex`、`creative-coding`、`skill`。
- [ ] 再次确认仓库历史和当前树不含密钥、数据库、日志或私人作品。
- [ ] 最后再将 Visibility 改为 **Public**。

## 首次发布

- [ ] 从干净 clone 执行 `node scripts/ramify.mjs setup` 和 `start`，确认无需 `npm install`。
- [ ] 按 `CHANGELOG.md` 创建 `v0.2.0` tag 和 GitHub Release。
- [ ] 在 Release 中说明 Node.js 22.5+ 要求、本地数据位置、默认监听地址和作品运行模型。
- [ ] 发布后从公开 URL 重新安装 Skill，完成一次创建、批量节点、文件写入、导出和停止流程。

仓库可见性、分支保护和安全功能属于 GitHub 管理操作，不应通过普通代码提交隐式更改。
