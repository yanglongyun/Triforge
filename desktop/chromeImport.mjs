// 从 Chrome 导入登录状态 —— 主进程侧。
//
// **这里不能碰 `node:sqlite`**:它是 Node 22.5 的内置模块,而 Electron 33 内置的
// Node 是 20.18,import 会直接抛「No such built-in module」。读库解密那一半放在
// `chromeExtract.mjs`,由应用自带的 Node 22 运行时执行,结果走 stdout 的 JSON 回来。
//
// 这个坑曾经吞掉整个功能:主进程 try/catch 静默返回 false,界面表现成
// 「需要 macOS 上装有 Chrome」,和装没装 Chrome 毫无关系。
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CHROME_DIR = join(homedir(), "Library", "Application Support", "Google", "Chrome");

/** 有 cookie 库的 Chrome 配置。纯文件检查,不需要 sqlite,主进程里跑得动。 */
const chromeProfiles = () => {
  if (!existsSync(CHROME_DIR)) return [];
  return readdirSync(CHROME_DIR)
    .filter((name) => name === "Default" || name.startsWith("Profile "))
    .filter((name) => existsSync(join(CHROME_DIR, name, "Cookies")));
};

/** Chrome 装没装、能不能导 —— 界面据此决定按钮是否可用。 */
export const chromeImportAvailable = () =>
  process.platform === "darwin" && chromeProfiles().length > 0;

/** 跑提取器。**必须用 Node 22**,不能用 Electron 自己的 node。 */
const extract = (runtime, args) => new Promise((resolve, reject) => {
  // 钥匙串授权框会在这一步弹出来,用户可能要想一会儿,给足时间
  execFile(runtime.nodeBin, [runtime.script, ...args], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
    if (error && !stdout) { reject(new Error(error.message)); return; }
    try { resolve(JSON.parse(stdout)); }
    catch { reject(new Error("提取器没有返回可解析的结果")); }
  });
});

/** 可选的 Chrome 配置,带用户看得懂的名字(Chrome 自己记在 Local State 里)。 */
export const listChromeProfiles = async (runtime) => {
  const result = await extract(runtime, ["--list"]);
  if (!result.ok) throw new Error(result.error || "读不到 Chrome 配置");
  return result.profiles;
};

/**
 * 导入。
 * @param targetSession Electron session(网页标签用的 persist:web)
 * @param runtime { nodeBin, script } 由 main.js 按开发/打包两种布局给出
 * @param options { profile, cookies, bookmarks, passwords } 用户在对话框里选的
 */
export const importChromeCookies = async (targetSession, runtime, options = {}) => {
  if (process.platform !== "darwin") throw new Error("目前只支持从 macOS 版 Chrome 导入");
  if (!chromeProfiles().length) throw new Error("没有找到 Chrome 的 Cookie 数据库");

  const want = [options.cookies !== false && "cookies", options.bookmarks && "bookmarks", options.passwords && "passwords"].filter(Boolean);
  if (!want.length) throw new Error("没有选择要导入的数据");

  const args = [`--what=${want.join(",")}`];
  if (options.profile) args.push(`--profile=${options.profile}`);
  const result = await extract(runtime, args);
  if (!result.ok) throw new Error(result.error || "读取 Chrome 数据失败");

  let imported = 0;
  let failed = 0;
  for (const cookie of result.cookies) {
    const bare = String(cookie.host || "").replace(/^\./, "");
    if (!bare || !cookie.value) { failed += 1; continue; }
    // Chrome 的 host_key 带前导点 = 域 cookie,不带 = **仅限该主机**。
    // 这个区别不能抹掉:一律带 domain 会把 host-only 的悄悄放宽到子域,
    // 更要命的是 `__Host-` 前缀的 cookie 规范上就**禁止带 Domain**,带了直接被拒 ——
    // 而 __Host-GAPS / __Host-1PLSID 正是 Google 登录流程要用的那几个,
    // 少了它们 Google 会判定 cookie 集不一致,停在 accounts.google.com/CookieMismatch。
    const hostOnly = !String(cookie.host || "").startsWith(".");
    try {
      await targetSession.cookies.set({
        url: `${cookie.secure ? "https" : "http"}://${bare}${cookie.path || "/"}`,
        name: cookie.name,
        value: cookie.value,
        ...(hostOnly ? {} : { domain: cookie.host }),
        path: cookie.path || "/",
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite || "unspecified",
        ...(cookie.persistent ? { expirationDate: cookie.expires } : {}),
      });
      imported += 1;
    } catch {
      // 过期的、host 畸形的 —— 逐条跳过,不因为一条坏数据毁掉整次导入
      failed += 1;
    }
  }
  // 书签交给界面去写「网站」面板 —— 主进程不认识产品的 HTTP API
  return {
    profile: result.profile,
    total: result.cookies.length,
    imported,
    failed,
    bookmarks: result.bookmarks || [],
    passwords: result.passwords || [],
  };
};
