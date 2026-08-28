const sql = (sql, params = []) =>
  fetch("/_wb/sql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql, params }),
  }).then((r) => r.json());

await sql(`CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
)`);

const render = async () => {
  const { rows } = await sql("SELECT * FROM todos ORDER BY done, id DESC");
  list.innerHTML = rows.map((t) => `
    <li class="${t.done ? "done" : ""}">
      <input type="checkbox" data-toggle="${t.id}" ${t.done ? "checked" : ""}>
      <span>${t.text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</span>
      <button data-del="${t.id}" title="删除">×</button>
    </li>`).join("");
  const left = rows.filter((t) => !t.done).length;
  foot.textContent = rows.length ? `未完 ${left} · 共 ${rows.length}` : "还没有待办";
};

form.onsubmit = async (e) => {
  e.preventDefault();
  const value = text.value.trim();
  if (!value) return;
  await sql("INSERT INTO todos (text) VALUES (?)", [value]);
  text.value = "";
  render();
};

list.onclick = async (e) => {
  const del = e.target.dataset?.del;
  const toggle = e.target.dataset?.toggle;
  if (del) await sql("DELETE FROM todos WHERE id = ?", [del]);
  else if (toggle) await sql("UPDATE todos SET done = 1 - done WHERE id = ?", [toggle]);
  else return;
  render();
};

render();
