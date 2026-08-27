// workbench-sdk:应用与宿主之间唯一的语言(应用契约 v1,见 APP.md)。
//
// 应用运行在 sandbox="allow-scripts" 的 iframe 里(不透明源):摸不到宿主,也不能直连
// 本地端口 —— 一切能力都从这里走 postMessage RPC,由宿主桥(AppFrame)按 manifest
// 声明的 capabilities 放行。主题变量由宿主注入并实时更新,CSS 直接用 var(--color-*)。
//
// 用法:
//   <script src="/apps/workbench-sdk.js"></script>
//   const ctx = await workbench.ready();          // { appId, mount, route }
//   await workbench.db.exec("CREATE TABLE IF NOT EXISTS ...");
(function () {
  "use strict";
  var seq = 0;
  var pending = new Map();
  var ctx = { appId: "", mount: "", route: "" };
  var resolveInit;
  var initPromise = new Promise(function (r) { resolveInit = r; });
  var handlers = new Map(); // event -> Set<fn>;内置事件:route

  function applyTheme(msg) {
    var vars = msg.vars || {};
    for (var k in vars) document.documentElement.style.setProperty(k, vars[k]);
    if (msg.dark) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
  }

  function dispatch(event, payload) {
    var set = handlers.get(event);
    if (set) set.forEach(function (fn) { try { fn(payload); } catch (e) { console.error(e); } });
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.wb !== 1) return;
    if (d.type === "init") { ctx = d.ctx || ctx; resolveInit(ctx); return; }
    if (d.type === "theme") { applyTheme(d); return; }
    if (d.type === "route") { ctx.route = String(d.route || ""); dispatch("route", ctx.route); return; }
    if (d.type === "appevent") { dispatch(String(d.event || ""), d.payload); return; }
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
    /** 等宿主握手,返回 { appId, mount, route }。 */
    ready: function () { return initPromise; },
    context: function () { return { appId: ctx.appId, mount: ctx.mount, route: ctx.route }; },
    /** 订阅事件:"route"(标签页收到新路由)或同应用其他实例 emit 的自定义事件。 */
    on: function (event, fn) {
      var set = handlers.get(event);
      if (!set) { set = new Set(); handlers.set(event, set); }
      set.add(fn);
      return function () { set.delete(fn); };
    },
    /** 广播给同应用的其他实例(自己不回声)。数据不搬,只打招呼。 */
    emit: function (event, payload) { return rpc("bus.emit", { event: event, payload: payload }); },

    storage: {
      get: function () { return rpc("storage.get"); },
      set: function (value) { return rpc("storage.set", { value: value }); },
    },
    /** 应用私有 SQLite(能力:db)。SELECT 返回 { rows },写返回 { changes, lastInsertRowid }。 */
    db: {
      exec: function (sql, params) { return rpc("db.exec", { sql: sql, params: params || [] }); },
    },
    tabs: {
      open: function (req) { return rpc("tabs.open", req); },
      /** 打开自己的标签页(能力:tabs):已开则聚焦并推送 route。 */
      openApp: function (req) { return rpc("tabs.openApp", req || {}); },
    },
    /** 调 AI(能力:ai):无状态单次补全,summary 必填,活动面板可见。返回 { text, tokens }。 */
    ai: {
      complete: function (req) { return rpc("ai.complete", req); },
    },
    /** 派活给智能体(能力:agent):能用工具、较重;活动可见,不进会话面板。返回 { agentId, text }。 */
    agent: {
      run: function (req) { return rpc("agent.run", req); },
    },
    /** 工作区文件(能力:fs:workspace,首次使用需用户授权;路径相对第一个工作区根)。 */
    fs: {
      read: function (req) { return rpc("fs.read", req); },
      write: function (req) { return rpc("fs.write", req); },
      list: function (req) { return rpc("fs.list", req); },
    },
    ui: {
      toast: function (message) { return rpc("ui.toast", { message: message }); },
    },
    dialog: {
      confirm: function (message, opts) {
        opts = opts || {};
        return rpc("dialog.confirm", { message: message, danger: !!opts.danger, confirmText: opts.confirmText });
      },
    },
    system: {
      openExternal: function (url) { return rpc("system.openExternal", { url: url }); },
      copyText: function (text) { return rpc("clipboard.write", { text: text }); },
    },
  };

  parent.postMessage({ wb: 1, type: "hello" }, "*");
})();
