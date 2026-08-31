# Ramify local API

Default base URL: `http://127.0.0.1:9519`. Use the URL returned by `node "<skill-directory>/scripts/ramify.mjs" start`.

JSON bodies are limited to 10 MiB. Ramify has no account or remote-authentication layer.

## Settings

- `GET /api/settings` — read persistent application settings.
- `PUT /api/settings/theme` with `{ "theme": "light" | "dark" | "system" }` — switch the canvas theme and notify open pages immediately.
- `PUT /api/settings/locale` with `{ "locale": "zh-CN" | "en" | "ja" | "es" | "de" }` — switch the interface language and notify open pages immediately.

Agents should normally use the CLI `theme` and `language` commands instead of calling these endpoints directly.

## Projects

- `GET /api/projects` — list projects.
- `GET /api/projects/version` — read `{ "version": string }`, a lightweight marker (project count + latest `updated_at`) for polling the list without refetching it every time.
- `POST /api/projects` with `{ "prompt": string, "title"?: string }` — create a project and root node; returns `rootId`.
- `PUT /api/projects/:projectId` with `{ "title": string, "expectedUpdatedAt"?: string }` — rename a project.
- `GET /api/projects/:projectId/tree` — read the ordered tree.
- `GET /api/projects/:projectId/version` — read `{ "version": string }`, the project's `updated_at` (it is bumped on every node change too), for polling a single tree without refetching it every time.
- `DELETE /api/projects/:projectId` — delete a project, its nodes, and artifact files.

## Nodes

- `POST /api/projects/:projectId/nodes` — create a node with `{ "parentId": string, "position"?: number, "title": string, "content"?: string, "artifactType"?: ArtifactType, "artifact"?: string }`.
- `POST /api/projects/:projectId/nodes/batch` — create up to 100 nodes atomically. Each item needs a unique `key` and either `parentId` or a preceding `parentKey`.
- `PUT /api/nodes/:nodeId` — update `{ "title"?, "content"?, "parentId"?, "position"?, "expectedUpdatedAt"? }`. Passing `content` converts the node to `text`; `null` makes it title-only.
- `DELETE /api/nodes/:nodeId` — delete a non-root node and its descendants.
- `GET /api/nodes/:nodeId/content` — read `{ "content": string | null }`.

`ArtifactType` is `html | markdown | svg | image | video | audio`.
`content` and `artifactType` are mutually exclusive: text is inline, while an artifact node stores a generated file path internally.

## Artifacts

- `PUT /api/nodes/:nodeId/artifact` with `{ "artifactType": ArtifactType, "artifact": string, "expectedUpdatedAt"?: string }` — create or replace an artifact.
- `PUT /api/nodes/:nodeId/artifact/error` with `{ "error": string, "expectedUpdatedAt"?: string }` — mark artifact generation as failed.
- `DELETE /api/nodes/:nodeId/artifact` — delete the artifact file and turn the node into a title-only `text` node.
- `GET /api/nodes/:nodeId/artifact/source` — read the source representation.
- `GET /api/nodes/:nodeId/artifact` — stream stored bytes with the real MIME type.
- `GET /api/nodes/:nodeId/html` — read unrestricted preview HTML.

Media artifact input may be any source URL supported by the browser or a matching data URI. API keys are never artifact input.

## Change detection and concurrency

- There is no push/streaming endpoint. Clients poll the `version` endpoints above (about once a second) and only refetch the list or a tree when the marker changes; direct SQLite or artifact-file edits are picked up by a background file watcher that bumps the same markers, so polling still sees them.
- Tree nodes expose `id`, `project_id`, `parent_id`, `position`, `type`, `title`, `content`, timestamps, ordered `seq`, and file-derived `artifact_revision`.
- Send `expectedUpdatedAt` for optimistic API writes. Stale writes return `409 VERSION_CONFLICT`.

JSON errors use `{ "error": string, "code": string }`.

The API is one equal interface, not a required gateway. Agents may directly execute SQL against `ramify.db` and directly edit stable artifact files. See [data-model.md](data-model.md).
