// workbench-sdk:iframe 面板与宿主之间唯一的语言。
//
// 面板运行在 sandbox="allow-scripts" 的 iframe 里(不透明源):摸不到宿主,也绝不直连
// 本地 http/ws —— 一切能力都从这里走 postMessage RPC,由宿主桥(PanelFrame)代为执行。
//
// 用法(见 PANEL.md):
//   <script src="../workbench-sdk.js"></script>
//   await workbench.ready();
//   workbench.tabs.open({ kind: "web", url: "github.com" });
//   const data = await workbench.storage.get();  await workbench.storage.set(data);
//
// 主题:宿主注入 --color-* 变量到 <html>,并在明暗切换时实时更新;
// 面板 CSS 直接用 var(--color-bg) 等 token,即可与宿主同肤。
(function () {
  "use strict";
  var seq = 0;
  var pending = new Map();
  var ctx = { panelId: "" };
  var resolveInit;
  var initPromise = new Promise(function (r) { resolveInit = r; });

  function applyTheme(msg) {
    var vars = msg.vars || {};
    for (var k in vars) document.documentElement.style.setProperty(k, vars[k]);
    if (msg.dark) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.wb !== 1) return;
    if (d.type === "init") { ctx = d.ctx || ctx; resolveInit(ctx); return; }
    if (d.type === "theme") { applyTheme(d); return; }
    if (d.type === "result") {
      var p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.ok) p.resolve(d.value);
      else p.reject(new Error(d.error || "rpc error"));
    }
  });

  function rpc(method, params) {
    return initPromise.then(function () {
      return new Promise(function (resolve, reject) {
        var id = ++seq;
        pending.set(id, { resolve: resolve, reject: reject });
        parent.postMessage({ wb: 1, type: "rpc", id: id, method: method, params: params || {} }, "*");
      });
    });
  }

  window.workbench = {
    ready: function () { return initPromise; },
    panelId: function () { return ctx.panelId; },
    tabs: {
      /** 打开标签页:{ kind: "web", url, title? } —— 同站已开由宿主聚焦去重。 */
      open: function (req) { return rpc("tabs.open", req); },
    },
    storage: {
      /** 本面板的私有 JSON(一板一份,宿主落库)。 */
      get: function () { return rpc("storage.get"); },
      set: function (value) { return rpc("storage.set", { value: value }); },
    },
    system: {
      openExternal: function (url) { return rpc("system.openExternal", { url: url }); },
      copyText: function (text) { return rpc("clipboard.write", { text: text }); },
    },
    dialog: {
      confirm: function (message, opts) {
        opts = opts || {};
        return rpc("dialog.confirm", { message: message, danger: !!opts.danger, confirmText: opts.confirmText });
      },
    },
  };

  // 握手:面板先喊 hello,宿主回 init + theme(不依赖 iframe onLoad 时序)
  parent.postMessage({ wb: 1, type: "hello" }, "*");
})();
