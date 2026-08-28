# 0.6.0 — 应用契约 v1:用户(和 AI)能自己造应用了

## 这一版回答的问题

「用户能自建应用吗?」—— 能,而且主要由 AI 造。本版把 0.5.0 的面板体系升格为**应用契约**:
一份 manifest,挂载点(侧栏面板 / 标签页)与能力(capabilities)都是字段;应用 = 工作区里的
一个目录,AI 用 write 工具写出 `apps/<id>/app.json + index.html` 即成为可用软件 —— AIOS
「软件由 AI 生成、属于使用者」的哲学在 Workbench 里的落点。

## 定案的模型(讨论结论,详见 APP.md)

1. **活动栏三原生**:会话(AI)/ 文件(资产)/ **应用**(软件形态),焊死;网站降级为预装书签应用
   (可移除)—— 降的是书签面板,不是浏览器能力;
2. **原语 vs 领域**:宿主只给原语(storage/db/fs/ai/agent/tabs),领域数据(书签/笔记/日程)归应用
   自持 —— 宿主不知道"书签"是什么,这是 AI 能无限造应用、宿主不成为瓶颈的前提;
3. **db 能力**:一应用一 SQLite 文件,物理隔离让「AI 随便写 SQL」安全(拦 ATTACH,50MB 上限);
4. **双挂载**:同应用的面板与标签页是两个实例,共享宿主侧数据 + 实例总线(route 推送、事件转发);
5. **AI 双通道**:`ai.complete`(无状态,秒回)与 `agent.run`(hidden 智能体,能用工具)——
   **产生活动,不产生聊天**:会话面板只属于用户亲自开启的对话,机器行为进活动流(summary 必填,问责可见);
6. **安全**:Origin 门卫拒绝字面 "null" 源写请求(应用不能直连本地端口,宿主桥是唯一通道 + 能力网关);
   fs:workspace 首次使用弹授权。

## 落地清单

- server:`api/app.ts`(按规则拆路由)+ `service/{apps,appdb,appai,appagent,activities}.ts`(全部带类型);
  agents 表加 hidden 列;activities 表;origin 门卫硬化
- UI:原生 AppsPanel(打开/钉侧栏/移除/「让 AI 造一个应用」)、AppFrame(能力网关桥)、
  app 标签类型(常驻层挂载,切换不重载)、实例总线、ToastHost;ActivityPanel 合并应用活动
- SDK:context/on/emit、db、ai、agent、fs、tabs.openApp、ui.toast
- 预装应用迁至 `ui/public/apps/<id>/`(带 app.json);0.5.x extPanels 状态自动迁移
- 「让 AI 造一个应用」:一句话 → 新对话携带自包含契约速查表 → agent 写出目录 → 自动出现在应用面板

## 已知取舍

- 应用自写服务端代码(长驻进程)明确不做:storage+db+fs+agent 覆盖个人应用绝大多数需求;
- db 的同步 API 理论上可被疯狂查询卡住事件循环,个人数据量级下接受,恶化再挪 worker 线程;
- 工作区应用与预装应用同 id 时预装优先(防遮蔽)。
