import { useEditorState, type Editor } from '@tiptap/react';

const B = () => <b>B</b>;
const I = () => <i>I</i>;
const S = () => <s>S</s>;
const Code = () => <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{'<>'}</span>;

/**
 * 选中文字才出现的浮动条。不做 Notion 那种斜杠菜单 ——
 * Markdown 记号（`# `、`- `、`> `、```）在 StarterKit 里本来就生效，
 * 那才是打字流里最快的路径；工具条只服务「已经写完再改格式」。
 */
export function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      empty: e.state.selection.empty,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      quote: e.isActive('blockquote'),
      bullet: e.isActive('bulletList'),
      task: e.isActive('taskList'),
    }),
  });

  if (!state || state.empty) return null;
  const chain = () => editor.chain().focus();

  const items: [string, boolean, () => void, React.ReactNode][] = [
    ['粗体', state.bold, () => chain().toggleBold().run(), <B />],
    ['斜体', state.italic, () => chain().toggleItalic().run(), <I />],
    ['删除线', state.strike, () => chain().toggleStrike().run(), <S />],
    ['行内代码', state.code, () => chain().toggleCode().run(), <Code />],
    ['一级标题', state.h1, () => chain().toggleHeading({ level: 1 }).run(), 'H1'],
    ['二级标题', state.h2, () => chain().toggleHeading({ level: 2 }).run(), 'H2'],
    ['引用', state.quote, () => chain().toggleBlockquote().run(), '❝'],
    ['列表', state.bullet, () => chain().toggleBulletList().run(), '•'],
    ['待办', state.task, () => chain().toggleTaskList().run(), '☑'],
  ];

  return (
    <div className="floaty" role="toolbar" aria-label="格式">
      {items.map(([label, active, run, glyph]) => (
        <button key={label} type="button" title={label} aria-label={label} aria-pressed={active}
                onMouseDown={(e) => e.preventDefault()} onClick={run}>
          {glyph}
        </button>
      ))}
    </div>
  );
}
