// 壳(preload.cjs)经 contextBridge 暴露的窄桥。开发态(纯浏览器)不存在,全部可选。
export {};

declare global {
  interface Window {
    workbenchDesktop?: {
      /** 更新已下载后调用:退出并安装新版本。 */
      installUpdate: () => Promise<void>;

      /** 这台机器能不能导入 Chrome 登录态(macOS + 装了 Chrome)。 */
      chromeImportAvailable: () => Promise<boolean>;
      /** 可选的 Chrome 配置,带用户看得懂的名字。 */
      chromeProfiles: () => Promise<
        { ok: true; profiles: { dir: string; name: string; email: string }[] }
        | { ok: false; error: string }
      >;
      /** 导入。选 cookies 时系统会弹钥匙串授权,拒绝则 ok:false。 */
      importChromeCookies: (options?: { profile?: string; cookies?: boolean; bookmarks?: boolean }) => Promise<
        { ok: true; profile: string; total: number; imported: number; failed: number;
          bookmarks: { title: string; url: string }[] }
        | { ok: false; error: string }
      >;
      /** 回答浏览器抛上来的问询(权限 true/false;HTTP 认证 {username,password} 或 null)。 */
      answerWebPrompt: (id: string, value: unknown) => Promise<boolean>;
      /** 证书警告上点了「仍要继续」:本次运行内信任这个域名。 */
      trustCertHost: (host: string) => Promise<boolean>;
      /** 清空已授予的网站权限与证书例外。 */
      forgetWebPermissions: () => Promise<boolean>;
      /** 退出所有网站:清网页分区的 cookie 与站点数据。 */
      clearWebLogins: () => Promise<{ ok: boolean; error?: string }>;
      /** 清缓存:腾磁盘,不影响登录态。 */
      clearWebCache: () => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
