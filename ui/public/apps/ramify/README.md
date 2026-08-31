<p align="center">
  <strong>简体中文</strong> · <a href="./README.en.md">English</a>
</p>

# Ramify

[![CI](https://github.com/yanglongyun/ramify/actions/workflows/ci.yml/badge.svg)](https://github.com/yanglongyun/ramify/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![Ramify 真实画布：一个想法发散成一棵创意树，每个分支都是一版可预览的方案](media/ramify-canvas.png)

*在 Ramify 画布上，「Kimi K3 vs Claude Fable 5 对比落地页」从 3 个方向发散成 9 个方案，再合并定稿——整个过程可视化、可回溯。*

Ramify 是一个由你自己的 Agent 驱动的创意发散画布。能够让 Agent 生成多个不同方向的方案，在实时画布中一目了然地查看、比较，再选中其中一版继续迭代打磨，直至心中所想。

## 🚀 一句话安装

把下面这句话直接发给你的 Agent：

 > 请从 https://github.com/yanglongyun/ramify 安装 Ramify Skill，阅读仓库中的 `SKILL.md`，并按说明完成设置。

Agent 会自行完成设置、启动，并为不同任务选择合适的操作方式。

## 🌿 开始创作

安装后，告诉你的 Agent：

> 使用 ramify skill 创建新的设计项目，需求为：xxx。

Agent会启动画布并开始创作，你可以在浏览器打开画布实时查看agent的工作情况： [http://127.0.0.1:9519](http://127.0.0.1:9519)

需要切换显示主题时，直接告诉 Agent 使用浅色、深色或跟随系统即可；已打开的画布会立即更新。

界面支持简体中文、English、日本語、Español 和 Deutsch。直接告诉 Agent 切换语言即可；设置会保留，已打开的页面会立即更新。

## 🌳 它能够做什么

凡是需要**先看几个方向、比较之后再决定**的任务，都适合放进 Ramify：

- **落地页与产品官网**——先生成不同的首屏、叙事结构和视觉风格，选中方向后继续打磨，再交给 Agent 正式开发。
- **交互 Demo 与产品原型**——把想法直接做成可以点击的 HTML Demo，比较信息架构、操作流程和界面方案，而不只是阅读文字描述。
- **文案与内容传播**——同时发散产品介绍、README、发布文章、推文、小红书笔记、广告语和活动文案，保留不同语气与传播角度。
- **品牌与视觉探索**——比较 Logo、海报、插画、配色、版式和整套视觉方向，让相近方案沿原分支继续演变。
- **文档与知识创作**——制作简历、教案、课程大纲、产品方案、研究报告和结构化文档，在树上同时查看框架、章节与多个成稿版本。
- **图片、视频与音频**——让 Agent 调用你选择的模型或服务生成媒体内容，并将不同方向挂回创作树中统一比较；所需 Key 或订阅凭据始终留在你自己的 Agent 环境中。

典型工作流：让 Agent 先生成三个明显不同的方向 → 在画布上查看真实结果 → 选中最接近的一版 → 让 Agent 从该节点继续分叉或修改。

## 🍃 本地数据

Ramify 将用户数据保存在仓库之外：

- macOS：`~/Library/Application Support/Ramify/`
- Windows：`%APPDATA%\Ramify\`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/ramify/`

备份时请复制完整数据目录，以同时保留创作树和作品文件。

Runtime 默认监听 `0.0.0.0:9519`，CLI 会打印本机访问地址。画布节点缩略图不运行 JavaScript；右侧详情和独立窗口按照完整网页运行，支持脚本、外部资源和网络请求。


## 许可证

[MIT](LICENSE) © 2026 Sider AI。随发布 bundle 分发的依赖许可见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
