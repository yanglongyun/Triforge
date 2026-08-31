// 自动更新(electron-updater)。
//
// 打包时 esbuild 捆成 desktop/updater.mjs 随包发(app 不带 node_modules,不能裸 import);
// 开发态没有这个产物,main.js 动态 import 失败即静默跳过 —— 开发本来也不更新。
//
// 更新源:electron-builder 因 publish 配置把 app-update.yml 埋进包里,
// 指向 https://r2.iimos.ai/mainbench/mac-arm64/(latest-mac.yml + zip 差量)。
// 流程:启动静默检查 → 有新版后台下载 → 下载完通知界面出「重启更新」气泡。
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export const setupUpdater = ({ onReady } = {}) => {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // 用户不点「重启更新」,下次退出时也会装上
  autoUpdater.on("update-downloaded", (info) => onReady?.(String(info?.version || "")));
  autoUpdater.on("error", () => { /* 网络不通等,静默;手动检查有自己的报错 */ });

  const check = () => autoUpdater.checkForUpdates().catch(() => null);
  setTimeout(check, 10_000);                 // 启动 10s 后首查,别抢启动性能
  setInterval(check, 6 * 60 * 60 * 1000);    // 之后每 6 小时

  return {
    checkNow: () => autoUpdater.checkForUpdates(),
    install: () => autoUpdater.quitAndInstall(),
  };
};
