<p align="center">
  <a href="./README.md">简体中文</a> · <strong>English</strong>
</p>

# Ramify

[![CI](https://github.com/yanglongyun/ramify/actions/workflows/ci.yml/badge.svg)](https://github.com/yanglongyun/ramify/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![Ramify live canvas: one prompt grows into a tree of directions, each branch a previewable artifact](media/ramify-canvas.png)

*On this canvas, a single brief — a "Kimi K3 vs Claude Fable 5" landing page — branched from 3 directions into 9 variants, then merged into a final one. The whole process is visible and revisitable.*

Ramify is a local creative canvas where your own AI Agent grows ideas into a visual tree. Each node has a title, may contain text, and may carry an HTML, Markdown, SVG, image, video, or audio artifact.

- Use Codex, Claude Code, or another Agent you already have—no built-in model or extra model API key
- Keep prompts, nodes, and artifacts on your machine
- Run the bundled release without installing frontend or backend dependencies

## Contents

- [🌱 Install for your Agent](#-install-for-your-agent)
- [🌿 Start creating](#-start-creating)
- [🌳 How Ramify works](#-how-ramify-works)
- [🍃 Local data and artifact execution](#-local-data-and-artifact-execution)
- [🪴 Development](#-development)
- [License](#license)

## 🌱 Install for your Agent

Send this to your Agent:

> Install the Ramify Skill from https://github.com/yanglongyun/ramify, read its `SKILL.md`, and complete the setup.

The Agent will handle setup, startup, and the appropriate interface for each task.

## 🌿 Start creating

After installation, tell your Agent:

> Use the Ramify Skill to create a new design project. Requirement: ...

To open Ramify manually, use Node.js 22.5 or newer:

```bash
git clone https://github.com/yanglongyun/ramify.git
cd ramify
node scripts/ramify.mjs setup
node scripts/ramify.mjs start
```

`start` prints the canvas URL, normally [http://127.0.0.1:9519](http://127.0.0.1:9519). Normal Skill users do not need `npm install`.

Ask your Agent to use light mode, dark mode, or the system theme whenever needed. Open canvas pages update immediately.

The interface supports Simplified Chinese, English, Japanese, Spanish, and German. Ask your Agent to switch languages at any time; the setting persists and open pages update immediately.

## 🌳 How Ramify works

Every item on the canvas is the same kind of node:

- **Title** — the basic mind-map branch
- **Content** — optional plain-text detail
- **Artifact** — optional HTML, Markdown, SVG, image, video, or audio creation

The tree stays simple while the Agent can choose the fastest route underneath: SQLite for structure, files for artifacts, CLI for common actions, or HTTP API for integrations. Those implementation details live in [`SKILL.md`](SKILL.md) and [`references/`](references/) so users do not have to learn Agent-facing commands.

## 🍃 Local data and artifact execution

Ramify stores user data outside the repository:

- macOS: `~/Library/Application Support/Ramify/`
- Windows: `%APPDATA%\Ramify\`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/ramify/`

Back up the complete data directory to preserve both the tree and its artifact files.

Ramify listens on all interfaces by default while the CLI prints the local URL. Canvas thumbnails do not execute JavaScript; detail previews and standalone artifact windows run as unrestricted web pages with scripts, external resources, and network access. Provider API keys remain in the user's Agent environment and must never be stored in Ramify. See [`SECURITY.md`](SECURITY.md).

## 🪴 Development

```bash
cd app
npm ci
npm run dev
```

Before committing, run `npm run check`. See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md), and [`CHANGELOG.md`](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Sider AI. Bundled dependency licenses are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
