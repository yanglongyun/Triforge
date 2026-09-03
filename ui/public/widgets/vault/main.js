// 密码库:导入 CSV → 本地 SQLite;搜索、显示/复制、编辑、删除、导出、清空。
const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
const sql = (q, params = []) => post("/_wt/sql", { sql: q, params });
const toast = (message) => post("/_wt/toast", { message }).catch(() => {});
const confirmAsk = (message) => post("/_wt/confirm", { message }).then((r) => !!r.confirmed).catch(() => false);
const $ = (id) => document.getElementById(id);

await sql(`CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

let entries = [];
let revealed = new Set();
let editingId = null;

const hostOf = (url) => { try { return new URL(/^https?:/i.test(url) ? url : `https://${url}`).host; } catch { return ""; } };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const mark = (text, q) => {
  const t = esc(text);
  if (!q) return t;
  const i = t.toLowerCase().indexOf(esc(q).toLowerCase());
  return i < 0 ? t : `${t.slice(0, i)}<mark>${t.slice(i, i + q.length)}</mark>${t.slice(i + q.length)}`;
};

const load = async () => {
  const { rows } = await sql("SELECT * FROM entries ORDER BY lower(name), lower(username), id");
  entries = rows || [];
  render();
};

const render = () => {
  const q = $("q").value.trim();
  const ql = q.toLowerCase();
  const shown = q
    ? entries.filter((e) => [e.name, e.url, e.username, e.note].some((v) => String(v || "").toLowerCase().includes(ql)))
    : entries;
  $("count").textContent = entries.length ? (q ? `${shown.length} / ${entries.length} 条` : `${entries.length} 条`) : "";
  $("empty").hidden = entries.length > 0;
  $("list").innerHTML = shown.map((e) => {
    const host = hostOf(e.url);
    const open = revealed.has(e.id);
    return `<li data-id="${e.id}">
      <div class="row1">
        ${host ? `<img class="fav" alt="" src="https://icons.duckduckgo.com/ip3/${esc(host)}.ico" onerror="this.remove()">` : ""}
        <span class="name" data-act="edit" title="编辑">${mark(e.name || host || "(未命名)", q)}</span>
        <button class="iconbtn" data-act="edit" title="编辑">✎</button>
      </div>
      <div class="row2">
        <span class="user" title="${esc(e.username)}">${mark(e.username, q) || '<i class="dim">无账号</i>'}</span>
        ${e.username ? `<button class="iconbtn" data-act="copyuser" title="复制账号">👤</button>` : ""}
      </div>
      <div class="row2">
        <span class="pw ${open ? "" : "masked"}">${open ? esc(e.password) : "••••••••••"}</span>
        <button class="iconbtn" data-act="reveal" title="${open ? "隐藏" : "显示"}">${open ? "🙈" : "👁"}</button>
        <button class="iconbtn" data-act="copypass" title="复制密码">📋</button>
      </div>
      ${e.url && q && String(e.url).toLowerCase().includes(ql) ? `<div class="url">${mark(e.url, q)}</div>` : ""}
      ${e.note ? `<div class="note">${mark(e.note, q)}</div>` : ""}
    </li>`;
  }).join("");
  if (q && !shown.length) $("list").innerHTML = `<div class="empty">没有匹配的条目</div>`;
};

// 图标走外网会被 CSP 挡住(组件断网),挡住就静默去掉 —— 上面的 onerror 处理了
const copy = async (text, what) => {
  try { await navigator.clipboard.writeText(text); toast(`${what}已复制`); }
  catch { toast("复制失败"); }
};

$("list").addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-act]");
  if (!btn) return;
  const li = ev.target.closest("li");
  const e = entries.find((x) => x.id === Number(li.dataset.id));
  if (!e) return;
  const act = btn.dataset.act;
  if (act === "reveal") { revealed.has(e.id) ? revealed.delete(e.id) : revealed.add(e.id); render(); }
  else if (act === "copypass") copy(e.password, "密码");
  else if (act === "copyuser") copy(e.username, "账号");
  else if (act === "edit") openEditor(e);
});

$("q").addEventListener("input", render);
$("q").addEventListener("keydown", (ev) => { if (ev.key === "Escape") { $("q").value = ""; render(); } });

// ── 编辑器 ──
const openEditor = (e) => {
  editingId = e ? e.id : null;
  $("etitle").textContent = e ? "编辑" : "新增";
  $("ename").value = e?.name || ""; $("eurl").value = e?.url || ""; $("euser").value = e?.username || "";
  $("epass").value = e?.password || ""; $("enote").value = e?.note || "";
  $("epass").type = "password";
  $("edelete").hidden = !e;
  $("editor").hidden = false;
  $("editor").scrollIntoView({ block: "nearest" });
  $(e ? "epass" : "ename").focus();
};
const closeEditor = () => { $("editor").hidden = true; editingId = null; };
$("add").onclick = () => openEditor(null);
$("ecancel").onclick = closeEditor;
$("etoggle").onclick = () => { $("epass").type = $("epass").type === "password" ? "text" : "password"; };
$("esave").onclick = async () => {
  const v = { name: $("ename").value.trim(), url: $("eurl").value.trim(), username: $("euser").value.trim(), password: $("epass").value, note: $("enote").value.trim() };
  if (!v.name && !v.url && !v.username && !v.password) { toast("至少填一项"); return; }
  if (editingId == null) {
    await sql("INSERT INTO entries (name, url, username, password, note) VALUES (?, ?, ?, ?, ?)", [v.name, v.url, v.username, v.password, v.note]);
  } else {
    await sql("UPDATE entries SET name=?, url=?, username=?, password=?, note=?, updated_at=datetime('now') WHERE id=?", [v.name, v.url, v.username, v.password, v.note, editingId]);
  }
  closeEditor(); await load();
};
$("edelete").onclick = async () => {
  if (editingId == null) return;
  if (!(await confirmAsk("删除这条密码?不可恢复。"))) return;
  await sql("DELETE FROM entries WHERE id=?", [editingId]);
  closeEditor(); await load();
};

// ── 菜单:导入 / 导出 / 清空 ──
$("more").onclick = (ev) => { ev.stopPropagation(); $("menu").hidden = !$("menu").hidden; };
document.addEventListener("click", (ev) => { if (!ev.target.closest("#menu")) $("menu").hidden = true; });

/** 解析 CSV:引号、引号内逗号与换行、双引号转义都认。 */
const parseCsv = (text) => {
  const rows = []; let row = [], cell = "", inQ = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
};

/** 按表头认列:Chrome / Edge / Safari / Bitwarden / 1Password / KeePass 的导出都能对上。 */
const COLS = {
  name: ["name", "title", "账号名称", "名称", "站点", "site"],
  url: ["url", "login_uri", "website", "web site", "网址", "login uri"],
  username: ["username", "login_username", "user name", "login", "email", "用户名", "账号"],
  password: ["password", "login_password", "密码"],
  note: ["note", "notes", "备注", "extra"],
};
const importRows = async (rows) => {
  if (!rows.length) return 0;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(COLS)) idx[key] = header.findIndex((h) => names.includes(h));
  if (idx.password < 0) { toast("没找到密码列:CSV 第一行要有 password / 密码 这样的表头"); return 0; }
  const existing = new Set(entries.map((e) => `${e.url} ${e.username} ${e.password}`));
  const statements = [];
  for (const r of rows.slice(1)) {
    const v = Object.fromEntries(Object.keys(COLS).map((k) => [k, idx[k] >= 0 ? String(r[idx[k]] ?? "").trim() : ""]));
    if (!v.password && !v.username) continue;
    if (!v.name) v.name = hostOf(v.url) || v.username;
    const key = `${v.url} ${v.username} ${v.password}`;
    if (existing.has(key)) continue; // 同网址同账号同密码的不重复导
    existing.add(key);
    statements.push({ sql: "INSERT INTO entries (name, url, username, password, note) VALUES (?, ?, ?, ?, ?)", params: [v.name, v.url, v.username, v.password, v.note] });
  }
  if (statements.length) await post("/_wt/sql/batch", { statements });
  return statements.length;
};
$("import").onclick = () => { $("menu").hidden = true; $("file").click(); };
$("file").onchange = async () => {
  const f = $("file").files[0]; $("file").value = "";
  if (!f) return;
  try {
    const n = await importRows(parseCsv(await f.text()));
    await load();
    toast(n ? `导入 ${n} 条` : "没有新条目(都已存在或没识别出列)");
  } catch (e) { toast(`导入失败:${e.message}`); }
};

const toCsv = () => {
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  return ["name,url,username,password,note", ...entries.map((e) => [e.name, e.url, e.username, e.password, e.note].map(q).join(","))].join("\n");
};
$("export").onclick = async () => {
  $("menu").hidden = true;
  if (!entries.length) { toast("库是空的"); return; }
  await copy(toCsv(), `CSV(${entries.length} 条)`);
};
$("download").onclick = () => {
  $("menu").hidden = true;
  if (!entries.length) { toast("库是空的"); return; }
  const blob = new Blob(["﻿" + toCsv()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `passwords-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("clear").onclick = async () => {
  $("menu").hidden = true;
  if (!entries.length) return;
  if (!(await confirmAsk(`清空全部 ${entries.length} 条密码?不可恢复。`))) return;
  await sql("DELETE FROM entries");
  revealed = new Set(); closeEditor(); await load(); toast("已清空");
};

await load();
