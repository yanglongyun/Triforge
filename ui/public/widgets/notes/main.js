const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const sql = (q, params = []) => post("/_wb/sql", { sql: q, params });
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

await sql(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

const render = async () => {
  const { rows } = await sql("SELECT * FROM notes ORDER BY id DESC LIMIT 100");
  list.innerHTML = rows.map((n) => `
    <li><p>${esc(n.text)}</p><em>${n.at.slice(5, 16)}</em>
    <button class="iconbtn" data-del="${n.id}" title="删除">×</button></li>`).join("")
    || '<li class="empty">还没有便签</li>';
};

const submit = async () => {
  const value = text.value.trim();
  if (!value) return;
  await sql("INSERT INTO notes (text) VALUES (?)", [value]);
  text.value = "";
  render();
};
form.onsubmit = (e) => { e.preventDefault(); submit(); };
text.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } };

list.onclick = async (e) => {
  const id = e.target.closest("[data-del]")?.dataset.del;
  if (!id) return;
  await sql("DELETE FROM notes WHERE id = ?", [id]);
  render();
};

close.onclick = () => { out.hidden = true; };

// ai 权限:每次调用 summary 必填,会打进宿主控制台
sum.onclick = async () => {
  const { rows } = await sql("SELECT text FROM notes ORDER BY id DESC LIMIT 50");
  if (!rows.length) return;
  out.hidden = false;
  outbody.textContent = "整理中…";
  const r = await post("/_wb/ai", {
    summary: "把便签整理成要点",
    system: "你是一个中文助理。把用户零散的便签归纳成 3-6 条要点,每条一行,直接输出要点,不要开场白。",
    prompt: rows.map((n, i) => `${i + 1}. ${n.text}`).join("\n"),
  });
  outbody.textContent = r.ok ? r.text : `出错了:${r.error}`;
};

render();
