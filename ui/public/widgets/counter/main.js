// 宿主 API 是同源 HTTP,不需要引入任何 SDK。
const sql = (sql, params = []) =>
  fetch("/_wb/sql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql, params }),
  }).then((r) => r.json());

await sql(`CREATE TABLE IF NOT EXISTS hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)`);

const render = async () => {
  const total = await sql("SELECT COUNT(*) AS n FROM hits");
  const recent = await sql("SELECT at FROM hits ORDER BY id DESC LIMIT 8");
  count.textContent = total.rows[0].n;
  log.innerHTML = recent.rows.map((r) => `<li>${r.at}</li>`).join("");
};

add.onclick = async () => { await sql("INSERT INTO hits DEFAULT VALUES"); render(); };
render();
