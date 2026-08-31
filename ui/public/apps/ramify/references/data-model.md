# Data model and direct Agent access

Ramify deliberately exposes SQLite and the artifact directory as first-class interfaces alongside CLI and HTTP.

## Data directory

- macOS: `~/Library/Application Support/Ramify/`
- Windows: `%APPDATA%\Ramify\`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/ramify/`

```text
Ramify/
├── ramify.db
└── artifacts/
    └── <project-id>/
        └── <node-id>.<ext>
```

## Node schema

```sql
nodes (
  id,
  project_id,
  parent_id,
  position,
  type,
  title,
  content,
  created_at,
  updated_at
)
```

Every row is the same kind of mind-map node:

- `title` is required.
- `type` is `text`, `html`, `markdown`, `svg`, `image`, `video`, `audio`, or `error`.
- For `text`, `content` is optional inline body text. `NULL` means a title-only node.
- For an artifact type, `content` is its relative file path. `NULL` means generation is in progress.
- For `error`, `content` is the error message.
- `parent_id` and `position` define the ordered tree.
- The root is only the node whose `parent_id` is `NULL`.

Title-only nodes also express iteration structure. For a later batch of variants, insert one round node and make the new artifacts its leaf children instead of appending every generation as siblings at the same level. This keeps both chronology and comparison groups visible without adding a separate node type.

## Direct SQL

Agents can use the system SQLite CLI directly:

```bash
sqlite3 "$HOME/Library/Application Support/Ramify/ramify.db"
```

Bulk tree edits belong in one transaction:

```sql
BEGIN IMMEDIATE;

UPDATE nodes
SET parent_id = 'new-parent', position = 0,
    updated_at = strftime('%Y-%m-%d %H:%M:%f','now')
WHERE id = 'node-id';

UPDATE nodes
SET position = position + 1
WHERE parent_id = 'new-parent' AND id <> 'node-id';

COMMIT;
```

Generate compatible ids with `lower(hex(randomblob(6)))`. Ramify observes database/WAL changes and refreshes connected canvases.

## Direct artifact editing

Artifact paths are stable, so an Agent may edit them exactly like source code:

```bash
$EDITOR "<data-dir>/artifacts/<project-id>/<node-id>.html"
```

The service observes file changes, invalidates preview revisions, and broadcasts a canvas refresh. When changing an artifact format through direct file operations, update `type` and the relative path in `content` together in SQLite. MIME is derived from the type and file extension.

In-place edits suit trivial point edits (one text fix, one color value), explicit overwrites, and same-turn defect fixes. For an adjustment worth comparing against the original, revise archive-first instead: copy the source file to a new node's stable path, apply targeted edits to the copy, and insert the new node row in the same transaction, keeping the original comparable on the canvas. See the revision flow in [workflow.md](workflow.md).

## Choosing an interface

| Work | Best interface |
|---|---|
| Inspect or restructure the whole tree | SQL |
| Create or revise artifact source | Direct file editing |
| Common single-node operations | Bundled CLI |
| Integrations and remote processes | HTTP API |
| Visual verification | Canvas |

These are equal interfaces. CLI and API are conveniences, not restrictions.
