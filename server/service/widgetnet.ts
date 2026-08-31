// 组件的 net 能力:宿主代为 GET 一个 http(s) 地址。
//
// CSP 的 connect-src 'self' 不动 —— 组件的 JS 还是连不上任何外部地址。
// 出口只有这一个,而且只放行 widget.json 里 hosts 声明过的域名:
// 用户装组件时看一眼 manifest,就知道它会跟外面哪几家说话。
const MAX_BYTES = 2 * 1024 * 1024; // 行情、RSS、天气都远小于这个数
const TIMEOUT_MS = 12_000;

export const fetchForWidget = async (hosts: string[], rawUrl: string) => {
  let url: URL;
  try { url = new URL(String(rawUrl || "")); } catch { throw new Error("url 不合法"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("只支持 http(s)");
  // "*" = 任意域名。RSS 阅读器这类组件的目标由用户自己填,写死白名单没有意义;
  // 但它必须明晃晃写在 manifest 里,用户装的时候看得见。
  if (!hosts.includes("*") && !hosts.includes(url.hostname.toLowerCase())) {
    throw new Error(`域名未声明:${url.hostname}(在 widget.json 的 hosts 里加上它)`);
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": "Mozilla/5.0 (mainbench-widget)", accept: "*/*" },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("响应超过 2MB");
  // 行情接口(GBK)这类非 UTF-8 的源,在这里统一转码,组件端永远拿 UTF-8
  const contentType = res.headers.get("content-type") || "";
  const charset = (/charset=([\w-]+)/i.exec(contentType)?.[1] || "utf-8").toLowerCase();
  let text: string;
  try { text = new TextDecoder(charset).decode(buf); } catch { text = buf.toString("utf8"); }
  return { status: res.status, contentType, text };
};
