// 任务清单 —— 最小的完整应用:一个表、四个接口、一个页面。
const SCHEMA = `CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    await env.DB.exec(SCHEMA);
    if (url.pathname === "/api/todos" && req.method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM todos ORDER BY done, id DESC").all();
      return Response.json(results);
    }
    if (url.pathname === "/api/todos" && req.method === "POST") {
      const { text } = await req.json().catch(() => ({}));
      const value = String(text || "").trim();
      if (!value) return Response.json({ error: "内容不能为空" }, { status: 400 });
      const r = await env.DB.prepare("INSERT INTO todos (text) VALUES (?)").bind(value).run();
      return Response.json({ id: r.meta.last_row_id, text: value, done: 0 });
    }
    if (url.pathname === "/api/todos" && req.method === "PATCH") {
      const { id, done } = await req.json().catch(() => ({}));
      await env.DB.prepare("UPDATE todos SET done = ? WHERE id = ?").bind(done ? 1 : 0, id).run();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/todos" && req.method === "DELETE") {
      await env.DB.prepare("DELETE FROM todos WHERE id = ?").bind(url.searchParams.get("id")).run();
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  },
};
