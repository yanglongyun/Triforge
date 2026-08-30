// 「从 Chrome 导入登录状态」的共享状态。
//
// 三个地方都要用它、且必须口径一致:网页标签顶部的引导条、⋯ 菜单、设置页。
// 导入过或用户主动关掉过,引导条就不再出现 —— 但菜单和设置页的入口永远在
// (换了 Chrome 账号、cookie 过期,都需要能再导一次)。
const STATE_KEY = "triforge.chromeImport.state";

export type ImportResult = { profile: string; total: number; imported: number; failed: number };

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

/** 导入。成功返回统计,失败抛出人话错误(钥匙串授权被拒最常见)。 */
export const importChromeCookies = async (): Promise<ImportResult> => {
  const bridge = window.workbenchDesktop;
  if (!bridge) throw new Error("需要在桌面应用里使用");
  const result = await bridge.importChromeCookies();
  if (!result.ok) throw new Error(result.error);
  markImported();
  return { profile: result.profile, total: result.total, imported: result.imported, failed: result.failed };
};
