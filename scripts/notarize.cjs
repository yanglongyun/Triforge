// electron-builder afterSign 钩子:向苹果提交公证并把票据 staple 进 .app。
//
// 两条标准凭据路,任选其一;都没有就**跳过**(不报错)——日常打包照旧出未公证包。
//
// 一、钥匙串凭据(推荐,密码只输一次,之后发版不再输):
//      xcrun notarytool store-credentials <profile> --apple-id you@example.com --team-id 92696T726U
//      APPLE_KEYCHAIN_PROFILE=<profile> npm run dist:mac
//      (团队已经存在 profile 里,不要再传 APPLE_TEAM_ID —— 两套凭据混用会被库直接拒)
//
// 二、环境变量(CI 用):
//      APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
//
// 团队:Chuan Zhi (Chengdu) = 92696T726U
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, APPLE_KEYCHAIN_PROFILE } = process.env;
  const byProfile = !!APPLE_KEYCHAIN_PROFILE;
  const byPassword = !!(APPLE_ID && APPLE_APP_SPECIFIC_PASSWORD);
  // 钥匙串凭据自带团队;环境变量那套才需要额外给 APPLE_TEAM_ID
  if (!byProfile && !(byPassword && APPLE_TEAM_ID)) {
    console.log("[notarize] 没有公证凭据(APPLE_KEYCHAIN_PROFILE,或 APPLE_ID+APPLE_APP_SPECIFIC_PASSWORD+APPLE_TEAM_ID),跳过公证。");
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;
  // 随包 node(extraResources)由 electron-builder 在 distribution 签名时一并带上
  // Hardened Runtime —— afterSign 里再 --force 重签它会破坏外层 app 的封印
  // (a sealed resource is missing or invalid),故不再手动深签,直接提交公证。
  console.log(`[notarize] 提交公证:${appPath}(凭据 ${byProfile ? "钥匙串 " + APPLE_KEYCHAIN_PROFILE : "环境变量,团队 " + APPLE_TEAM_ID})…可能需要几分钟。`);

  // 两套凭据不能混:钥匙串那套的团队已经存在 profile 里,再传 teamId 会被判成
  // 「同时用了密码凭据和钥匙串凭据」而直接报错。
  await notarize({
    tool: "notarytool",
    appPath,
    ...(byProfile
      ? { keychainProfile: APPLE_KEYCHAIN_PROFILE }
      : { appleId: APPLE_ID, appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD, teamId: APPLE_TEAM_ID }),
  });

  console.log("[notarize] 公证通过并已 staple 票据。");
};
