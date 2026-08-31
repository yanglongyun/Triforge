import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './lib/api';
import { findPage, trailTo, useTree } from './lib/useTree';
import { Tree } from './components/Tree';
import { Editor } from './components/Editor';
import { Close, Menu, Plus, Search, Trash } from './components/icons';
import { EmojiPicker } from './components/EmojiPicker';
import { Cover, CoverPicker, coverStyle } from './components/Cover';
import type { Hit, PageNode } from './types';

const LAST_PAGE = 'notes:last-page';

export function App() {
  const { tree, connection, error, refresh, dismissError } = useTree();
  const [activeId, setActiveId] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(LAST_PAGE));
    return Number.isInteger(saved) && saved > 0 ? saved : null;
  });
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);

  // 打开的页没了（可能在别的设备上删的），退回第一页
  useEffect(() => {
    if (!tree) return;
    if (activeId != null && findPage(tree, activeId)) return;
    setActiveId(tree[0]?.id ?? null);
  }, [tree, activeId]);

  useEffect(() => {
    if (activeId != null) localStorage.setItem(LAST_PAGE, String(activeId));
  }, [activeId]);

  const open = useCallback((id: number) => { setActiveId(id); setDrawer(false); setHits(null); setQuery(''); }, []);

  const act = useCallback(async (run: () => Promise<unknown>) => {
    try { await run(); } finally { void refresh(); }
  }, [refresh]);

  const handlers = useMemo(() => ({
    onOpen: open,
    onToggle: (node: PageNode) => void act(() => api.update(node.id, { collapsed: !node.collapsed })),
    onAdd: (parentId: number) => void act(async () => { const p = await api.create({ parentId }); open(p.id); }),
    onRename: (id: number, title: string) => void act(() => api.update(id, { title })),
    onPatch: (id: number, patch: { icon?: string; cover?: string }) => void act(() => api.update(id, patch)),
    onDelete: (node: PageNode) => void act(() => api.remove(node.id)),
    onMove: (id: number, to: { parentId?: number | null; index?: number }) => void act(() => api.move(id, to)),
  }), [act, open]);

  const active = tree && activeId != null ? findPage(tree, activeId) : null;
  const trail = tree && activeId != null ? trailTo(tree, activeId) ?? [] : [];

  // 搜索防抖
  useEffect(() => {
    const q = query.trim();
    if (!q) { setHits(null); return; }
    const timer = setTimeout(() => { void api.search(q).then(setHits).catch(() => setHits([])); }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  // 抽屉打开时锁住背后的滚动，否则手指在抽屉上滑会把正文一起带走
  useEffect(() => {
    if (!drawer) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [drawer]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setDrawer(true);
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.find input')?.focus());
      }
      if (event.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app" data-drawer={drawer}>
      <aside className="side">
        <div className="side-head">
          <span className="brand">Notes</span>
          <span className="wire" data-state={connection} title={
            connection === 'live' ? '实时同步中' : connection === 'offline' ? '离线（改动会存在本机，联上自动合并）' : '连接中'
          }><i /></span>
          <button type="button" className="icon-btn only-narrow" aria-label="关闭侧栏" onClick={() => setDrawer(false)}><Close /></button>
        </div>

        <label className="find">
          <Search />
          <input value={query} placeholder="搜索标题和正文  ⌘K" onChange={(e) => setQuery(e.target.value)} />
          {query && <button type="button" aria-label="清除" onClick={() => setQuery('')}><Close /></button>}
        </label>

        <div className="side-body">
          {hits ? (
            hits.length ? (
              <ul className="hits">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button type="button" onClick={() => open(hit.id)}>
                      <span className="hit-title">{hit.icon && `${hit.icon} `}{hit.title}</span>
                      {hit.snippet && <span className="hit-snippet">{hit.snippet}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="hint">没有命中</p>
          ) : tree ? (
            tree.length ? <Tree nodes={tree} activeId={activeId} handlers={handlers} />
                        : <p className="hint">还没有页面。</p>
          ) : <p className="hint">加载中…</p>}
        </div>

        <button type="button" className="side-foot"
                onClick={() => void act(async () => { const p = await api.create({}); open(p.id); })}>
          <Plus /> 新建页面
        </button>
      </aside>

      <main className="main">
        <header className="bar">
          <button type="button" className="icon-btn only-narrow" aria-label="页面列表" onClick={() => setDrawer(true)}><Menu /></button>
          <nav className="trail" aria-label="路径">
            {trail.map((node, i) => (
              <span key={node.id}>
                {i > 0 && <span className="sep">/</span>}
                <button type="button" onClick={() => open(node.id)} aria-current={i === trail.length - 1}>
                  {node.icon && `${node.icon} `}{node.title}
                </button>
              </span>
            ))}
          </nav>
          <span className="grow" />
          {active && (
            <button type="button" className="icon-btn" aria-label="删除此页"
                    onClick={() => {
                      const kids = active.children.length;
                      if (confirm(`删除「${active.title}」${kids ? `及其 ${kids} 个子页` : ''}？`)) handlers.onDelete(active);
                    }}><Trash /></button>
          )}
        </header>

        {active ? (
          <Editor key={active.id} pageId={active.id}
                  title={<TitleField page={active} onRename={handlers.onRename} onPatch={handlers.onPatch} />} />
        ) : (
          <div className="blank">
            <h2>还没有页面</h2>
            <p>左下角新建一页，或者用命令行：<code>notes page add "标题"</code></p>
          </div>
        )}
      </main>

      {drawer && <div className="scrim only-narrow" onClick={() => setDrawer(false)} />}

      {error && (
        <div className="toast" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="icon-btn" onClick={dismissError} aria-label="关闭"><Close /></button>
        </div>
      )}
    </div>
  );
}

/** 页面标题：正文的第一行，改完即存。 */
function TitleField({
  page, onRename, onPatch,
}: {
  page: PageNode;
  onRename: (id: number, title: string) => void;
  onPatch: (id: number, patch: { icon?: string; cover?: string }) => void;
}) {
  const [draft, setDraft] = useState(page.title);
  const [picking, setPicking] = useState<'icon' | 'cover' | null>(null);
  useEffect(() => setDraft(page.title), [page.id, page.title]);
  useEffect(() => setPicking(null), [page.id]);

  return (
    <div className="title-wrap">
      <Cover cover={page.cover} onChange={(next) => onPatch(page.id, { cover: next })} />

      {page.icon && (
        <button type="button" className="page-icon" onClick={() => setPicking('icon')} aria-label="更换图标">
          {page.icon}
        </button>
      )}

      {/* 没有的东西才给入口:已经有图标/封面时,改它们走各自的元素 */}
      <div className="title-adds">
        {!page.icon && (
          <button type="button" onClick={() => setPicking('icon')}>添加图标</button>
        )}
        {!coverStyle(page.cover) && (
          <button type="button" onClick={() => setPicking('cover')}>添加封面</button>
        )}
      </div>

      {picking === 'icon' && (
        <EmojiPicker
          value={page.icon}
          onPick={(icon) => onPatch(page.id, { icon })}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'cover' && (
        <CoverPicker
          cover={page.cover}
          onPick={(cover) => onPatch(page.id, { cover })}
          onClose={() => setPicking(null)}
        />
      )}

      <textarea
        className="title" rows={1} value={draft === '无标题' ? '' : draft} placeholder="无标题"
        onChange={(e) => {
          setDraft(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onBlur={() => { const next = draft.trim(); if (next !== page.title) onRename(page.id, next); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setDraft(page.title); e.currentTarget.blur(); }
        }}
      />
    </div>
  );
}
