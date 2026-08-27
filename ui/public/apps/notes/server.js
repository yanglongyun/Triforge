// 笔记 —— 演示应用后端调 AI:整理/摘要在服务端做,前端只管展示。
// env.HOST.ai() 每次调用都会在 Workbench 的「活动」里留一条流水(summary 必填)。
const SCHEMA = `CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    await env.DB.exec(SCHEMA);
    if (url.pathname === "/api/notes" && req.method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM notes ORDER BY id DESC").all();
      return Response.json(results);
    }
    if (url.pathname === "/api/notes" && req.method === "POST") {
      const { text } = await req.json().catch(() => ({}));
      const value = String(text || "").trim();
      if (!value) return Response.json({ error: "内容不能为空" }, { status: 400 });
      const r = await env.DB.prepare("INSERT INTO notes (text) VALUES (?)").bind(value).run();
      return Response.json({ id: r.meta.last_row_id, text: value });
    }
    if (url.pathname === "/api/notes" && req.method === "DELETE") {
      await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(url.searchParams.get("id")).run();
      return Response.json({ ok: true });
    }
    // AI 摘要:后端取数据 → 调 AI → 回结果,前端一个按钮的事
    if (url.pathname === "/api/summarize" && req.method === "POST") {
      const { results } = await env.DB.prepare("SELECT text FROM notes ORDER BY id DESC LIMIT 50").all();
      if (!results.length) return Response.json({ error: "还没有笔记" }, { status: 400 });
      try {
        const r = await env.HOST.ai({
          summary: "把我的笔记整理成要点",
          system: "你是一个中文助理。把用户零散的笔记归纳成 3-6 条要点,每条一行,直接输出要点,不要开场白。",
          prompt: results.map((n, i) => `${i + 1}. ${n.text}`).join("\n"),
        });
        return Response.json({ text: r.text, tokens: r.tokens });
      } catch (e) {
        return Response.json({ error: String(e?.message || e) }, { status: 500 });
      }
    }
    return new Response("not found", { status: 404 });
  },
};
