// electron-builder afterSign 钩子:向苹果提交公证并把票据 staple 进 .app。
//
// 凭据从环境变量读,缺任一个就**跳过**(不报错)——这样日常打包照旧出未公证包,
// 只有备齐凭据时才真正公证。所需环境变量(App 专用密码方式):
//   APPLE_ID                     Apple 账号邮箱
//   APPLE_APP_SPECIFIC_PASSWORD  appleid.apple.com 生成的 app 专用密码
//   APPLE_TEAM_ID                团队 ID(Chuan Zhi = 92696T726U)
//
// 出公证版一条命令:
//   APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx \
//   APPLE_TEAM_ID=92696T726U npm run dist:mac
const { notarize } = require("@electron/notarize");
const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("[notarize] 未配置 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID,跳过公证(出未公证包)。");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  // 随包的系统 node 在 extraResources(资源区),electron-builder 不会自动签它 ——
  // 公证要求 .app 内每个可执行都带 Hardened Runtime 签名,漏签会被拒。手动深签一次。
  const identity = "Chuan Zhi (Chengdu) Information Technology Co., Ltd. (92696T726U)";
  const nodeBin = `${appPath}/Contents/Resources/core/bin/node`;
  if (existsSync(nodeBin)) {
    console.log(`[notarize] 深签随包 node:${nodeBin}`);
    execFileSync("codesign", [
      "--force", "--timestamp", "--options", "runtime",
      "--entitlements", "desktop/build/entitlements.mac.plist",
      "--sign", identity, nodeBin,
    ], { stdio: "inherit" });
  }

  console.log(`[notarize] 提交公证:${appPath}(团队 ${APPLE_TEAM_ID})…可能需要几分钟。`);

  await notarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });

  console.log("[notarize] 公证通过并已 staple 票据。");
};
