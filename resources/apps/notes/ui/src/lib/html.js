// 内容存 HTML。老笔记是纯文本(含 \n),第一次显示时需要包成 <div>。
const HTML_TAG = /<[a-z!][^>]*>/i

const escapeHtml = (s) => s
  .replace(/&/g,  '&amp;')
  .replace(/</g,  '&lt;')
  .replace(/>/g,  '&gt;')

export function contentToHtml(text) {
  if (!text) return ''
  if (HTML_TAG.test(text)) return text
  return text
    .split(/\r?\n/)
    .map(line => `<div>${line ? escapeHtml(line) : '<br>'}</div>`)
    .join('')
}

export function escapeForHtml(text) {
  return escapeHtml(String(text ?? ''))
}
