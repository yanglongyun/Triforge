// 从用户真实的 Chrome 把登录状态搬进网页标签的 session 分区。
//
// 这件事只能由界面上的明确点击触发:cookie 等价于登录凭据,不能在后台静默读取。
// 解密密钥在 macOS 钥匙串里,取用时系统会弹授权框 —— 那就是本功能的安全闸门,
// 用户拒绝就整次停止。
//
// 只做 macOS:Windows 的 Chrome 从 v127 起上了 App-Bound Encryption(密钥绑到
// chrome.exe 本身),Linux 又是另一套 Secret Service —— 与其写半吊子的兼容分支,
// 不如诚实报错。
import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CHROME_DIR = join(homedir(), "Library", "Application Support", "Google", "Chrome");
const SALT = "saltysalt";
const ITERATIONS = 1003;
const KEY_LENGTH = 16;

/** 有 cookie 库的 Chrome 配置,按最近使用排前面(多 Profile 的人通常只有一个在用)。 */
const chromeProfiles = () => {
  if (!existsSync(CHROME_DIR)) return [];
  return readdirSync(CHROME_DIR)
    .filter((name) => name === "Default" || name.startsWith("Profile "))
    .map((name) => ({ name, cookies: join(CHROME_DIR, name, "Cookies") }))
    .filter((profile) => existsSync(profile.cookies))
    .map((profile) => ({ ...profile, usedAt: statSync(profile.cookies).mtimeMs }))
    .sort((a, b) => b.usedAt - a.usedAt);
};

/** 取 Chrome Safe Storage 密码并派生 cookie 解密密钥(这一步会弹钥匙串授权)。 */
const storageKey = () => {
  const candidates = [
    join(homedir(), "Library", "Keychains", "login.keychain-db"),
    join(homedir(), "Library", "Keychains", "login.keychain"),
    null, // 交给 security 自己找默认钥匙串
  ];
  for (const keychain of candidates) {
    if (keychain && !existsSync(keychain)) continue;
    try {
      const password = execFileSync("security", [
        "find-generic-password", "-w",
        "-s", "Chrome Safe Storage", "-a", "Chrome",
        ...(keychain ? [keychain] : []),
      ], { encoding: "utf8" }).trim();
      if (password) return pbkdf2Sync(password, SALT, ITERATIONS, KEY_LENGTH, "sha1");
    } catch { /* 授权被拒或这个钥匙串里没有,试下一个候选 */ }
  }
  throw new Error("拿不到钥匙串里的 Chrome 密钥 —— 授权被拒绝,或这台机器上没装 Chrome");
};

/** v10/v11 是 AES-128-CBC;新版 Chrome 明文前还有 32 字节的 sha256(host)。 */
const decryptCookie = (blob, key, host) => {
  if (!blob?.length) return "";
  const buffer = Buffer.from(blob);
  const tag = buffer.subarray(0, 3).toString("latin1");
  if (tag !== "v10" && tag !== "v11") return buffer.toString("utf8");

  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  decipher.setAutoPadding(false);
  let plain = Buffer.concat([decipher.update(buffer.subarray(3)), decipher.final()]);

  const pad = plain[plain.length - 1];
  if (pad > 0 && pad <= 16) plain = plain.subarray(0, plain.length - pad);

  if (plain.length > 32 && host) {
    const expected = createHash("sha256").update(host).digest();
    if (plain.subarray(0, 32).equals(expected)) plain = plain.subarray(32);
  }
  return plain.toString("utf8");
};

/** Chrome 的 1601 纪元秒 → Unix 秒。 */
const toUnixSeconds = (since1601) => Number(since1601) - 11644473600;

const SAME_SITE = { "-1": "unspecified", 0: "no_restriction", 1: "lax", 2: "strict" };

/** Chrome 运行时抓着库不放,所以连 WAL/SHM 一起拷到临时目录再只读打开。 */
const readCookies = (source) => {
  const work = mkdtempSync(join(tmpdir(), "triforge-cookies-"));
  let db;
  try {
    const copy = join(work, "Cookies");
    copyFileSync(source, copy);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix);
    }
    db = new DatabaseSync(copy, { readOnly: true });
    // expires_utc 是 1601 纪元的**微秒**,会超过 JS 安全整数;先让 SQLite 除
    return db.prepare(`
      SELECT host_key, name, encrypted_value, value, path,
             expires_utc / 1000000.0 AS expires_seconds,
             is_secure, is_httponly, samesite, is_persistent
      FROM cookies
    `).all();
  } finally {
    db?.close();
    rmSync(work, { recursive: true, force: true });
  }
};

/** 把最近使用的 Chrome 配置里的登录状态灌进给定 session。 */
export const importChromeCookies = async (targetSession) => {
  if (process.platform !== "darwin") throw new Error("目前只支持从 macOS 版 Chrome 导入");
  const profile = chromeProfiles()[0];
  if (!profile) throw new Error("没有找到 Chrome 的 Cookie 数据库");

  const key = storageKey();
  const rows = readCookies(profile.cookies);
  let imported = 0;
  let failed = 0;

  for (const row of rows) {
    const host = String(row.host_key || "");
    const bare = host.replace(/^\./, "");
    if (!bare) { failed += 1; continue; }
    try {
      const value = row.encrypted_value?.length
        ? decryptCookie(row.encrypted_value, key, host)
        : String(row.value || "");
      await targetSession.cookies.set({
        url: `${row.is_secure ? "https" : "http"}://${bare}${row.path || "/"}`,
        name: String(row.name || ""),
        value,
        domain: host,
        path: String(row.path || "/"),
        secure: Boolean(row.is_secure),
        httpOnly: Boolean(row.is_httponly),
        sameSite: SAME_SITE[String(row.samesite)] || "unspecified",
        ...(row.is_persistent ? { expirationDate: toUnixSeconds(row.expires_seconds) } : {}),
      });
      imported += 1;
    } catch {
      // 过期的、host 畸形的、解不开的 —— 逐条跳过,不因为一条坏数据毁掉整次导入
      failed += 1;
    }
  }

  return { profile: profile.name, total: rows.length, imported, failed };
};

/** Chrome 装没装、能不能导 —— 界面据此决定按钮是否可用。 */
export const chromeImportAvailable = () =>
  process.platform === "darwin" && chromeProfiles().length > 0;
