// @ts-nocheck
// browser:操作工作区里的网页标签(真浏览器、真登录态)。
// 执行端是 Electron 壳里的 <webview>(浏览器宿主见 server/browserHost.ts):
// 指令广播给 UI,拥有该标签的窗口执行后应答;用户全程在界面上看得见 agent 在哪个页面干什么。
// AI 开的网页按策略落在分屏侧组 —— 左边对话继续流,右边看着 agent 操作。
// 纯浏览器/dev(没有桌面壳)时诚实报错,不装能行。
import { writeFileSync, mkdirSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import { browserRequest, hasHost, listTabs, openTab } from "../browserHost.js";

export const browserDef = {
  type: "function",
  name: "browser",
  description:
    "操作工作区里的网页标签(Workbench 内置真浏览器,带用户的真实登录态)。" +
    "action:list 列出已打开的网页标签(拿 tab_id);open 打开一个网址成新标签(在分屏侧边打开,用户看得见);" +
    "navigate/back 让某个标签跳转/后退;read 读取页面正文(标题+地址+文本);" +
    "js 在页面里执行 JavaScript 并返回结果;click 点击元素(CSS 选择器);type 往输入框填文本;" +
    "screenshot 截图保存为工作目录里的 PNG 文件。除 list/open 外都必须带 tab_id(先 list)。",
  parameters: {
    type: "object",
    properties: {
      summary: { type: "string", description: "一句话说明这次操作的目的(界面会显示)" },
      action: {
        type: "string",
        enum: ["list", "open", "navigate", "back", "read", "js", "click", "type", "screenshot"],
        description: "要执行的动作",
      },
      tab_id: { type: "number", description: "目标标签 id(action=list 返回;除 list/open 外必填)" },
      url: { type: "string", description: "open/navigate:要打开的网址" },
      code: { type: "string", description: "js:要在页面里执行的 JavaScript 表达式" },
      selector: { type: "string", description: "click/type:目标元素的 CSS 选择器" },
      text: { type: "string", description: "type:要输入的文本" },
      path: { type: "string", description: "screenshot 可选:保存路径(默认存工作目录 web-shot-<时间>.png)" },
    },
    required: ["summary", "action"],
    additionalProperties: false,
  },
};

const fmtTab = (tab) => `[${tab.id}] ${tab.title || "(无标题)"} — ${tab.url}`;

export const browser = async ({ action, tab_id, url, code, selector, text, path: savePath }, ctx) => {
  const act = String(action || "");
  if (!hasHost() && act !== "list") {
    return "error: browser 不可用 —— 需要在 Workbench 桌面壳(Electron)里运行,当前没有浏览器宿主。";
  }

  try {
    switch (act) {
      case "list": {
        const rows = listTabs();
        if (!rows.length) return hasHost() ? "(当前没有打开的网页标签;用 action=open 打开一个)" : "error: browser 不可用 —— 需要在 Workbench 桌面壳(Electron)里运行。";
        return rows.map(fmtTab).join("\n");
      }
      case "open": {
        const target = String(url || "").trim();
        if (!target) return "error: open 需要 url";
        const normalized = /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`;
        if (!/^https?:\/\//i.test(normalized)) return "error: 只支持 http(s) 网址";
        const tab = await openTab(normalized);
        return `已在分屏侧边打开网页标签 ${fmtTab(tab)}\n(页面可能还在加载;用 read 读正文,用 js/click/type 操作)`;
      }
      case "navigate": {
        const target = String(url || "").trim();
        if (!target) return "error: navigate 需要 url";
        const normalized = /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`;
        await browserRequest(tab_id, "navigate", { url: normalized }, 30_000);
        return `标签 ${tab_id} 已跳转到 ${normalized}`;
      }
      case "back": {
        await browserRequest(tab_id, "back", {}, 10_000);
        return `标签 ${tab_id} 已后退`;
      }
      case "read": {
        const result = await browserRequest(tab_id, "read", {}, 20_000);
        return `title: ${result?.title || ""}\nurl: ${result?.url || ""}\n\n${result?.text || "(页面没有可读文本)"}`;
      }
      case "js": {
        if (!String(code || "").trim()) return "error: js 需要 code";
        const result = await browserRequest(tab_id, "js", { code: String(code) }, 20_000);
        return String(result ?? "undefined");
      }
      case "click": {
        if (!String(selector || "").trim()) return "error: click 需要 selector";
        const result = await browserRequest(tab_id, "click", { selector: String(selector) }, 15_000);
        return String(result || "已点击");
      }
      case "type": {
        if (!String(selector || "").trim()) return "error: type 需要 selector";
        const result = await browserRequest(tab_id, "type", { selector: String(selector), text: String(text ?? "") }, 15_000);
        return String(result || "已输入");
      }
      case "screenshot": {
        const dataUrl = await browserRequest(tab_id, "screenshot", {}, 25_000);
        const base64 = String(dataUrl || "").replace(/^data:image\/\w+;base64,/, "");
        if (!base64) return "error: 截图失败(宿主没有返回图像)";
        const bytes = Buffer.from(base64, "base64");
        const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
        const rel = String(savePath || "").trim() || `web-shot-${stamp}.png`;
        const abs = isAbsolute(rel) ? rel : resolve(ctx.cwd || process.cwd(), rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, bytes);
        ctx.emit?.({ type: "tree_changed", reason: "browser_screenshot" });
        // 截图走 image 通道进当前轮上下文 —— 模型看得见画面;文件同时留在树里给用户
        return {
          output: `已截图保存到 ${rel}(${Math.round(bytes.length / 1024)} KB),并已作为图像交给你查看;文件在左侧树里,用户也可点开。`,
          image: { path: abs, mimeType: "image/png", size: bytes.length },
        };
      }
      default:
        return `error: 未知 action: ${act}`;
    }
  } catch (error) {
    return `error: ${error?.message || error}`;
  }
};
