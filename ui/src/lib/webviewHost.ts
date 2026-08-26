// 浏览器宿主的渲染进程一半(cdp 工具的执行端)。
// <webview> 元素只有渲染进程摸得到 —— executeJavaScript / capturePage / loadURL 都是
// 元素自带的方法,所以宿主就是 UI 自己:WebPanel 把元素登记进来,server 广播的
// cdp_request 在这里找到对应标签、执行、应答。不是自己的标签就沉默(别的窗口会答)。
import { useEffect } from "react";

export const IN_ELECTRON = navigator.userAgent.includes("Electron");

type Socket = {
  send: (m: any) => void;
  on: (t: string, fn: (p: any) => void) => () => void;
};

/** wcId(webContents id)→ <webview> 元素。 */
const registry = new Map<number, any>();

export const registerWebview = (wcId: number, el: any) => { registry.set(wcId, el); };
export const unregisterWebview = (wcId: number) => { registry.delete(wcId); };

/** 服务器重启后注册表清零 —— 广播这个事件让每个 WebPanel 重新注册。 */
export const RE_REGISTER_EVENT = "arbor:web-reregister";

const exec = async (el: any, op: string, params: any): Promise<any> => {
  switch (op) {
    case "navigate":
      await el.loadURL(String(params.url || ""));
      return "ok";
    case "back":
      el.goBack();
      return "ok";
    case "read":
      return await el.executeJavaScript(
        `(() => { const text = document.body ? document.body.innerText : ""; return { title: document.title, url: location.href, text: text.slice(0, 60000) }; })()`,
      );
    case "js": {
      const raw = await el.executeJavaScript(String(params.code || ""));
      if (raw === undefined) return "undefined";
      try { return JSON.stringify(raw, null, 2); } catch { return String(raw); }
    }
    case "click":
      return await el.executeJavaScript(`(() => {
        const target = document.querySelector(${JSON.stringify(String(params.selector || ""))});
        if (!target) return "error: 没找到元素 " + ${JSON.stringify(String(params.selector || ""))};
        target.scrollIntoView({ block: "center" });
        target.click();
        const text = (target.textContent || "").trim().slice(0, 40);
        return "已点击 " + target.tagName.toLowerCase() + (text ? ":" + text : "");
      })()`);
    case "type":
      return await el.executeJavaScript(`(() => {
        const target = document.querySelector(${JSON.stringify(String(params.selector || ""))});
        if (!target) return "error: 没找到元素 " + ${JSON.stringify(String(params.selector || ""))};
        target.focus();
        const text = ${JSON.stringify(String(params.text ?? ""))};
        if (target.isContentEditable) {
          document.execCommand("selectAll", false);
          document.execCommand("insertText", false, text);
        } else {
          const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && desc.set) desc.set.call(target, text); else target.value = text;
          target.dispatchEvent(new Event("input", { bubbles: true }));
          target.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return "已输入到 " + target.tagName.toLowerCase();
      })()`);
    case "screenshot": {
      const image = await el.capturePage();
      const dataUrl = image && typeof image.toDataURL === "function" ? image.toDataURL() : null;
      if (!dataUrl) throw new Error("当前环境不支持截图");
      return dataUrl;
    }
    default:
      throw new Error(`未知操作:${op}`);
  }
};

/** 挂在 App 顶层:声明宿主身份、应答 cdp 指令、断线重连后触发重注册。 */
export function useCdpHost(socket: Socket) {
  useEffect(() => {
    if (!IN_ELECTRON) return;
    socket.send({ type: "web_host_hello" });
    const offConnected = socket.on("connected", () => {
      // 每次(重)连上都重新声明 + 让 webview 重新注册(server 重启后注册表是空的)
      socket.send({ type: "web_host_hello" });
      window.dispatchEvent(new Event(RE_REGISTER_EVENT));
    });
    const offRequest = socket.on("cdp_request", async (p: any) => {
      const el = registry.get(Number(p.wcId));
      if (!el) return; // 不是这个窗口的标签,拥有它的窗口会应答
      try {
        const result = await exec(el, String(p.op || ""), p.params || {});
        socket.send({ type: "cdp_response", id: p.id, ok: true, result });
      } catch (e: any) {
        socket.send({ type: "cdp_response", id: p.id, ok: false, error: String(e?.message || e) });
      }
    });
    return () => { offConnected(); offRequest(); };
  }, [socket]);
}
