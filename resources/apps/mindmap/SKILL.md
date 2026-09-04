---
name: mindmap
description: Local, conversation-driven interactive mind maps using the final built-in ChatNext Mindmap canvas. Use when users ask to create, outline, visualize, organize, revise, or compare hierarchical ideas as a mind map, concept map, topic tree, brainstorming tree, study map, article map, project decomposition, or mention Mindmap or 思维导图. Provides a local browser canvas plus CLI and JSON batch operations for agent-authored maps.
---

# Mindmap

Act as the map author. Use the bundled local app as the presentation and editing surface; it has no model and needs no API key.

## Start

Run the standalone runtime:

```bash
node "<skill-directory>/scripts/mindmap.mjs" start
```

Give the returned loopback URL to the user immediately. Keep the default loopback binding; do not expose it publicly. If startup fails, run `doctor` and report the concrete failure.

## Create

Read [references/workflow.md](references/workflow.md), then:

1. Create a map and retain its `id` and root topic id.
2. Draft a balanced hierarchy. Put broad categories directly under the root and details below them.
3. Create the initial map atomically with `map import --file`; use stable `key` and `parentKey` references inside the JSON.
4. Run `map tree <id> --compact` after structural writes.
5. Return a focused link: `<url>/?map=<map-id>`.

Prefer `--file` or `--stdin` for batch JSON. Do not pass large payloads as shell arguments.

```bash
node "<skill-directory>/scripts/mindmap.mjs" map import --file map.json
node "<skill-directory>/scripts/mindmap.mjs" map tree <id> --compact
```

## Revise

Resolve map and topic ids from `map list` and `map tree`. Use `topic update` for a narrow edit, `topic add` for an addition, and `topic delete` only when the user intends to remove that entire subtree. To move an existing branch elsewhere, use `topic update <id> --parent <new-parent-id>`; the whole subtree follows and nothing is retyped.

Preserve useful structure during revisions. For an alternative decomposition, add a sibling branch rather than overwriting the original unless the user explicitly asks for replacement.

The browser supports keyboard-first canvas interaction: Tab creates a child, Enter creates a sibling, arrow keys navigate, and branches can be collapsed and zoomed. Dragging a card onto another card reparents it, subtree included; the receiving card highlights and expands if it was collapsed. Use the top-right Canvas/Outline switch to read or edit the same topics as a hierarchical outline. In Outline mode, use Copy Markdown to copy the complete tree as a Markdown heading and nested list, including collapsed branches.

## Provenance

The visual app under `assets/client/apps/mindmap` is based on ChatNext commit `353074d73844c8849f133d259416b8a62702659c`, the parent of the commit that removed built-in apps. The standalone skill replaces the deleted ChatNext SDK and persistence host and adds an outline view.
