// 行尾处理。模型看到的和 edit 用来匹配的,必须是同一套行尾。
//
// 只处理 CRLF:孤立的 \r(经典 Mac 行尾)原样保留,避免把它当行尾误改。
// 因此纯 LF 文件走归一化后与原字节完全一致,不会被无谓改写。
// (与 AGENT 0.0.7 的 agent/functions/text.js 同源。)

/** 取文件的主导行尾。以先出现的那个为准。 */
export function detectLineEnding(content: string) {
  const crlf = content.indexOf("\r\n");
  if (crlf === -1) return "\n";
  const lf = content.indexOf("\n");
  // CRLF 里的 \n 位于 \r 之后一位;若首个 \n 更靠前,说明文件以 LF 为主。
  return crlf < lf ? "\r\n" : "\n";
}

/** CRLF → LF。 */
export function toLf(text: string) {
  return text.includes("\r\n") ? text.replace(/\r\n/g, "\n") : text;
}

/** LF → 原始行尾。 */
export function restoreLineEnding(text: string, ending: string) {
  return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}
