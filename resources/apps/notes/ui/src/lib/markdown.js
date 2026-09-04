import { marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

/**
 * Markdown ↔ HTML。
 *
 * **库里存的是 Markdown**,而编辑器是 contenteditable,吃的吐的都是 HTML ——
 * 所以进出各转一次。存 Markdown 是为了让正文能被人读、被 AI 读、被 grep 到;
 * HTML 三样都别扭,编辑器的私有结构更是只有它自己认得。
 *
 * 转换不是无损的:Markdown 表达不了的东西(任意内联样式、span)在往回转时会丢。
 * 这是选 Markdown 就要接受的代价,不是 bug。
 */
const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
});
turndown.use(gfm);

// contenteditable 用 <div> 分行,turndown 默认会把它们黏成一段
turndown.addRule('divLine', {
  filter: (node) => node.nodeName === 'DIV',
  replacement: (content) => `${content}\n\n`,
});

marked.setOptions({ gfm: true, breaks: false });

export const mdToHtml = (md) => marked.parse(md || '', { async: false });
export const htmlToMd = (html) => turndown.turndown(html || '').trim();
