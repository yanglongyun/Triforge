// 「从浏览器导入」的共享状态与调用。
//
// 三个地方都要用它、且必须口径一致:网页标签顶部的引导条、⋯ 菜单、设置页。
// 导入过或用户主动关掉过,引导条就不再出现 —— 但菜单和设置页的入口永远在
// (换了 Chrome 账号、cookie 过期,都需要能再导一次)。
import { api } from "../api";

const STATE_KEY = "triforge.chromeImport.state";

export type ChromeProfile = { dir: string; name: string; email: string };
export type ImportChoice = { profile: string; cookies: boolean; bookmarks: boolean };
export type ImportResult = { profile: string; total: number; imported: number; failed: number; bookmarks: number };

const read = () => {
  try { return localStorage.getItem(STATE_KEY) || ""; } catch { return ""; }
};
const write = (value: string) => {
  try { localStorage.setItem(STATE_KEY, value); } catch { /* 隐私模式下写不进,不拦流程 */ }
};

/** 引导条该不该出现:没导过、没关过,才提示。 */
export const shouldPromptImport = () => !read();
export const markImported = () => write("done");
export const dismissImportPrompt = () => write("dismissed");

/** 这台机器能不能导(macOS + 装了 Chrome);非桌面壳一律 false。 */
export const chromeImportAvailable = async () => {
  try { return (await window.worktopDesktop?.chromeImportAvailable()) === true; } catch { return false; }
};

/** 列出可选的 Chrome 配置。取不到就返回空数组,由界面退化成「不用选」。 */
export const listChromeProfiles = async (): Promise<ChromeProfile[]> => {
  try {
    const result = await window.worktopDesktop?.chromeProfiles();
    return result?.ok ? result.profiles : [];
  } catch { return []; }
};

/**
 * 导入。cookie 由壳直接注入 session;书签落「网站」面板 ——
 * 主进程不认识产品的 HTTP API,所以这一步在界面这边做。
 */
export const importFromChrome = async (choice: ImportChoice): Promise<ImportResult> => {
  const bridge = window.worktopDesktop;
  if (!bridge) throw new Error("需要在桌面应用里使用");
  const result = await bridge.importChromeCookies(choice);
  if (!result.ok) throw new Error(result.error);

  // 去重不在这儿做:服务端建站点时已经按**主机**去重(见 service/sites.ts 的 siteKey),
  // 遇到已有的直接返回那一行、不插入。在客户端再写一套只会更弱(按 URL 比)且会和它打架。
  //
  // 这里只负责**数对**:返回的 id 在导入前就存在,或本次已经见过,都不算新增 ——
  // Chrome 的书签是按页面存的,同一个站往往有好几条(实测 103 条书签只落 97 个站)。
  let bookmarks = 0;
  if (choice.bookmarks && result.bookmarks.length) {
    const before = new Set((await api.listSites().catch(() => [])).map((site) => site.id));
    const added = new Set<string>();
    for (const bookmark of result.bookmarks) {
      try {
        const site = await api.createSite({ title: bookmark.title, url: bookmark.url });
        if (!site || before.has(site.id) || added.has(site.id)) continue;
        added.add(site.id);
        bookmarks += 1;
      } catch { /* 单条失败跳过,不因为一条坏书签毁掉整次导入 */ }
    }
  }

  markImported();
  return { profile: result.profile, total: result.total, imported: result.imported, failed: result.failed, bookmarks };
};
