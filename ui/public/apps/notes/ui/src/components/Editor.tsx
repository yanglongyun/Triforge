import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { openSession } from '../lib/doc';
import type { Session } from '../lib/doc';
import { Toolbar } from './Toolbar';

/**
 * 正文编辑器。文档结构存在 Yjs 里，不是 HTML ——
 * 打开这一页的每台设备编辑的是同一份 CRDT，合并不需要冲突解决。
 *
 * 这一层只管 Yjs 连接的生命周期。编辑器本身在 Surface 里，
 * 而 Surface 只在 session 就绪后才挂载 —— useEditor 是个 hook，
 * 在 early return 之前也会跑，一旦让它拿到空的 extensions，
 * ProseMirror 会因为 schema 里没有 doc 节点直接抛错、整页白屏。
 */
export function Editor({ pageId, title }: { pageId: number; title: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const next = openSession(pageId);
    setSynced(false);
    setSession(next);
    const onSync = (isSynced: boolean) => setSynced(isSynced);
    next.provider.on('sync', onSync);
    return () => {
      next.provider.off('sync', onSync);
      next.destroy();
      setSession(null); // 换页时先卸掉旧 Surface，别让它拿着已销毁的文档再渲染一帧
    };
  }, [pageId]);

  if (!session) return <div className="editor-wait" />;
  return <Surface session={session} synced={synced} title={title} />;
}

function Surface({ session, synced, title }: { session: Session; synced: boolean; title: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const touched = useRef(false);

  const editor = useEditor({
    extensions: [
      // undoRedo 必须关掉：协同的撤销栈归 Yjs 管，两套历史会互相打架
      StarterKit.configure({ undoRedo: false, link: false }),
      Collaboration.configure({ document: session.doc, field: 'body' }),
      Placeholder.configure({
        placeholder: '写点什么。# 标题、- 列表、> 引用 直接生效',
      }),
      Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    editable: true,
    autofocus: false,
    editorProps: { attributes: { class: 'prose', spellcheck: 'false' } },
  }, [session]);

  // ProseMirror 载入文档后会把光标滚进视野。光标在正文开头，于是它把
  // 上方的标题推出了可视区 —— 文档一长，标题就“不见了”。
  // 用户还没碰过之前，把滚动位置按回顶部。
  useEffect(() => {
    if (!editor || touched.current) return;
    const node = scroller.current;
    if (!node) return;
    const home = () => { if (!touched.current) node.scrollTop = 0; };
    home();
    const id = requestAnimationFrame(home); // 让 PM 那次滚动先发生，再按回去
    return () => cancelAnimationFrame(id);
  }, [editor, synced]);

  return (
    <>
      {editor && <Toolbar editor={editor} />}
      {/* 标题在滚动容器里 —— 它跟着正文一起滚，而不是钉在上面占死一块高度 */}
      <div
        className="editor-scroll"
        ref={scroller}
        onWheel={() => { touched.current = true; }}
        onTouchStart={() => { touched.current = true; }}
        onKeyDown={() => { touched.current = true; }}
      >
        {title}
        <EditorContent editor={editor} />
        {!synced && <p className="sync-note">正在同步…（离线也能改，联上会自动合并）</p>}
      </div>
    </>
  );
}
