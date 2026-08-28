# Widget 规范 v0.2

> 轻量化路线的应用形态:活动栏小组件。零构建、目录即安装、数据自持。
> 设计原则全部来自 workerd 那轮探索的教训(见《workerd 应用机制 · 技术路线沉淀》第 6 节)。
> 状态:v0.2 已定案并实施,待定项在文末「开放问题」。

---

## 0. 三条不可动摇的约束

这三条是整份规范的地基,其余细节都可以谈:

1. **零构建** —— 所有文件浏览器能直接加载(ESM / 原生 CSS / 相对路径)。没有打包步骤、没有 node_modules、没有编译。
2. **目录即安装** —— 目录存在 = 装好了;删目录 = 卸载。没有安装器、没有注册表文件、没有「重启生效」。
3. **数据归组件** —— 每个组件一个自己的 SQLite 文件,自建 schema。宿主不定义领域。

> 第 3 条是「AI 能无限造组件」的前提。宿主一旦定义表结构,宿主就成了瓶颈,
> AI 只能造你预先想到的东西。

---

## 0.5 活动栏:三原生 + 可扩展

```
会话   ← AI(原生,焊死)
文件   ← 资产(原生,焊死)
网站   ← 浏览(原生,焊死)
────────
📔 📝  ← 钉住的组件(可扩展,用户决定)
────────
⊞ 组件  ← 组件管理入口:装了哪些、删除、让 AI 造一个
⚙ 设置
```

三原生 = 产品的三个名词,不可移除、不可替换。**其余一切都是组件。**

组件默认不占活动栏位置;用户在「组件」里把它**钉上去**才出现。
这条把「装了」和「常用」分开 —— 装十个组件不会把活动栏挤爆。

---

## 1. 组件 = 一个目录

```
widgets/<id>/
  widget.json     manifest —— 唯一必需的元数据
  index.html      入口 —— 唯一必需的文件
  main.js         随便几个,浏览器直接吃
  style.css
  data.db         组件的数据(宿主自动创建,和代码做邻居)
```

- `id`:`^[a-z0-9][a-z0-9-]{0,63}$`,即目录名。
- 除 `widget.json` 与 `index.html` 外,**文件数量和命名完全自由**。
  规范只要求「浏览器能直接加载」,不要求「三个文件」——写 5 个 JS 模块同样零构建。
- `data.db` 由宿主按需创建,**就放在组件目录里**:你和 AI 都能 `sqlite3 widgets/<id>/data.db` 直接撬开看。

### widget.json

```json
{
  "id": "habit",
  "name": "习惯打卡",
  "icon": "✅",
  "description": "记录每日习惯,看连续天数",
  "permissions": ["sql"]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 否 | 缺省取目录名;写了必须与目录名一致 |
| `name` | 是 | 活动栏与面板标题 |
| `icon` | 否 | 单个 emoji,缺省 `📦` |
| `description` | 否 | **给 AI 看的**:它据此判断该不该复用这个组件,而不是再造一个 |
| `permissions` | 否 | 见第 4 节;缺省 `[]` |

> manifest 一份三用:**字段表 = 权限清单 = SDK 文档**。三份会漂移,一份不会。

---

## 2. 挂载:只有一种

组件挂在**活动栏**,点击在侧栏展开面板。**不做标签页挂载,不做双挂载。**

- 面板宽度由用户拖,组件必须按**响应式**写(最窄 240px 要能看)。
- 面板是常驻的:切走再切回来**不重新加载**(iframe 不卸载),组件里的临时状态还在。
- 组件目录里的文件改了,下次打开即新版(响应带 `no-cache`)。没有「重启组件」这个动作。

---

## 3. 组件如何被加载:一个组件一个 origin

**每个组件由宿主起一个 loopback 端口提供服务**,组件地址是 `http://127.0.0.1:<port>/`。

```
面板 iframe ──► 127.0.0.1:<widgetPort>/          静态文件:widgets/<id>/
                                    /_wb/*       宿主 API(见第 5 节)
```

这不是过度设计,是**用 40 行换掉一整类 bug**:

- 组件拿到的是**真正的根**,`<link href="/style.css">` 与 `./style.css` 都对
  —— 路径前缀方案(`/widgets/<id>/…`)会让根绝对路径解析到 origin 根然后 404,这个坑刚踩过;
- 不同端口 = **不同 origin** → localStorage / cookie 天然互不可见,组件间隔离不用靠 sandbox 兜;
- 宿主 API 与组件**同源**(`/_wb/*` 由该端口自己应答),组件写 `fetch("/_wb/sql")` 即可,
  **凭据由宿主在服务端注入,永远不出现在页面里**。

### 隔离:靠 CSP,不靠自觉

组件的每个响应都带:

```
Content-Security-Policy: default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'
```

`connect-src 'self'` 就是轻量版的**物理断网**:组件的 JS 连不上任何外部地址,
想外传数据也没有通道。这是「AI 写的组件可以随便跑」的地基,和 workerd 的
`globalOutbound: null` 是同一件事的两种实现。

> 代价:组件确实无法直接访问外部 API。要联网必须走宿主代理(见开放问题 3)。
> 这是**刻意的默认**——默认断网,联网是要申请的例外。

---

## 4. 权限

`permissions` 数组,**明文写在 widget.json 里,用户看得见**。没声明的一律拒绝。

| 权限 | 能力 | 备注 |
|---|---|---|
| `sql` | `/_wb/sql`、`/_wb/sql/batch` | 只能碰自己的库,物理隔离 |
| `ui` | `/_wb/toast`、`/_wb/confirm` | 免申请?见开放问题 1 |
| `fs` | `/_wb/fs/*` 读写工作区文件 | **首次使用弹用户授权**,不能靠 manifest 一次性拿到 |
| `ai` | `/_wb/ai` 无状态补全 | 每次调用必带 `summary`,打进服务端控制台 |

原则:
- **能力即知情同意** —— 声明是给用户看的,不是给系统看的;
- **触碰真实文件必须运行时授权**,manifest 声明不够;
- **AI 调用必留痕** —— `summary` 必填,打进服务端控制台。

---

## 5. 宿主 API:同源 HTTP,没有 SDK

组件不需要引入任何脚本。所有能力都是 `/_wb/*` 下的同源 HTTP 端点,用标准 `fetch` 调。

> **为什么不给 SDK 对象**:上一轮的教训是,宿主能力一旦做成「前端能调的宿主对象」
> (iframe → 父窗口 postMessage),它就被 DOM 拓扑绑架了 —— 换个挂载方式当场失效。
> 做成 HTTP 端点则与挂载方式正交:iframe、浏览器标签、甚至 curl 都一样能调。

### 5.1 SQL(权限 `sql`)

```js
const res = await fetch("/_wb/sql", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    sql: "SELECT * FROM checkins WHERE habit = ? ORDER BY day DESC",
    params: ["reading"],
  }),
}).then((r) => r.json());

// → { ok: true, rows: [...], changes: 0, lastInsertRowid: 0 }
```

- **一组件一个 SQLite 文件**,物理隔离 —— 所以「AI 随便写 SQL」是安全的,
  不需要解析 SQL 判断它碰了哪张表(那条路走不通,永远有绕过)。
- 建表就是普通 SQL,组件自己负责:`CREATE TABLE IF NOT EXISTS …`,通常在启动时跑一次。
- `/_wb/sql/batch` 接受语句数组,**在一个事务里跑完**。
- 硬性限制:拦 `ATTACH`(否则可跨库)、单库上限(建议 50MB)、单次结果行数上限。

### 5.2 其余端点(草案)

| 端点 | 方法 | 说明 |
|---|---|---|
| `/_wb/context` | GET | 组件自身信息:`{ id, name, theme, locale }` |
| `/_wb/toast` | POST | `{ message }` |
| `/_wb/confirm` | POST | `{ message }` → `{ ok }`,阻塞到用户选择 |
| `/_wb/ai` | POST | `{ summary, system, prompt }` → `{ text, tokens }`,`summary` 必填 |
| `/_wb/fs/read` `/_wb/fs/write` `/_wb/fs/list` | POST | 工作区文件,首次使用弹授权 |

`toast` / `confirm` 需要服务端→客户端的通道(宿主自己的 WS,不受 workerd 那套限制)。

---

## 5.5 数据:一组件一个库,放在组件目录里

```
~/Documents/<产品名>/widgets/        ← 组件的家(产品自己的地盘)
  habit/
    widget.json
    index.html  main.js  style.css
    data.db                          ← 就在代码旁边
    data.db-wal  data.db-shm
  .trash/
    habit-20260828-1930/             ← 删除的组件在这儿躺 30 天
```

**为什么一组件一个文件**:物理隔离才让「AI 随便写 SQL」安全。
共用一个库靠表前缀约定隔离,等于把安全性建立在「AI 不会写错 SQL」上 ——
永远有绕过,而且宿主得去解析 SQL 判断它碰了哪张表,那条路走不通。
一组件一文件,越界在物理上不可能,代价只是拦掉 `ATTACH`。

**为什么放组件目录里,不放宿主数据目录**:因为「AI 能管理自己造的东西」是硬需求 ——
它得能查 schema、改数据、排错。藏进 Application Support 或按哈希命名(workerd 的 DO
存储就是这么干的),AI 和用户都摸不到,这条需求当场作废。
放代码旁边,`sqlite3 widgets/habit/data.db` 一句话的事。
副产品:**复制目录 = 连数据一起带走**,组件是自包含的。

**为什么根目录在 `~/Documents`,不在 Library**:用户要能在 Finder 里摸到、能同步、能自己拷贝。
藏进 Library 等于告诉用户「这不是你的东西」。
同时:**产品只往自己家里写**,绝不往用户加进来的工作区里塞 `widgets/` 目录。

### 四条配套规则

1. **WAL 文件在文件树里过滤**(`data.db-wal` / `data.db-shm`)。它们频繁写盘,
   如果有 fs watcher,连它们一起忽略,否则界面跟着抖。
2. **预装组件更新绝不覆盖 `data.db`** —— 落地时目录已存在就整个跳过。
3. **删组件 = 删数据,所以要有回收站**:整个目录挪到 `.trash/<id>-<时间戳>/`,保留 30 天。
   用户删的时候想的是「删掉这个小工具」,不是「销毁我三个月的打卡记录」。
4. **组件目录带一份 `.gitignore`**(`data.db*`)—— 版本管理组件代码时不会把数据一起提交,
   分发时也不会把自己的数据发出去。

### 连接策略

按需打开、闲置关闭(与端口同一套回收);`journal_mode = WAL`;单库上限 50MB;
拦 `ATTACH`。**schema 归组件自己管**,宿主不提供迁移机制 ——
组件启动时 `CREATE TABLE IF NOT EXISTS` 就够了,个人数据量级下不需要更复杂的东西。

---

## 6. 主题

组件继承宿主主题。宿主在**每个 HTML 响应**里注入一段 CSS 变量(不需要组件引入任何东西):

```css
:root {
  --bg: …; --bg-raised: …; --text: …; --text-dim: …;
  --border: …; --accent: …;
  color-scheme: light dark;
}
```

组件只要用这些变量,明暗主题自动跟随。**规范要求组件不得写死背景色与文字色。**

---

## 7. 一个完整的最小组件

`widgets/counter/widget.json`
```json
{ "name": "计数器", "icon": "🔢", "description": "点一下加一,记录历史", "permissions": ["sql"] }
```

`widgets/counter/index.html`
```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="./style.css">
<div class="wrap">
  <div id="count">0</div>
  <button id="add">+1</button>
  <ul id="log"></ul>
</div>
<script type="module" src="./main.js"></script>
```

`widgets/counter/main.js`
```js
const sql = (sql, params = []) =>
  fetch("/_wb/sql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql, params }),
  }).then((r) => r.json());

await sql(`CREATE TABLE IF NOT EXISTS hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const render = async () => {
  const { rows } = await sql("SELECT * FROM hits ORDER BY id DESC LIMIT 10");
  const total = await sql("SELECT COUNT(*) AS n FROM hits");
  count.textContent = total.rows[0].n;
  log.innerHTML = rows.map((r) => `<li>${r.at}</li>`).join("");
};

add.onclick = async () => { await sql("INSERT INTO hits DEFAULT VALUES"); render(); };
render();
```

`widgets/counter/style.css`
```css
.wrap { padding: 12px; color: var(--text); background: var(--bg); font: 14px system-ui; }
button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 6px 12px; }
ul { list-style: none; padding: 0; margin: 12px 0 0; color: var(--text-dim); font-size: 12px; }
```

四个文件,零构建,写完就能用。

---

## 8. 第三方库

默认**不提供** npm。需要图表/日期/Markdown 之类时,两条路:

1. **手写**(小组件场景下通常够);
2. **本地 vendor + import map**(仍然零构建):
   ```html
   <script type="importmap">{ "imports": { "chart": "./vendor/chart.js" } }</script>
   ```
   文件自己放进组件目录。

**明令禁止**:任何需要构建步骤的东西(JSX / TS / SCSS / bundler)。
要模板能力就用免编译方案(如 `htm + preact`,一个 import 搞定)。

> 这条不是洁癖:一旦允许构建步骤,「目录即安装」就不成立了 ——
> 目录里的东西不再是运行的东西,AI 改完源码还得跑构建,整条链就断了。

---

## 9. 让 AI 知道这套机制(不做等于没做)

上一轮最大的教训:机制做完了,内部 AI **完全不会用** —— 因为 system prompt 里
一个字没提产品自身,它不知道有「组件」这回事,只会退化成「我给你写个 HTML」。

必须显式做的三件事:

1. **system prompt 里写进契约摘要**:组件形态、目录结构、一个可抄的最小示例、
   `/_wb/sql` 的调法、三条硬约束(零构建 / 相对路径 / 主题变量)、
   以及**什么时候不该造组件**(要独立网站、要 CLI、只是看一眼的单页 HTML);
2. **给出本规范文档的绝对路径**,让 AI 动手前先读全文;
3. **组件列表要带 `description` 喂给 AI** —— 让它先判断「已经有一个了」,而不是造第二个。

---

## 10. 验收清单

每条都要**过浏览器**,不能只用 curl(curl 验的是服务端,浏览器验的才是契约):

- [ ] 组件首页能开
- [ ] `<link href="/style.css">` 与 `./style.css` **都**能加载
- [ ] `fetch("/_wb/sql")` 能通;建表、写入、查询、batch 事务全过
- [ ] 组件 A 读不到组件 B 的库;localStorage 互不可见
- [ ] CSP 生效:组件里 `fetch("https://example.com")` 必须失败
- [ ] 未声明的权限被拒
- [ ] 改文件后重新打开即新版
- [ ] 删目录后组件消失,端口与数据库句柄被回收
- [ ] 明暗主题切换,组件跟随
- [ ] 面板拖到最窄仍可用
- [ ] **让内部 AI 从零造一个组件并跑通** ← 真正的验收,开发者自己写一个不算

---

## 11. 与 worker 应用模型的关系

这套 widget 模型是 AIOS 的**轻量投影**,不是它的替代品。两者的分界:

| | Widget | Worker 应用 |
|---|---|---|
| 领域定义权 | 组件(自建 schema) | 组件(自建 schema + 自写后端) |
| 逻辑在哪 | 全在前端 | 前端 + 后端 |
| 能持有秘密吗 | 不能 | 能 |
| 定时/后台 | 不能 | 可以(需 DO) |
| 能带走部署吗 | 不能 | 能(接口对齐 D1) |
| 运行时成本 | 0 | workerd 136MB |

**撞墙信号**(出现两条以上,说明该升级模型了):反复需要宿主加 API /
用户开始要定时后台 / 组件需要持有凭据访问外部服务 / 用户想把组件带走。

---

## 开放问题(需要拍板)

1. **`ui` 权限要不要免申请**?toast / confirm 危害极小,列进 permissions 会让
   几乎每个组件都写一遍。倾向:**免申请**,与 workerd 那版的 `log` 同理。
2. ~~一组件一端口的上限~~ **已定**:按需起、闲置回收(30 分钟无请求关掉,下次访问再起)。
3. **联网怎么开**。默认 CSP 断网是对的,但迟早有组件要查天气。
   候选:`permissions: ["net:api.example.com"]` + 宿主代理转发(白名单在 manifest 里,用户可见)。
4. **组件间通信**。目前物理隔离、没有设计。真要做应当经宿主(事件总线),
   不能让组件互相发现 —— 一旦允许直连,隔离就白做了。
5. **组件能不能读写工作区文件**(`fs` 权限)。开了很有用,但这是所有权限里唯一
   能碰用户真实资产的。倾向:开,但**每次会话首次使用都弹授权**,不做永久授权。
6. **数据备份/迁移**。`data.db` 就在组件目录里,复制目录 = 连数据一起带走。
   要不要做「导出组件」按钮(打包成 zip),还是就让用户自己拷目录?
