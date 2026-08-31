import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { api } from '../lib/api';
import { htmlToMd, mdToHtml } from '../lib/markdown';
import { Toolbar } from './Toolbar';

const SAVE_DELAY = 500;

/**
 * 正文编辑器。**库里存的是 Markdown**,这里进出各转一次。
 *
 * 没有协同、没有 WebSocket:单用户本地应用,CRDT 买到的东西一样都用不上,
 * 而代价是正文变成谁也读不了的二进制。存文本,AI 才能读能改。
 *
 * 保存策略:停手 500ms 落一次盘,切页和关窗时立刻刷 ——
 * 自动保存要么让人完全不用想它,要么就是个陷阱,没有中间地带。
 */
export function Editor({ pageId, title, footer }: { pageId: number; title: ReactNode; footer?: ReactNode }) {
  const [initial, setInitial] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInitial(null);
    api.body(pageId).then((md) => { if (!cancelled) setInitial(md); }).catch(() => { if (!cancelled) setInitial(''); });
    return () => { cancelled = true; };
  }, [pageId]);

  if (initial === null) return <div className="editor-wait" />;
  return <Surface key={pageId} pageId={pageId} initial={initial} title={title} footer={footer} />;
}

function Surface({ pageId, initial, title, footer }: { pageId: number; initial: string; title: ReactNode; footer?: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const timer = useRef<number | null>(null);
  const pending = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ref 而不是普通函数:卸载时的那次 flush 要拿到最新的 pending,不能被闭包钉死
  const flush = useRef(() => {});
  flush.current = () => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    const md = pending.current;
    if (md === null) return;
    pending.current = null;
    setSaving(true);
    void api.saveBody(pageId, md).finally(() => setSaving(false));
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Placeholder.configure({ placeholder: '写点什么。# 标题、- 列表、> 引用 直接生效' }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: mdToHtml(initial),
    editable: true,
    autofocus: false,
    editorProps: { attributes: { class: 'prose', spellcheck: 'false' } },
    onUpdate: ({ editor: instance }) => {
      pending.current = htmlToMd(instance.getHTML());
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush.current(), SAVE_DELAY);
    },
  }, [pageId]);

  // 换页、关窗都要把没落盘的刷掉 —— 停手 500ms 的窗口里走掉就丢了
  useEffect(() => {
    const onLeave = () => flush.current();
    window.addEventListener('beforeunload', onLeave);
    document.addEventListener('visibilitychange', onLeave);
    return () => {
      window.removeEventListener('beforeunload', onLeave);
      document.removeEventListener('visibilitychange', onLeave);
      flush.current();
    };
  }, []);

  // 编辑器载入后光标会滚进视野,把标题推出可视区。用户还没碰过就按回顶部。
  useEffect(() => {
    if (!editor || touched.current) return;
    const node = scroller.current;
    if (!node) return;
    const home = () => { if (!touched.current) node.scrollTop = 0; };
    home();
    const id = requestAnimationFrame(home);
    return () => cancelAnimationFrame(id);
  }, [editor]);

  return (
    <>
      {editor && <Toolbar editor={editor} />}
      {/* 标题在滚动容器里 —— 它跟着正文一起滚,而不是钉在上面占死一块高度 */}
      <div
        className="editor-scroll"
        ref={scroller}
        onWheel={() => { touched.current = true; }}
        onTouchStart={() => { touched.current = true; }}
        onKeyDown={() => { touched.current = true; }}
      >
        {title}
        <EditorContent editor={editor} />
        {footer}
      </div>
      <span className="save-note" aria-live="polite">{saving ? '保存中…' : ''}</span>
    </>
  );
}
