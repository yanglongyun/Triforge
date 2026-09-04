# Ramify workflow

Use Ramify as the presentation surface and act as the creator yourself. A project is one tree of uniform nodes. Every node has a title. A `text` node may have inline `content`; an artifact node uses `content` for its relative file path.

1. Start Ramify and retain the returned URL:

   ```bash
   node "<skill-directory>/scripts/ramify.mjs" start
   ```

2. Create a project and retain `id` and `rootId`:

   ```bash
   node "<skill-directory>/scripts/ramify.mjs" project create --prompt "用户的完整需求" --title "简短项目名"
   ```

3. Create the whole initial tree atomically. Title-only nodes express structure; `content` adds visible body text; `artifactType` creates an artifact placeholder:

   ```json
   {
     "nodes": [
       { "key": "a", "parentId": "<root-id>", "position": 0, "title": "方向 A", "content": "这个方向的简短说明" },
       { "key": "a-work", "parentKey": "a", "position": 0, "title": "作品 A", "artifactType": "html" },
       { "key": "b", "parentId": "<root-id>", "position": 1, "title": "方向 B" },
       { "key": "b-work", "parentKey": "b", "position": 0, "title": "作品 B", "artifactType": "html" }
     ]
   }
   ```

   ```bash
   node "<skill-directory>/scripts/ramify.mjs" node batch --project <project-id> --file batch.json
   ```

4. Author artifacts as normal files and complete placeholders:

   ```bash
   node "<skill-directory>/scripts/ramify.mjs" node complete <node-id> --artifact-type html --file artifact.html
   ```

### Visual balance

Keep the canvas easy to scan. Avoid attaching a large flat list of siblings to the root or any single node, because the layout becomes excessively tall. As a practical heuristic, when a parent would have more than about five direct children, introduce meaningful title-only grouping nodes—such as category, phase, model family, or iteration round—and nest the related items beneath them.

Do not add arbitrary hierarchy. Variants that users need to compare directly should remain siblings, and every grouping node should reflect the user's mental model. Prefer a shallow, balanced hierarchy over either a flat wall of cards or a deep one-child chain.

### Iteration topology

Keep creative rounds visible in the tree. When an existing project already has one batch and the user asks for another batch of alternatives, create a title-only round node and place the new artifact nodes beneath it. Never flatten repeated batches into one long sibling row.

```text
source or root
├── first-round artifact A
├── first-round artifact B
└── second round
    ├── artifact A
    ├── artifact B
    └── artifact C
```

For project-wide exploration, attach the round node to the root. For revisions of one chosen work, attach it to that work. Use a direct child only when producing one alternative rather than a batch.

### Archive-first revision (copy-then-edit)

Treat existing works as archives. When the user asks for an adjustment worth comparing — a different tone, a layout change, a reworked section — keep the source node untouched and put the adjusted version on a new child node, so both remain comparable on the canvas. Do not overcorrect: trivial point edits such as fixing one piece of text or changing one color value are best served by editing the source file in place, as are explicit overwrite requests and defects in an artifact you created earlier in the same turn. When unsure, derive.

For a small revision, do not re-author the artifact. Copy the source file, edit the copy locally, and complete the new node with it:

```bash
node "<skill-directory>/scripts/ramify.mjs" node batch --project <project-id> --file batch.json   # one placeholder child under the source node
cp "artifacts/<project-id>/<source-node>.html" revision.html
# apply targeted local edits to revision.html: string replacements, small patches
node "<skill-directory>/scripts/ramify.mjs" node complete <new-node> --artifact-type html --file revision.html
```

Copy-then-edit keeps unchanged content byte-identical, costs far less than regenerating, and confines regressions to the lines actually touched. Rewrite from scratch only when the revision genuinely replaces most of the artifact. The same rule applies on the SQLite surface: write the copied-and-edited file to the new node's stable path and insert the node row in one transaction.

5. For later edits, use the fastest surface:

   - Change one title or body with `node update`.
   - Revise a work archive-first: derive a new child node and copy-then-edit (see below). Edit `artifacts/<project-id>/<node-id>.<ext>` in place for trivial point edits (one text fix, one color value), explicit overwrites, and same-turn defect fixes.
   - Use one SQLite transaction for bulk moves, ordering, renames, or inserts.
   - Use the API for external integrations.

6. Read the compact tree after structural writes:

   ```bash
   node "<skill-directory>/scripts/ramify.mjs" project tree <project-id> --compact
   ```

7. Mark failed artifact generation with `node error`; ordinary nodes have no generation status.
8. Finish with a focused link: `<ramify-url>/projects/<project-id>?focus=<node-id-or-seq>`.

For image, video, or audio generation, keep provider credentials in the user's Agent environment. Attach only the result URL or matching data URI. Never put an API key in Ramify.
