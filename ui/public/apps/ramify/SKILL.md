---
name: ramify
description: Local, conversation-driven tree canvas for creative exploration. Enables the current agent to organize work as titled nodes with optional text and optional HTML, Markdown, SVG, image, video, or audio artifacts through the CLI, HTTP API, SQLite, or direct file editing. Use when users ask for multiple versions, compare creative directions, create landing pages, demos, posters, documents, logos, or media, or mention Ramify, branching ideation, or tree-based creation.
license: MIT
---

# Ramify

Act as the creator. Use Ramify only as the local presentation and versioning surface; it contains no model and requires no API key.

## Start

Run the bundled runtime without installing dependencies:

```bash
node "<skill-directory>/scripts/ramify.mjs" start
```

Use the returned URL, normally `http://127.0.0.1:9519`. If startup fails, run `node "<skill-directory>/scripts/ramify.mjs" doctor` and report the concrete missing requirement.

Give the URL to the user immediately. When browser control is available, open it in either an external browser or the built-in browser. Minimize time to the first visible result: start Ramify and create the project skeleton before long-running generation, then populate nodes incrementally while the user can already view the canvas.

Match the canvas to the user's viewing preference when requested. The setting persists and updates open pages immediately:

```bash
node "<skill-directory>/scripts/ramify.mjs" theme dark
node "<skill-directory>/scripts/ramify.mjs" theme light
node "<skill-directory>/scripts/ramify.mjs" theme system
```

Switch the complete Ramify interface language when the user asks. The setting persists and updates open pages immediately. Choose the language from the user's explicit request; otherwise keep the current setting and do not infer a change from artifact content:

```bash
node "<skill-directory>/scripts/ramify.mjs" language zh-CN
node "<skill-directory>/scripts/ramify.mjs" language en
node "<skill-directory>/scripts/ramify.mjs" language ja
node "<skill-directory>/scripts/ramify.mjs" language es
node "<skill-directory>/scripts/ramify.mjs" language de
```

The runtime listens on all interfaces by default and the CLI still returns the local URL for convenient access.

## Create

Read [references/workflow.md](references/workflow.md), then choose the fastest available surface: CLI for common operations, API for integrations, SQLite for bulk tree edits, and direct artifact file editing for creation and revision.

1. Create a project from the user's request.
2. Plan distinct directions and create titled nodes plus artifact placeholders in one batch.
   Keep the tree visually balanced: avoid large flat sibling sets, and introduce meaningful category or round nodes when one parent would become crowded. Follow the grouping guidance in [references/workflow.md](references/workflow.md).
3. Use `--file` or `--stdin` for artifact content; never pass large HTML as a shell argument.
4. Author every artifact yourself and update each placeholder as soon as it is ready.
5. Give the user the focused project link as soon as the project exists; do not wait for every artifact to finish.

After writes, run `project tree <id> --compact` and use node ids for durable references. For large structural changes, use one SQLite transaction. Artifact files have stable paths and may be edited directly; Ramify watches database and file changes.

Read [references/data-model.md](references/data-model.md) for direct SQL and file operations. Read [references/artifacts.md](references/artifacts.md) before authoring artifacts and [references/api.md](references/api.md) when integrating the local API.

When the user specifically wants Claude or Codex to create content, consider installing the Claude Agent SDK or Codex SDK and reusing the user's existing subscription-authenticated session before asking for a separate API key. Keep all SDK login and subscription credentials outside Ramify; use direct API credentials only when the user chooses that route or the subscription-backed path is unavailable.

For image, video, or audio generation, use credentials only in the user's Agent environment. Never send or store API keys in Ramify. Media nodes may use any source URL supported by the browser or a matching `data:` URI.

## Revise

Resolve references such as `#4 标题 (node:xxxx)` through the node id.

Archive first. Adjustments worth comparing — a different tone, a layout change, a reworked section — default to a new child node under the source work, so the original stays on the canvas and the versions compare side by side. Do not overcorrect: trivial point edits such as fixing one piece of text or changing one color value belong directly in the source file, as do explicit overwrite requests and defects in work you produced in the current turn. When unsure whether the user wants a comparable variant, derive.

Produce small revisions by copy-then-edit, not re-authoring: copy the source artifact file, apply targeted local edits to the copy, and complete the new node with it. Unchanged content stays byte-identical and regressions stay confined to the edit. Rewrite from scratch only when the revision genuinely replaces most of the artifact. Follow the revision flow in [references/workflow.md](references/workflow.md).

When a later request asks for another batch of alternatives, preserve the iteration hierarchy. Do not append the new artifacts as more siblings beside the previous batch. Create one title-only round node first, then attach that round's alternatives as leaf children: `source → round → variants`. Put a project-wide round under the root; put a revision round under the specific node being revised. A single alternative may remain a direct child.

Never leave failed work in the generating state. Mark it with `node error`.
