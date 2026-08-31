const SETS = {
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lower: "abcdefghijklmnopqrstuvwxyz",
  digit: "0123456789",
  symbol: "!@#$%^&*-_=+?~",
};
const AMBIGUOUS = /[0O1lI]/g;

const boxes = { upper, lower, digit, symbol };

const roll = () => {
  let picked = Object.entries(SETS).filter(([k]) => boxes[k].checked);
  if (!picked.length) { lower.checked = true; picked = [["lower", SETS.lower]]; }
  const strip = (s) => plain.checked ? s.replace(AMBIGUOUS, "") : s;
  const pools = picked.map(([, s]) => strip(s)).filter(Boolean);
  const all = pools.join("");
  const n = Number(len.value);
  const rand = new Uint32Array(n);
  crypto.getRandomValues(rand);
  // 每个勾选的字符集先保底出一个,剩下的从全集里抽,最后洗牌
  const chars = pools.map((pool, i) => pool[rand[i] % pool.length]);
  for (let i = pools.length; i < n; i++) chars.push(all[rand[i] % all.length]);
  const shuffle = new Uint32Array(n);
  crypto.getRandomValues(shuffle);
  for (let i = n - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  const value = chars.slice(0, n).join("");
  pw.innerHTML = [...value].map((c) =>
    /\d/.test(c) ? `<span class="d">${c}</span>` :
    /[a-zA-Z]/.test(c) ? c.replace(/[<>&]/g, "") : `<span class="s">${c.replace(/[<>&]/g, "")}</span>`).join("");
  pw.dataset.value = value;
  // 强度 = 组合空间的位数
  const bits = Math.round(n * Math.log2(all.length || 1));
  const ratio = Math.min(bits / 128, 1);
  const bar = meter.firstElementChild;
  bar.style.width = `${Math.max(ratio * 100, 6)}%`;
  bar.style.background = bits < 50 ? "var(--danger)" : bits < 90 ? "#e8a23d" : "#1ba158";
};

len.oninput = () => { lenv.textContent = len.value; roll(); };
for (const box of [...Object.values(boxes), plain]) box.onchange = roll;
regen.onclick = roll;

copy.onclick = async () => {
  await navigator.clipboard.writeText(pw.dataset.value || "");
  copy.textContent = "已复制";
  setTimeout(() => { copy.textContent = "复制"; }, 1200);
};

roll();
