import type { ReactNode } from 'react';

/**
 * 详情正文的极简 Markdown。**返回 React 节点，不碰 innerHTML** ——
 * 内容来自 CLI（也就是 agent 写的），当不可信文本处理，不给 XSS 留门。
 * 支持：标题、列表、引用、围栏代码块、段落；行内 **粗**、`码`、[链接](url)。
 */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((piece, i) => {
    const key = `${keyPrefix}-${i}`;
    if (piece.startsWith('**') && piece.endsWith('**')) return <strong key={key}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith('`') && piece.endsWith('`')) return <code key={key}>{piece.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(piece);
    if (link) {
      const href = link[2]!;
      // 只放行 http(s)，javascript: 之类一律降级成纯文本
      if (!/^https?:\/\//i.test(href)) return <span key={key}>{link[1]}</span>;
      return <a key={key} href={href} target="_blank" rel="noreferrer noopener">{link[1]}</a>;
    }
    return <span key={key}>{piece}</span>;
  });
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) { i++; continue; }

    if (line.startsWith('```')) {
      const buffer: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) buffer.push(lines[i++]!);
      i++;
      blocks.push(<pre key={key++}><code>{buffer.join('\n')}</code></pre>);
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const content = inline(heading[2]!, `h${key}`);
      blocks.push(level === 1 ? <h3 key={key++}>{content}</h3>
        : level === 2 ? <h4 key={key++}>{content}</h4> : <h5 key={key++}>{content}</h5>);
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buffer: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) buffer.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      blocks.push(<blockquote key={key++}>{inline(buffer.join(' '), `q${key}`)}</blockquote>);
      continue;
    }

    const bullet = /^\s*[-*]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const mark = ordered ? numbered : bullet;
      const entries: string[] = [];
      while (i < lines.length && mark.test(lines[i]!)) entries.push(lines[i++]!.replace(mark, ''));
      const list = entries.map((entry, n) => <li key={n}>{inline(entry, `li${key}-${n}`)}</li>);
      blocks.push(ordered ? <ol key={key++}>{list}</ol> : <ul key={key++}>{list}</ul>);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(```|#{1,3}\s|\s*[-*]\s|\s*\d+[.)]\s|\s*>)/.test(lines[i]!)) {
      paragraph.push(lines[i++]!);
    }
    blocks.push(<p key={key++}>{inline(paragraph.join(' '), `p${key}`)}</p>);
  }

  return <>{blocks}</>;
}
