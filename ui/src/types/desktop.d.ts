// 壳(preload.cjs)经 contextBridge 暴露的窄桥。开发态(纯浏览器)不存在,全部可选。
export {};

declare global {
  interface Window {
    workbenchDesktop?: {
      /** 更新已下载后调用:退出并安装新版本。 */
      installUpdate: () => Promise<void>;
    };
  }
}
