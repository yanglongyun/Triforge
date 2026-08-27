// 预加载:渲染层与壳之间唯一的窄桥(contextIsolation 下的白名单 API)。
// 只暴露最少的能力 —— 目前仅「安装已下载的更新」。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workbenchDesktop", {
  /** 更新已下载后调用:退出并安装新版本。 */
  installUpdate: () => ipcRenderer.invoke("workbench:install-update"),
});
