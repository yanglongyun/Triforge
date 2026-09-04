let expr = "";      // 已敲定的算式,如 "12 × 3 +"
let entry = "0";     // 正在输入的数
let done = false;    // 刚按过 = ,再敲数字就另起一笔
let typed = false;   // 按过运算符之后有没有敲过新数 —— 没敲就连按运算符,只是换个符号

const OPS = { "+": "+", "−": "-", "×": "*", "÷": "/" };

const paint = (err = false) => {
  display.textContent = entry;
  display.className = "display" + (err ? " err" : "");
  exprEl.innerHTML = expr || "&nbsp;";
};
const exprEl = document.getElementById("expr");

// 自己算。页面 CSP 没开 unsafe-eval,Function/eval 在这里是禁的 —— 也本不该用。
// expr 一直是「数 op 数 op …」的形态,先乘除后加减两趟扫完。
const evaluate = (src = expr + " " + entry) => {
  const parts = src
    .replaceAll("×", "*").replaceAll("÷", "/").replaceAll("−", "-")
    .trim().split(/\s+/);
  const nums = [Number(parts[0])];
  const ops = [];
  for (let i = 1; i < parts.length; i += 2) {
    ops.push(parts[i]);
    nums.push(Number(parts[i + 1]));
  }
  if (nums.some((n) => !Number.isFinite(n)) || ops.some((o) => !"+-*/".includes(o))) throw new Error("bad");
  for (let i = 0; i < ops.length; ) {
    if (ops[i] === "*" || ops[i] === "/") {
      nums.splice(i, 2, ops[i] === "*" ? nums[i] * nums[i + 1] : nums[i] / nums[i + 1]);
      ops.splice(i, 1);
    } else i++;
  }
  let n = nums[0];
  ops.forEach((op, i) => { n = op === "+" ? n + nums[i + 1] : n - nums[i + 1]; });
  if (!Number.isFinite(n)) throw new Error("bad");
  return String(Math.round(n * 1e10) / 1e10);
};

const press = (k) => {
  if (/^\d$/.test(k)) {
    if (done) { expr = ""; entry = "0"; done = false; }
    entry = entry === "0" ? k : entry + k;
    typed = true;
  } else if (k === ".") {
    if (done) { expr = ""; entry = "0"; done = false; }
    if (!entry.includes(".")) entry += ".";
    typed = true;
  } else if (k in OPS) {
    // 不急着算 —— 整条算式留到 = 再按先乘除后加减求值
    if (expr && !typed) expr = expr.slice(0, -1) + k; // 连按运算符 = 换符号
    else expr = (expr ? expr + " " : "") + entry + " " + k;
    entry = "0"; done = false; typed = false;
  } else if (k === "=") {
    const src = typed || !expr ? undefined : expr.slice(0, -2); // 结尾悬着的运算符不算
    try { entry = evaluate(src); expr = ""; done = true; typed = false; }
    catch { entry = "算式不对"; expr = ""; done = true; typed = false; paint(true); return; }
  } else if (k === "C") {
    expr = ""; entry = "0"; done = false; typed = false;
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
