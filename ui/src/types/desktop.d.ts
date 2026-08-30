// 壳(preload.cjs)经 contextBridge 暴露的窄桥。开发态(纯浏览器)不存在,全部可选。
export {};

declare global {
  interface Window {
    workbenchDesktop?: {
      /** 更新已下载后调用:退出并安装新版本。 */
      installUpdate: () => Promise<void>;

      /** 这台机器能不能导入 Chrome 登录态(macOS + 装了 Chrome)。 */
      chromeImportAvailable: () => Promise<boolean>;
      /** 导入 Chrome 登录态。系统会弹钥匙串授权,拒绝则 ok:false。 */
      importChromeCookies: () => Promise<
        { ok: true; profile: string; total: number; imported: number; failed: number }
        | { ok: false; error: string }
      >;
      /** 退出所有网站:清网页分区的 cookie 与站点数据。 */
      clearWebLogins: () => Promise<{ ok: boolean; error?: string }>;
      /** 清缓存:腾磁盘,不影响登录态。 */
      clearWebCache: () => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
