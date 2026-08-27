# Arbor 0.4.0 — 内核换血到 AGENT 0.0.7 + 附件整套链路

AGENT 仓库(同源上游)已从我们取材的 0.0.3 走到 0.0.7:0.0.4 加了图片/文件,
0.0.7 修了一批**静默出错**的内核硬伤。本版把两块全部接回来 —— 先对照确认我们的
`ai/` 与 0.0.3 逐字节一致,然后整体换血,保持同源不分叉。

## 一、内核正确性(随 AGENT 0.0.7,我们同病同修)

- **edit 的 `$&` 替换模式泄漏**:`String.replace` 即使首参是普通字符串,new 里的
  `$&` `` $` `` `$'` `$n` `$$` 仍被当替换模式解释 —— 静默写错文件,且默认路径
  (replace_all=false)就是坏的那条。改为**按下标切片拼接**。
- **CRLF 行尾**:read 给模型的行带着 `\r`,模型构造的 old 丢了 `\r`,edit 精确匹配
  必失败(单行凑巧能过,多行必挂)。新增 `server/tools/text.ts`(toLf / detect /
  restore),read/edit 统一 LF 口径,写回还原原始行尾;纯 LF 文件字节不变。
- **read 行数**:尾随换行切出的空串不再计为一行。
- **ai/responses.js 重写**:
  - **重试**(新增 ai/retry.js):额度/账单终态 → HTTP 状态码主判据 → 文本表兜底 →
    abort 恒终态;指数退避 + 抖动;已吐正文后的断流默认不重试(避免正文重复)。
    分类表移植自 earendil-works/pi(MIT,版权声明在文件头)。
  - **截断**:读 `incomplete_details.reason`,response.incomplete 不再当成功;
  - **断流**:`sawTerminal` 守卫,流在终结事件前断开按错误处理;
  - 补 error 事件分支;`modelOptions` 白名单透传(reasoning / max_output_tokens 等,
    本层不设默认;arbor 暂未在设置里暴露,内核已就绪)。
- **上层落位**:runs 在截断时落 `[incomplete]` 系统留痕(黄色药丸,与 [stopped]/
  [error] 同族);重试透出 `conversation.retry` 事件,界面落瞬态 chip
  「请求失败,Ns 后重试(2/3)」(不入库,终局对账后自然消失);autoTitle /
  compact 的 complete() 免费获得同一套重试。

## 二、附件:图片与文件(随 AGENT 0.0.4,按 arbor 结构落位)

数据链路(`server/files.ts`):

- 选择 / **拖拽** / **粘贴截图**上传;发送前托盘可见可移除(上限 10 个/条,8MB/个);
- 内容按 **SHA-256 寻址**存入 `$ARBOR_HOME/files`(同内容天然去重);消息与 SQLite
  只存元数据(id/名称/路径/类型/大小),不存 Base64;
- `POST /api/upload` 收 base64,`GET /api/files/<id>` 回吐字节(immutable 缓存);
- 请求模型时(注入内核的 prepareInput):**当前这条**用户消息的图片才展开成
  `input_image`,普通文件给本地路径(read/bash 都能碰);旧轮一律剥除,不反复携带字节;
- **read 工具读图片**:返回图像交给模型看(function_call_output.image),只在当前轮
  展开、最多 2 张;工具装配层对带图结果只截断文本部分;
- **browser screenshot 同路升级**:截图除落文件外,同时走 image 通道进当前轮上下文 ——
  模型第一次真正「看见」它操作的页面;
- 界面:用户气泡上方图片缩略图(点击看原图)/ 文件芯片(可下载);ws send 带
  attachments;纯附件消息可发送,自动取名兜底用第一个附件名。

## 关于 agent/ 目录(结构说明,非缺失)

AGENT 仓库的 `agent/` 是 **CLI 形态的 agent 运行时**(cli.js / tools.js /
functions/ / compact.js)。arbor 是服务端常驻形态,同一层职责落在
`server/runs/`(编排+压缩)+ `server/tools/`(工具),没有 CLI —— 不是少了一层,
是同一层换了地方住。同源的只有 `ai/` 内核,这一版起继续逐字节跟上游。

## 验证(2026-08-26)

- 直调冒烟:`$&` 原样写入 / CRLF 多行替换且写回仍 CRLF / read 行数与行尾 /
  read 图片返回 image / upload 内容寻址 / prepareInput 新旧轮展开与剥除 /
  重试判定四象限 —— 全过;
- HTTP:/api/upload → 201 元数据,/api/files/<id> → 200 image/png;
- `npm run typecheck` / ui build / server bundle 全绿。

## 补记:压缩切片修正 + 产品改名 Workbench

**压缩摘要事故**:实测出现「整段历史被总结成什么都没发生」的摘要卡。病根在切片边界:
尾部固定保留 40k 字符,当历史刚超 40k 时,切给摘要的"早期部分"只剩首条用户消息
(reasoning 行计数但被过滤出材料),摘要模型如实总结出「无工具、无结论」——
这份**假事实**进入后续上下文,且水位不降,每一轮再切一条零头、再生成一张垃圾卡。修法:

- 尾部保留量自适应:`min(40k, 总量×40%)` —— 压缩发生就必须压掉大头;
- 材料下限 1500 字符:切出来只是零头就不压(避免误导性摘要);
- 双场景实测:病例场景直接跳过;5 轮长历史折叠 60%、摘要覆盖全部候选行。

**改名 Workbench**:产品名 / 图标 / name 字段全量换 ——

- package.json:name=workbench、productName=Workbench、appId=dev.woodchange.workbench;
- 环境变量 ARBOR_* → WORKBENCH_*;数据库 database/workbench.db;界面品牌、
  桌面壳标题、事件名(workbench:*)、system prompt 全部同步;
- **图标重设计**:保留绿→蓝双色渐变基因,树换成「工作台版面」——
  侧栏(绿点=活跃会话)+ 主窗格 + 分屏窗格,即产品本身;
- 本机数据平移:App Support/arbor → App Support/Workbench(db 改名 + wal/shm 跟随),
  workspaces.path 与 agents.workdir 里的 ~/Documents/Arbor 改写为 ~/Documents/Workbench,
  目录同步 mv —— 4 段会话与模型设置无缝带入,实测新包读取正常;
- 根 README 只做了品牌词替换,叙述仍是 arbor 时代口吻,待正式重写。

## 已知限制 / 下一步

- modelOptions(reasoning effort、max_output_tokens)内核已支持,设置界面未暴露;
- AGENT 0.0.7 带的 34 个 node:test 用例未随迁(它们测的是 agent/functions 形态),
  arbor 侧等价路径已用直调脚本覆盖,正式测试基建另立版本做。
