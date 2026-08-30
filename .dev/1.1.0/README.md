# 1.1.0 — 内嵌浏览器长出登录态,后端一级铺平

1.0.0 定了名字、对齐了语义。这一版解决三件积压的事,其中一件是**产品能不能用**级别的:

> 网站是三原生之一,但**打开任何一个站都是未登录状态** —— GitHub 看不到私有仓库、
> 语雀进不去、后台系统全在登录页。用户不会为了用我们而在这里重登一遍所有账号。
> **没有登录态,「网站」这一原生就是个装饰。**

一句话:**1.1.0 让内嵌浏览器真的能用,顺手把后端一级和 `ai/` 的历史包袱清掉。**

---

## 一、从 Chrome 导入登录状态(本版核心)

### 为什么是导入,不是让用户重登

重登一遍不现实(几十个站、二次验证、密码管理器都在浏览器里),而且**每次换设备、每次清缓存都要重来**。
Chrome 的 cookie 就在本机磁盘上,把它搬过来是一次性动作,搬完就一直有效。

### 怎么做(macOS)

技术路径已验证可行(参考实现:`sider-agent-client/client/desktop/chrome-import.js`,137 行零依赖):

1. **找配置**:`~/Library/Application Support/Google/Chrome/{Default,Profile N}/Cookies`,
   按 mtime 排序取**最近用过的那个**(多 Profile 的人通常只有一个在用);
2. **取密钥**:`security find-generic-password -s "Chrome Safe Storage" -a Chrome`
   → PBKDF2(salt=`saltysalt`,1003 轮,16 字节,sha1)。
   **这一步系统会弹钥匙串授权框 —— 这就是本功能的安全闸门**,用户拒绝则整次中止;
3. **读库**:Chrome 运行时抓着库不放,连 `-wal`/`-shm` 一起拷进临时目录再只读打开
   (`node:sqlite` 的 `DatabaseSync`,我们本来就在用);
4. **解密**:`v10`/`v11` 前缀 → AES-128-CBC,IV = 16 个空格;新版 Chrome 明文前还有
   32 字节的 `sha256(host)`,匹配上就剥掉;
5. **注入**:`session.cookies.set()`,`expires_utc` 是 **1601 纪元的微秒**(超 JS 安全整数,
   在 SQL 里先除),`samesite` 数值映射成 Electron 的字符串枚举。

返回 `{ profile, total, imported, failed }`,界面上如实报「导入 N 条,跳过 M 条」——
**不假装 100% 成功**:总有过期的、host 畸形的、我们解不开的。

### 落在哪个 session:新增 `persist:web` 分区

现在 `<webview>` 没写 `partition`,用的是默认 session —— 和应用自己(127.0.0.1)共用一个 cookie 罐。
本版给网页标签一个专属分区 `persist:web`:

- **边界清楚**:浏览的登录态和应用自身状态互不污染;
- **「退出所有网站」才做得干净**:清这个分区即可,不会顺手清掉应用自己的东西;
- 代价:**换分区 = 现有 webview 里已登录的站要重登一次**。本版正好带导入功能,一次补回。

### 入口:三处,而且最显眼的那处长在痛点上

只放设置页是不够的 —— **用户不会为了一个还不知道存在的功能去翻设置**。三处:

1. **网页标签顶部的引导条(主入口)**:打开任意网页标签就能看见,因为
   「站是未登录的」这个痛点正好发生在这块面板里。导入成功或用户主动关掉后不再出现
   (`localStorage`,见 `ui/src/lib/chromeImport.ts`);
2. **`⋯` 菜单第一项**,与其余项之间有分隔线 —— 它是浏览器能不能用起来的前提,不是杂项;
3. **设置页「网页登录状态」**:长期入口。换了 Chrome 账号、cookie 过期都要能再导一次。

### 必须写进界面的三件事

cookie 等价于登录凭据,这个功能的分寸感比实现更重要:

1. **只能由明确点击触发**,永不后台静默执行、永不随更新自动跑;
2. **导入前把话说清楚**:导入的是**全部**站点的登录态,不是选择性的。按钮旁边直说;
3. **AI 能看见这些登录态** —— `browser` 工具可以驱动这些标签导航、执行 JS。
   这本来就是产品的设计(AI 替你在真登录态下干活),但用户有权在按下按钮前知道。
   **这句必须出现在界面上,不能只写在文档里。**

### 平台边界

只做 macOS。Windows 的 Chrome 从 v127 起上了 App-Bound Encryption(密钥绑定到 Chrome
可执行文件本身),现有解法全部失效;Linux 的 Secret Service 又是另一套。
**非 macOS 直接诚实报错**,不写半吊子的兼容分支。

---

## 二、浏览器「更多」菜单

工具栏最右的「在系统浏览器打开」换成 `⋯`,菜单里放**此刻对这个页面的动作**。

参考 sider 的两个做法,直接抄:
- **菜单挂在触发它的那一行里**(`top:100%`),不挂在外面硬算坐标 —— 它自己的注释写着
  「行高一改就错位,已经错过一次」;
- **配置类的不进菜单**,底部留一个「浏览器设置 →」直达。

### 本版进菜单的(全部是现有能力,零新增壳 IPC)

| 项 | 实现 |
|---|---|
| 查找 ⌘F | webview `findInPage` |
| 缩放 −/100%/+ | webview `setZoomLevel`,行内控件不逼用户记快捷键 |
| 复制链接 | 上一版被星标顶掉的,它本来就该在菜单里 |
| 在系统浏览器打开 | 从工具栏降级进来,不删 |
| 开发者工具 | webview `openDevTools` |

**星标(添加到「网站」面板)留在工具栏外面**,不收进菜单 —— 网站面板是三原生之一,
这是本产品的特色动作,藏进二级菜单等于说它不重要。工具栏右侧就是 `⭐ ⋯` 两个按钮。

### 明确不做的

- **历史记录**:我们是工作台不是浏览器。页面是被 AI 或书签带出来的,不是漫游出来的;
  做了要建表、做 UI、做清理,收益低;
- **移动端预览**:开发者工具的设备模拟更好用;
- **截图 / 打印 / 下载列表**:要动主进程,本版不排,等真有人要。

### 配套:一页「浏览器设置」

导入登录状态需要一个落脚处,顺带把同类的放一起(设置页新开一段,不是新页面):

- **从 Chrome 导入登录状态** ← 本版核心,带上面说的三条提示
- **退出所有网站**:清 `persist:web` 分区的 cookie 与站点数据
- **清除缓存**:清缓存但保留登录态(两个动作分开,别让用户一按就退登)

---

## 三、后端一级铺平

`server/` 的分层(`tools / runs / service / repo / api`)是清楚的,问题只在**一级散着 13 个 .ts**,
而它们其实是三类东西。按职责收:

```
server/
├── host/         🖥 宿主能力:把系统/Electron 的能力包成服务,被 tools/ 与 api/ 共用
│   ├── terminals.ts  browserHost.ts  watcher.ts  directoryPicker.ts
│   ├── favicons.ts   files.ts
│   └── jobs.ts       ← 原 processes.ts,见下
├── ai/ tools/ runs/ service/ repo/ api/ shared/     ← 不动
├── db.ts  bus.ts  telemetry.ts                      ← 全局单例,留一级
└── http.ts  static.ts  origin.ts  realtime.ts       ← 进程骨架,留一级
```

`host/` 这个名字带信息量:**这层以下全是「壳与系统」,以上全是业务**。
将来出 Linux/Windows 版、或替换某个能力的实现,边界一眼可见。

### 一个改了用途没改名的文件

`processes.ts`(234 行,一级最大的文件)。0.10.0 说「拔掉预览机制」,但它还活着 ——
现在唯一的使用者是 `tools/bash.ts` 的 `background:true`。

**它不是残渣,是转岗了**:从「预览机制的后端」变成「bash 后台任务的注册表」。
改名 `host/jobs.ts` 并在文件头写清现在服务谁 —— 否则下次读代码的人(包括我们自己)
会当成 0.10.0 没删干净的东西顺手删掉。

### 顺带:`@ts-nocheck` 18 → 13

**搬动的文件全部摘掉了**,`server/host/` 七个文件零 `@ts-nocheck`、全类型标注
(`jobs` / `browserHost` / `terminals` / `favicons` / `files` 都补了真类型,不是 `any` 糊过去)。
剩下 13 个都在没搬的大文件里(`api/index` `realtime` `runs/*` `repo/*` `tools/*`),留给后续版本。

---

## 四、`ai/` 独立

`ai/` 已从仓库根挪进 `server/ai/`(三处 import 已改,typecheck 与 server bundle 均通过)。

同时**作废与 AGENT 仓库的双向同步契约**:两边曾经逐字节相同,以后各自维护。
理由很实在 —— 同步是笔持续的税,而这两个产品的内核已经在往不同方向长
(我们有组件、有 widget 的 AI 调用,AGENT 有它自己的形态)。
AGENTS.md 与 README 已同步改口径。

---

---

## 五、改名收尾

GitHub 仓库 `yanglongyun/Workbench` → **`yanglongyun/Triforge`**,本地目录同步改名,
`git remote`、README 的 clone 指引、设置页「关于」里的仓库地址一并跟上。

内部 slug 仍是 `workbench`(appId `ai.iimos.workbench`、userData 目录、更新通道)——
1.0.0 定的两层结构在这里兑现了:**换名字没动任何一条身份链**。

---

## 待办 / 本版不碰

- **Triforge 是试水名**,发帖推广前得先认下来或换掉(见 1.0.0 文档);
- 组件的 `ui`(toast/confirm)与 `fs` 权限仍未实现;
- 宿主 API 对外访问未做;
- **appId 已从 `dev.woodchange.workbench` 改为 `ai.iimos.workbench`** —— 已发布的 0.5.0
  收不到自动更新(Squirrel 校验签名的 designated requirement 含 bundle id)。
  当前无外部用户,影响可忽略,但正式发布时要知道这是一次断链。
