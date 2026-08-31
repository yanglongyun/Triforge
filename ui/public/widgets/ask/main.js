const post = (path, body) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

const msgs = []; // { role: "user"|"ai", text }
let busy = false;

const bubble = (cls, content) => {
  const el = document.createElement("div");
  el.className = `msg ${cls}`;
  el.textContent = content;
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
};

const send = async () => {
  const q = text.value.trim();
  if (!q || busy) return;
  if (!msgs.length) log.innerHTML = "";
  text.value = ""; autosize();
  msgs.push({ role: "user", text: q });
  bubble("user", q);
  clear.hidden = false;
  busy = true;
  const wait = bubble("wait", "");
  wait.innerHTML = "<i>·</i><i>·</i><i>·</i>";
  // 最近 8 轮拼进 prompt —— /_wb/ai 是无状态的,上下文由组件自己带
  const transcript = msgs.slice(-16).map((m) => `${m.role === "user" ? "用户" : "助手"}:${m.text}`).join("\n");
  const r = await post("/_wb/ai", {
    summary: "快速问答:" + q.slice(0, 60),
    system: "你在一个很窄的侧栏小组件里回答小问题。用中文,直接给答案,尽量三五句话说完;代码或命令用行内形式;不要开场白和总结。",
    prompt: transcript,
  }).catch((e) => ({ ok: false, error: String(e) }));
  wait.remove();
  if (r.ok) { msgs.push({ role: "ai", text: r.text }); bubble("ai", r.text); }
  else bubble("err", `出错了:${r.error}`);
  busy = false;
  text.focus();
};

form.onsubmit = (e) => { e.preventDefault(); send(); };
text.onkeydown = (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
};
const autosize = () => { text.style.height = "auto"; text.style.height = Math.min(text.scrollHeight, 120) + "px"; };
text.oninput = autosize;

clear.onclick = () => {
  msgs.length = 0;
  log.innerHTML = '<div class="empty">例如:cron 的五个位置什么意思?</div>';
  clear.hidden = true;
};
