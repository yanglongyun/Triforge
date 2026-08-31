const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

const SOURCES = [
  { key: "sspai", name: "少数派", url: "https://sspai.com/feed" },
  { key: "ifanr", name: "爱范儿", url: "https://www.ifanr.com/feed" },
  { key: "solidot", name: "Solidot", url: "https://www.solidot.org/index.rss" },
];
let current = localStorage.getItem("source") || "sspai";
const cache = new Map(); // key → { at, items }
const TTL = 10 * 60 * 1000;

seg.innerHTML = SOURCES.map((s) => `<button data-key="${s.key}">${s.name}</button>`).join("");
const paint = () => { for (const b of seg.children) b.classList.toggle("on", b.dataset.key === current); };

const ago = (date) => {
  const ms = Date.now() - date.getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = ms / 3600000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} 分钟前`;
  if (h < 24) return `${Math.round(h)} 小时前`;
  return `${Math.round(h / 24)} 天前`;
};

const load = async (force = false) => {
  paint();
  const source = SOURCES.find((s) => s.key === current);
  const hit = cache.get(current);
  if (!force && hit && Date.now() - hit.at < TTL) return show(hit.items, source);
  list.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const r = await post("/_wb/http", { url: source.url });
    if (!r.ok) throw new Error(r.error);
    const doc = new DOMParser().parseFromString(r.text, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("feed 解析失败");
    const items = [...doc.querySelectorAll("item")].slice(0, 20).map((it) => ({
      title: it.querySelector("title")?.textContent?.trim() || "(无标题)",
      link: it.querySelector("link")?.textContent?.trim() || "",
      at: new Date(it.querySelector("pubDate")?.textContent || ""),
    }));
    if (!items.length) throw new Error("feed 是空的");
    cache.set(current, { at: Date.now(), items });
    show(items, source);
  } catch (e) {
    list.innerHTML = `<div class="err">拿不到 ${source.name}:${esc(e.message)}</div>`;
  }
};

const show = (items, source) => {
  list.innerHTML = items.map((it) => `
    <a class="item" href="${esc(it.link)}" target="_blank" rel="noreferrer">
      <div class="t">${esc(it.title)}</div>
      <div class="m">${source.name}${ago(it.at) ? " · " + ago(it.at) : ""}</div>
    </a>`).join("");
};

seg.onclick = (e) => {
  const key = e.target.dataset?.key;
  if (!key) return;
  current = key;
  localStorage.setItem("source", key);
  load();
};
refresh.onclick = () => load(true);

load();
