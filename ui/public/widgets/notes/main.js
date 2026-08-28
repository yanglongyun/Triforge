const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const sql = (sql, params = []) => post("/_wb/sql", { sql, params });

await sql(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

const esc = (s) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

const render = async () => {
  const { rows } = await sql("SELECT * FROM notes ORDER BY id DESC LIMIT 50");
  list.innerHTML = rows.map((n) => `
    <li><span>${esc(n.text)}</span><em>${n.at.slice(5, 16)}</em>
    <button data-del="${n.id}">×</button></li>`).join("") || "<li class=\"empty\">还没有记录</li>";
};

form.onsubmit = async (e) => {
  e.preventDefault();
  const value = text.value.trim();
  if (!value) return;
  await sql("INSERT INTO notes (text) VALUES (?)", [value]);
  text.value = "";
  render();
};

list.onclick = async (e) => {
  const id = e.target.dataset?.del;
  if (!id) return;
  await sql("DELETE FROM notes WHERE id = ?", [id]);
  render();
};

// ai 权限:每次调用 summary 必填,会落进宿主的活动流水
sum.onclick = async () => {
  const { rows } = await sql("SELECT text FROM notes ORDER BY id DESC LIMIT 50");
  if (!rows.length) return;
  out.hidden = false;
  out.textContent = "整理中…";
  const r = await post("/_wb/ai", {
    summary: "把速记整理成要点",
    system: "你是一个中文助理。把用户零散的速记归纳成 3-6 条要点,每条一行,直接输出要点,不要开场白。",
    prompt: rows.map((n, i) => `${i + 1}. ${n.text}`).join("\n"),
  });
  out.textContent = r.ok ? r.text : `出错了:${r.error}`;
};

render();
