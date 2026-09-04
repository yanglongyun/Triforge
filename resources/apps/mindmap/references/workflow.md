# Mindmap workflow

## Import format

Create a complete map atomically:

```json
{
  "name": "项目规划",
  "root": "项目规划",
  "topics": [
    { "key": "goal", "parentKey": "root", "text": "目标", "side": "right", "position": 0 },
    { "key": "users", "parentKey": "goal", "text": "用户价值", "position": 0 },
    { "key": "delivery", "parentKey": "root", "text": "交付", "side": "left", "position": 1 }
  ]
}
```

`root` is the root topic text. The reserved `parentKey` `root` points to it. Every other topic needs a unique `key`, an existing `parentKey`, and non-empty `text`. Root children may set `side` to `left` or `right`; deeper topics inherit their root branch side.

## Layout guidance

- Keep the root short and specific.
- Balance root children across left and right.
- Prefer 3–7 children per topic; group crowded siblings under meaningful categories.
- Keep sibling labels parallel in grammar and level of abstraction.
- Use `position` to encode reading order.
- Do not add decorative hierarchy that carries no meaning.

## CLI

```text
mindmap.mjs start|stop|doctor
mindmap.mjs map list
mindmap.mjs map create --name <name> [--root <text>]
mindmap.mjs map import (--file <path>|--stdin)
mindmap.mjs map tree <map-id> [--compact]
mindmap.mjs map rename <map-id> --name <name>
mindmap.mjs map delete <map-id>
mindmap.mjs topic add --map <id> --parent <topic-id> --text <text> [--side left|right] [--position <n>]
mindmap.mjs topic update <topic-id> [--text <text>] [--collapsed true|false] [--side left|right] [--position <n>] [--parent <topic-id>]
mindmap.mjs topic delete <topic-id>
```

Data is stored in the platform application-data directory. Override it with `MINDMAP_DATA_DIR`; override the port with `MINDMAP_PORT`.
