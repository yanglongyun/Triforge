// Chrome cookie 提取器 —— **必须在 Node 22 下跑**。
//
// 为什么单独一个文件:它依赖 `node:sqlite`,而那是 Node 22.5 才有的内置模块,
// Electron 33 内置的 Node 是 20.18 —— 在主进程里 import 它会直接抛
// 「No such built-in module」。所以这一半交给应用自带的 Node 22 运行时执行,
// 结果以 JSON 打到 stdout,由主进程注入 session。
//
// 这个坑吞了整个功能:主进程那边 try/catch 静默返回 false,
// 表现成「需要 macOS 上装有 Chrome」,和装没装 Chrome 毫无关系。
import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
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
  const work = mkdtempSync(join(tmpdir(), "worktop-cookies-"));
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


/** Chrome 自己记的 profile 显示名与账号,在 Local State 里。 */
const profileLabels = () => {
  try {
    const state = JSON.parse(readFileSync(join(CHROME_DIR, "Local State"), "utf8"));
    return state?.profile?.info_cache || {};
  } catch { return {}; }
};

/** 可选的 profile:目录名 + 用户看得懂的名字。 */
const listProfiles = () => {
  const labels = profileLabels();
  return chromeProfiles().map((profile) => ({
    dir: profile.name,
    name: labels[profile.name]?.name || profile.name,
    email: labels[profile.name]?.user_name || "",
    usedAt: profile.usedAt,
  }));
};

/** 书签:纯 JSON,不加密。拍平成 { title, url }。 */
const readBookmarks = (dir) => {
  const file = join(CHROME_DIR, dir, "Bookmarks");
  if (!existsSync(file)) return [];
  let roots;
  try { roots = JSON.parse(readFileSync(file, "utf8"))?.roots || {}; } catch { return []; }
  // 树原样带回:{ title, url } 是书签,{ title, children } 是文件夹。
  // 只要 http(s):chrome:// 与 javascript: 这类进了「网站」面板也打不开;空文件夹不要。
  const walk = (node) => {
    if (!node) return null;
    if (node.type === "url") {
      const url = String(node.url || "");
      return /^https?:\/\//i.test(url) ? { title: String(node.name || ""), url } : null;
    }
    const children = (node.children || []).map(walk).filter(Boolean);
    return children.length ? { title: String(node.name || ""), children } : null;
  };
  const out = [];
  // 书签栏的内容直接放顶层;其他根(其他书签 / 移动设备书签)各成一个文件夹
  const bar = walk(roots.bookmark_bar);
  if (bar) out.push(...bar.children);
  for (const [key, root] of Object.entries(roots)) {
    if (key === "bookmark_bar") continue;
    const folder = walk(root);
    if (folder) out.push(folder);
  }
  return out;
};

/** Chrome 的密码库 Login Data:password_value 和 cookie 同一套加密(v10 + Safe Storage 派生密钥)。 */
const readPasswords = (dir, key) => {
  const source = join(CHROME_DIR, dir, "Login Data");
  if (!existsSync(source)) return [];
  const work = mkdtempSync(join(tmpdir(), "worktop-logins-"));
  let db;
  try {
    const copy = join(work, "Login Data");
    copyFileSync(source, copy);
    for (const suffix of ["-wal", "-shm", "-journal"]) if (existsSync(source + suffix)) copyFileSync(source + suffix, copy + suffix);
    db = new DatabaseSync(copy, { readOnly: true });
    const rows = db.prepare("SELECT origin_url, username_value, password_value FROM logins WHERE blacklisted_by_user = 0").all();
    const out = [];
    for (const row of rows) {
      let password = "";
      try { password = row.password_value?.length ? decryptCookie(row.password_value, key, "") : ""; } catch { password = ""; }
      if (!password && !row.username_value) continue;
      out.push({ url: String(row.origin_url || ""), username: String(row.username_value || ""), password });
    }
    return out;
  } finally {
    try { db?.close(); } catch { /* 无所谓 */ }
    rmSync(work, { recursive: true, force: true });
  }
};

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") || "";

try {
  if (process.platform !== "darwin") throw new Error("目前只支持从 macOS 版 Chrome 导入");

  if (process.argv.includes("--list")) {
    process.stdout.write(JSON.stringify({ ok: true, profiles: listProfiles() }));
  } else {
    const want = (arg("what") || "cookies").split(",").filter(Boolean);
    const dir = arg("profile") || chromeProfiles()[0]?.name;
    if (!dir) throw new Error("没有找到 Chrome 的 Cookie 数据库");

    const result = { ok: true, profile: dir, cookies: [], bookmarks: [], passwords: [] };

    const needKey = want.includes("cookies") || want.includes("passwords");
    const key = needKey ? storageKey() : null; // 钥匙串授权在这一步弹;只导书签时不会打扰用户
    if (want.includes("passwords")) result.passwords = readPasswords(dir, key);
    if (want.includes("cookies")) {
      result.cookies = readCookies(join(CHROME_DIR, dir, "Cookies")).map((row) => {
        const host = String(row.host_key || "");
        let value = "";
        try {
          value = row.encrypted_value?.length ? decryptCookie(row.encrypted_value, key, host) : String(row.value || "");
        } catch { value = ""; }
        return {
          host, name: String(row.name || ""), value, path: String(row.path || "/"),
          secure: Boolean(row.is_secure), httpOnly: Boolean(row.is_httponly),
          sameSite: SAME_SITE[String(row.samesite)] || "unspecified",
          persistent: Boolean(row.is_persistent), expires: toUnixSeconds(row.expires_seconds),
        };
      });
    }

    if (want.includes("bookmarks")) result.bookmarks = readBookmarks(dir);

    process.stdout.write(JSON.stringify(result));
  }
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message || error) }));
}
