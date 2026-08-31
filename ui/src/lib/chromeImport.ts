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
  try { return (await window.workbenchDesktop?.chromeImportAvailable()) === true; } catch { return false; }
};

/** 列出可选的 Chrome 配置。取不到就返回空数组,由界面退化成「不用选」。 */
export const listChromeProfiles = async (): Promise<ChromeProfile[]> => {
  try {
    const result = await window.workbenchDesktop?.chromeProfiles();
    return result?.ok ? result.profiles : [];
  } catch { return []; }
};

/**
 * 导入。cookie 由壳直接注入 session;书签落「网站」面板 ——
 * 主进程不认识产品的 HTTP API,所以这一步在界面这边做。
 */
export const importFromChrome = async (choice: ImportChoice): Promise<ImportResult> => {
  const bridge = window.workbenchDesktop;
  if (!bridge) throw new Error("需要在桌面应用里使用");
  const result = await bridge.importChromeCookies(choice);
  if (!result.ok) throw new Error(result.error);

  let bookmarks = 0;
  if (choice.bookmarks && result.bookmarks.length) {
    const existing = new Set((await api.listSites().catch(() => [])).map((site) => site.url));
    for (const bookmark of result.bookmarks) {
      if (existing.has(bookmark.url)) continue;   // 导第二次不该出现一堆重复
      try { await api.createSite({ title: bookmark.title, url: bookmark.url }); bookmarks += 1; } catch { /* 单条失败跳过 */ }
    }
  }

  markImported();
  return { profile: result.profile, total: result.total, imported: result.imported, failed: result.failed, bookmarks };
};
