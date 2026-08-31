---
name: mindmap
label: 导图
description: 键盘优先的思维导图:Tab 子主题、Enter 同级、方向键导航,可折叠可缩放。
---

# 导图

**用户用键盘画,你用 SQL 画。** 「把这篇文章整理成导图」这类活,直接往表里插行就行,
界面下次打开就是新的样子。

## 数据

在**系统库**里(和任务、计划、页面同一个库),不用填 `db`:

```sql
app_mindmap_maps(
  id, name, created_at, updated_at        -- updated_at 决定列表顺序
)

app_mindmap_topics(
  id,
  map_id,      -- 属于哪张导图
  parent_id,   -- NULL = 根主题,一张导图有且仅有一个
  text,
  side,        -- 'left' / 'right',**只对根的直接子主题有意义**
  sort_order,  -- 同一父下的排序
  collapsed,   -- 0/1,折叠这一支
  created_at, updated_at
)
```

删导图会级联删掉它的主题,删主题会级联删掉整棵子树 —— 外键管着,不用一层层删
(`PRAGMA foreign_keys = ON` 由内核保证)。

## 画一张导图

先建导图和根主题。`INSERT ... RETURNING id` 可以直接拿到新 id:

```bash
curl -s localhost:$CHATNEXT_PORT/api/sql -H 'content-type: application/json' \
  -d '{"query":"INSERT INTO app_mindmap_maps (name, created_at, updated_at) VALUES (?, ?, ?) RETURNING id","params":["读书笔记",1786000000000,1786000000000]}'

curl -s localhost:$CHATNEXT_PORT/api/sql -H 'content-type: application/json' \
  -d '{"query":"INSERT INTO app_mindmap_topics (map_id, parent_id, text, sort_order, created_at, updated_at) VALUES (?, NULL, ?, 0, ?, ?) RETURNING id","params":[1,"中心主题",1786000000000,1786000000000]}'
```

再挂子主题。**根的直接子主题要填 `side`,左右大致均分**,导图才不会偏一边。
更深的层不用管 `side`(跟着祖先走),只要 `parent_id` 和 `sort_order`。

## 源码

```
src/
  index.tsx            React 外壳:列表 ↔ 画布两个视图
  pages/{Home,Board}.tsx
  components/Toolbar.tsx
  hooks/useMindmapEngine.ts
  lib/engine.ts        **画布引擎** —— 布局、渲染、动画、交互全在这儿,
                       纯原生 DOM + SVG,一行 React 都没有
  lib/maps.ts          数据层,全部经 SDK 的 sql()
  styles/base.css      这个应用自己的样式底座(不是宿主发的共享表)
  styles/globals.css
```

改完要重新构建:`node scripts/build-apps.mjs mindmap`。
**浏览器拿到的是 `dist/`**,直接改那里等于没改。

## 约定

- 一张导图**有且仅有一个**根主题,建导图时一并创建,不能删。
- `side` 只在根的直接子主题上有意义,别往深层写。
- 引擎自己管 DOM,不要试图从 React 那边操作画布里的节点。
