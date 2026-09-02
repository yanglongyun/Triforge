// 主题:跟随系统 / 浅色 / 深色。偏好存 localStorage(本机视觉偏好,不进服务端设置);
// 生效方式 = 根元素 data-theme,styles.css 里变量整体翻转。
// index.html 的内联脚本在首帧前先写一次,这里负责运行期切换与跟随系统变化。
export type ThemePref = "system" | "light" | "dark";

const KEY = "worktop.theme";
/** 主题实际翻转时广播(CodeMirror 等命令式组件靠它重建配色)。 */
export const THEME_EVENT = "worktop:theme-changed";

export const getThemePref = (): ThemePref => {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
};

export const resolvedTheme = (): "light" | "dark" =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

const apply = (pref: ThemePref) => {
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const next = dark ? "dark" : "light";
  if (document.documentElement.dataset.theme !== next) {
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event(THEME_EVENT));
  }
};

export const setThemePref = (pref: ThemePref) => {
  try { localStorage.setItem(KEY, pref); } catch { /* 私隐模式存不了就只影响本次 */ }
  apply(pref);
};

/** App 启动时调一次:对齐偏好 + 跟随系统深浅变化(仅偏好为 system 时生效)。 */
export const initTheme = () => {
  apply(getThemePref());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getThemePref() === "system") apply("system");
  });
};
