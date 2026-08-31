let expr = "";      // 已敲定的算式,如 "12 × 3 +"
let entry = "0";     // 正在输入的数
let done = false;    // 刚按过 = ,再敲数字就另起一笔

const OPS = { "+": "+", "−": "-", "×": "*", "÷": "/" };

const paint = (err = false) => {
  display.textContent = entry;
  display.className = "display" + (err ? " err" : "");
  exprEl.innerHTML = expr || "&nbsp;";
};
const exprEl = document.getElementById("expr");

const evaluate = () => {
  const src = (expr + " " + entry)
    .replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-").replaceAll("%", "/100");
  if (!/^[\d\s+\-*/.()]+$/.test(src)) throw new Error("bad");
  const n = Function(`"use strict"; return (${src})`)();
  if (!Number.isFinite(n)) throw new Error("bad");
  return String(Math.round(n * 1e10) / 1e10);
};

const press = (k) => {
  if (/^\d$/.test(k)) {
    if (done) { expr = ""; entry = "0"; done = false; }
    entry = entry === "0" ? k : entry + k;
  } else if (k === ".") {
    if (done) { expr = ""; entry = "0"; done = false; }
    if (!entry.includes(".")) entry += ".";
  } else if (k in OPS) {
    try { if (expr) entry = evaluate(); } catch { /* 让用户接着改 */ }
    expr = entry + " " + k;
    entry = "0"; done = false;
  } else if (k === "=") {
    try { entry = evaluate(); expr = ""; done = true; }
    catch { entry = "算式不对"; expr = ""; done = true; paint(true); return; }
  } else if (k === "C") {
    expr = ""; entry = "0"; done = false;
  } else if (k === "±") {
    entry = entry.startsWith("-") ? entry.slice(1) : entry === "0" ? "0" : "-" + entry;
  } else if (k === "%") {
    const n = Number(entry);
    if (Number.isFinite(n)) entry = String(n / 100);
  } else if (k === "back") {
    entry = entry.length > 1 ? entry.slice(0, -1) : "0";
  }
  paint();
};

pad.onclick = (e) => { const k = e.target.dataset?.k; if (k) press(k); };

window.onkeydown = (e) => {
  const map = { "*": "×", "/": "÷", "-": "−", "+": "+", Enter: "=", "=": "=", Escape: "C",
    Backspace: "back", "%": "%", ".": "." };
  const k = /^\d$/.test(e.key) ? e.key : map[e.key];
  if (!k) return;
  e.preventDefault();
  press(k);
};

paint();
