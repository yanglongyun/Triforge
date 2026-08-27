# Workbench 面板协议(v0)

侧边栏不是三个写死的 tab,而是一个**可扩展的面板宿主**:tab 行、装卸、宽度、主题属于宿主;
tab 之下的整块"身体"属于面板自己。创建对话/添加网站/新建文件这类操作**都是面板内部的事**,
宿主顶部的 + 只有一个含义:**添加面板**。

## 双轨制:载体按信任分,契约只有一份

| | 载体 | 谁 | 为什么 |
|---|---|---|---|
| 内置面板 | 原生 React 组件 | 会话、文件(随版本一起发,进仓库) | 深度集成:跨面板拖拽、多选、全局快捷键、性能 |
| 扩展面板 | **iframe 沙箱** | 预置示例「网站」、面板库安装的「任务」、将来 AI 生成的面板 | 运行时装进来的代码不可信,必须关进笼子 |

判断标准不是"新旧",是**代码从哪来**:进仓库随包发的可以原生;运行时装进来的一律 iframe。
两轨说同一种语言(host API),所以面板可以"转正"(扩展→原生重写)也可以"开放"(原生→扩展参考实现)。

## iframe 面板怎么写

一个面板 = 一个目录 `ui/public/panels/<id>/index.html`,自带全部 UI 与逻辑:

```html
<script src="../workbench-sdk.js"></script>
<script>
  await workbench.ready();                                  // 等宿主握手
  const data = await workbench.storage.get();               // 取自己的数据
  workbench.tabs.open({ kind: "web", url: "github.com" });  // 请求宿主开标签页
</script>
```

- 装载方式:`<iframe sandbox="allow-scripts" src="/panels/<id>/index.html">` —— 无 `allow-same-origin`,
  面板源是**不透明源**:摸不到宿主 DOM / localStorage / WebSocket。
- 主题:宿主把 `--color-*` 变量注入面板 `<html>` 并在明暗切换时实时更新;
  面板 CSS 直接写 `var(--color-bg)` 等 token 即与宿主同肤(自带浅色兜底值)。

## host API(经 postMessage RPC,宿主桥 = `PanelFrame.tsx`)

| 方法 | 说明 |
|---|---|
| `workbench.tabs.open({ kind:"web", url, title? })` | 打开网页标签;同站已开由宿主聚焦去重 |
| `workbench.storage.get()` / `.set(value)` | 面板私有 JSON(一板一份,落 `panel_kv` 表) |
| `workbench.dialog.confirm(msg, {danger, confirmText})` | 宿主全局确认框 |
| `workbench.system.openExternal(url)` | 系统浏览器打开 |
| `workbench.system.copyText(text)` | 写剪贴板 |
| `workbench.ready()` / `workbench.panelId()` | 握手完成 / 自己的面板 id |

线协议:`{ wb:1, type:"hello"|"init"|"theme"|"rpc"|"result", … }`;面板启动先发 `hello`,
宿主回 `init`(ctx)+ `theme`;RPC 带自增 `id`,宿主以 `result` 应答。

## 安全铁律

1. **面板永远不直连本地 http/ws 端口**,一切经宿主桥 —— 桥知道面板身份,是唯一的权限落点。
   (唯一例外:`<img src="/api/favicon?url=…">` 这类只读 GET 资源。)
2. 沙箱 iframe 的请求 Origin 是 `null`,而 Origin 门卫(server/origin.ts)为 file:// 壳放行 null ——
   **开放非官方面板(AI 生成/第三方)之前,必须给带副作用的 API 加会话 token**(壳注入、面板拿不到),
   否则恶意面板可以盲发 POST。当前预置/可安装面板都是仓库里的第一方代码,不受此威胁。
3. 桥只认 `e.source === iframe.contentWindow`,不认 origin(不透明源没有可认的 origin)。

## 现状(0.5.0)

- 预置:`agents`(原生)、`files`(原生)、`sites`(**iframe 示例**,书签数据已从 sites 表迁入面板存储)
- 可安装:`todo`(任务清单)—— 面板库在侧栏 tab 行右端的 +
- 未开放:「用 AI 定制面板」入口已占位 —— AI 写一段 HTML 落进面板目录即成为应用,
  与 AIOS「应用由 AI 生成」的哲学在此汇合。
