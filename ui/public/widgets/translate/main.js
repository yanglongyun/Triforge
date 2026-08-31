const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

let target = "中文";
seg.onclick = (e) => {
  const lang = e.target.dataset?.lang;
  if (!lang) return;
  target = lang;
  for (const b of seg.children) b.classList.toggle("on", b === e.target);
  if (src.value.trim()) run();
};

let busy = false;
const run = async () => {
  const value = src.value.trim();
  if (!value || busy) return;
  busy = true; go.disabled = true;
  outcard.hidden = false;
  out.className = "waiting"; out.textContent = "翻译中…";
  const r = await post("/_wb/ai", {
    summary: `翻译成${target}`,
    system: `你是专业译者。把用户给的文字翻译成${target},只输出译文,不解释、不加引号。语气与原文一致,术语按行业惯例。`,
    prompt: value,
  }).catch((e) => ({ ok: false, error: String(e) }));
  out.className = "";
  out.textContent = r.ok ? r.text : `出错了:${r.error}`;
  busy = false; go.disabled = false;
};

go.onclick = run;
src.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); run(); } };

copy.onclick = async () => {
  await navigator.clipboard.writeText(out.textContent);
  copy.textContent = "已复制";
  setTimeout(() => { copy.textContent = "复制"; }, 1200);
};
