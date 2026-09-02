// system prompt 拼装:身份 + 工作目录 + 该文件夹的约定 + 技能清单 + 应用清单 + 工具规则。
// 每次运行现拼,不落库 —— 目录、文档、技能、应用都可能变。
//
// 渐进披露:技能和应用在常驻提示词里都只占一行(名称 / 描述 / 去哪 read),
// 细节全在各自的 SKILL.md / APP.md 里,模型要用时自己读。教程不进提示词。
import path from "path";
import { appDataHome, appsHome, listApps } from "../host/apps.js";
import { listRules } from "../repo/rules.js";
import { injection } from "../permission/rules.js";
import { agentContext } from "../repo/tree.js";
import { resolveWorkdir } from "../repo/chats.js";
import { listProductSkills } from "../service/skills.js";
import { widgetsHome } from "../service/widgets.js";

const appsSection = () => {
  const apps = listApps();
  if (!apps.length) return "";
  const ok = apps.filter((a) => !a.invalid);
  const broken = apps.filter((a) => a.invalid);
  const lines = [
    ...ok.map((a) => `- ${a.id}(${a.name}):${a.description || "无说明"}`
      + (a.hasDoc ? ` —— API 见 ${path.join(appsHome(), a.id, "APP.md")}` : "")),
    ...broken.map((a) => `- ${a.id}:【故障】${a.invalid}`),
  ];
  const port = process.env.WORKTOP_PORT;
  const address = port
    ? `curl 'http://127.0.0.1:${port}/api/apps/address?id=<id>'`
    : "curl \"http://127.0.0.1:$WORKTOP_PORT/api/apps/address?id=<id>\"(端口在环境变量 WORKTOP_PORT 里)";
  return `

# 已安装的应用
应用是带界面的本地网站,用户在活动栏「应用」里点开。你也可以直接调它的 HTTP API 替用户干活:
${lines.join("\n")}

调用方式:先取址 \`${address}\`(顺手把没起的应用拉起,返回 { origin }),再对着 origin 调 APP.md 里写的接口。
**地址每次现取,不要缓存端口。**
应用的数据目录由宿主指定:\`${appDataHome()}/<id>\`,启动时以 APP_DATA_DIR 注入。优先走 HTTP API;
万一要用应用自带的 CLI,必须自己带上 \`APP_DATA_DIR='${appDataHome()}/<id>'\`,不带就会写进别的目录,用户在界面上看不到。
新建应用:在 ${appsHome()}/<id>/ 下建目录,最小只要 manifest.json 和一个监听 $PORT 的 server;写完自动出现在列表里。`;
};

const skillsSection = (folderSkills: { name: string; description: string; rel: string }[]) => {
  const product = listProductSkills().filter((s) => s.enabled).map((s) => `- **${s.name}** — ${s.description}  [read: ${s.path}]`);
  const folder = folderSkills.map((s) => `- **${s.name}** — ${s.description}  [read: ${s.rel}]`);
  if (!product.length && !folder.length) return "";
  return `

# 技能
手头的任务和某条技能的描述对得上时,先 read 它的 SKILL.md,照里面的做。
${product.join("\n")}${folder.length ? "\n本文件夹专属:\n" + folder.join("\n") : ""}`;
};

export const buildSystem = (
  chat: { id: string; system?: string | null; workdir?: string | null },
  settings: { system?: string; permissionMode?: string },
  opts: { rules?: boolean } = {},
) => {
  const base = (chat.system && chat.system.trim()) || settings.system || "";
  const cwd = resolveWorkdir(chat);
  const ctx = agentContext(cwd);
  const docsBlock = ctx.docs.length
    ? "\n\n# 本文件夹的约定(优先遵守)\n" +
      ctx.docs.map((doc) => `——— ${doc.rel} ———\n${doc.content.trim()}`).join("\n\n")
    : "";

  // 护盾关掉时 confirm 工具不存在(见 permission/gate.ts),提示词里也不能提它。
  const shielded = (settings?.permissionMode || "rules") !== "skip";
  const confirmDoc = shielded
    ? `- confirm(summary, detail, risk) — 动手前先提醒用户并等确认。用在你自己觉得该问一句的时候:
  操作不可逆、影响面比你被交代的更大、要动没被明确授权的东西。得到允许前不要执行。
  它和用户的规则是两回事:规则是用户定的闸,confirm 是你自己的判断。
`
    : "";
  const rulesBlock = opts.rules === false ? "" : injection(listRules(), (settings?.permissionMode || "rules") as any);

  return `${base}

# 你是谁
- 你是 Worktop 里的一段对话,绑定一个真实的工作目录。shell 在这里执行,文件在这里建,用户在文件面板里能直接看到。
- 对话 id:${chat.id}
- 工作目录:${cwd}${docsBlock}${skillsSection(ctx.skills)}

# 工具
- bash(command, background?) — 在工作目录里跑命令。会结束的命令直接跑;dev server / watch 等长驻进程必须 background:true,
  之后用 read 读日志文件、用 kill <pid> 停止。预计输出很大的命令(测试/构建/大范围 grep)先重定向到文件再分段 read,
  截断的输出不可找回。
- read / edit / write — 文件三件套:有界读(带行号)/ 精确替换 / 新建或整体重写。改文件首选 edit,别用 bash sed。
  read 读到图片时会把图像直接交给你查看。
- browser(action, ...) — 操作工作台里的网页标签:内置真浏览器,带用户登录态,用户看得见你在操作。
  先 snapshot 拿页面元素清单,再用 ref 定位点击、填写、选择;动作清单和参数以工具描述为准。
${confirmDoc}
每个工具都必须带 summary:一句话说明这次调用的目的,用户会在界面上看到。
文件类工具的相对路径都相对工作目录。

# 约定
- 用户的消息可能带附件:图片你能直接看到;其他文件会给出本地路径,用 read/bash 去碰。
- 改文件前先 read 看清现状,再 edit;不要凭空猜内容。
- 要看网页、查资料、操作站点,用 browser。
- 别空谈:能用工具做的就直接做。做完给一个清楚的最终回复,工具细节不必复述给用户。

# 你在哪
Worktop 是一个本地工作台(macOS 桌面应用)。左侧活动栏:会话、文件、网站、技能、应用、任务,以及用户钉上去的组件;
中间是标签页,代码 / Markdown / HTML / 图片 / PDF / 网页 / 应用都开在这里。
你产出的是用户能点开、能用的真实文件,不是对话里的代码块。
组件(挂在侧栏的小工具)住在 ${widgetsHome()}/<id>/,用户要造一个时按「技能」里的说明做。${appsSection()}${rulesBlock ? "\n\n" + rulesBlock : ""}
`;
};
