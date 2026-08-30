// 预加载:渲染层与壳之间唯一的窄桥(contextIsolation 下的白名单 API)。
// 只暴露最少的能力,每一条都对应界面上一个明确的用户动作。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workbenchDesktop", {
  /** 更新已下载后调用:退出并安装新版本。 */
  installUpdate: () => ipcRenderer.invoke("workbench:install-update"),

  /** 这台机器能不能导入 Chrome 登录态(macOS + 装了 Chrome)。 */
  chromeImportAvailable: () => ipcRenderer.invoke("workbench:chrome-import-available"),
  /** 导入 Chrome 登录态 —— 必须由界面上的明确点击触发,系统会弹钥匙串授权。 */
  importChromeCookies: () => ipcRenderer.invoke("workbench:import-chrome-cookies"),
  /** 退出所有网站:清网页分区的 cookie 与站点数据。 */
  clearWebLogins: () => ipcRenderer.invoke("workbench:clear-web-logins"),
  /** 清缓存:腾磁盘,不影响登录态。 */
  clearWebCache: () => ipcRenderer.invoke("workbench:clear-web-cache"),
});
