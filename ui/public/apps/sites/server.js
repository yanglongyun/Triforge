// 网站书签 —— 标准 Cloudflare Worker 形态,能原样部署到 Cloudflare(把 env.DB 换成真 D1)。
const SCHEMA = `CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const normalize = (raw) => {
  const v = String(raw || "").trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch { return null; }
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);

    await env.DB.exec(SCHEMA); // isolate 随时重启,建表放在请求开头最稳
    if (url.pathname === "/api/sites" && req.method === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM sites ORDER BY id DESC").all();
      return Response.json(results);
    }
    if (url.pathname === "/api/sites" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const link = normalize(body.url);
      if (!link) return Response.json({ error: "网址不合法" }, { status: 400 });
      const title = String(body.title || "").trim() || new URL(link).hostname.replace(/^www\./, "");
      const r = await env.DB.prepare("INSERT INTO sites (title, url) VALUES (?, ?)").bind(title, link).run();
      return Response.json({ id: r.meta.last_row_id, title, url: link });
    }
    if (url.pathname === "/api/sites" && req.method === "DELETE") {
      await env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(url.searchParams.get("id")).run();
      return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  },
};
