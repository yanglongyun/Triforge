import { marked } from 'marked';
import TurndownService from 'turndown';

/**
 * Markdown ↔ HTML。
 *
 * **库里存的是 Markdown,不是 HTML,也不是编辑器的私有结构。**
 * 正文要能被人读、被 AI 读、被 grep 到 —— HTML 三样都别扭,
 * 编辑器的 JSON 更是只有它自己认得。渲染是下游的事。
 *
 * Tiptap 吃 HTML,所以进出各转一次。转换不是无损的:
 * Markdown 表达不了的东西(比如任意 span 样式)在往回转时会被丢掉 ——
 * 这是选 Markdown 就要接受的代价,不是 bug。
 */
const turndown = new TurndownService({
  headingStyle: 'atx',        // # 标题,不用下划线那种
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});

// Tiptap 的任务列表进出都要认得 —— 默认规则会把它当普通列表,勾选状态就丢了
turndown.addRule('taskItem', {
  filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
  replacement: (content, node) => {
    const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
    return `- [${checked ? 'x' : ' '}] ${content.trim()}\n`;
  },
});

marked.setOptions({ gfm: true, breaks: false });

export const mdToHtml = (md: string) => marked.parse(md || '', { async: false }) as string;
export const htmlToMd = (html: string) => turndown.turndown(html || '').trim();
