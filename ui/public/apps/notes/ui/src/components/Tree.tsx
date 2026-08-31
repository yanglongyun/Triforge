import { useEffect, useRef, useState } from 'react';
import type { PageNode } from '../types';
import { Caret, Dots, Plus } from './icons';

type Drop = { id: number; where: 'before' | 'inside' | 'after' } | null;

interface Handlers {
  onOpen: (id: number) => void;
  onToggle: (node: PageNode) => void;
  onAdd: (parentId: number) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (node: PageNode) => void;
  onMove: (id: number, to: { parentId?: number | null; index?: number }) => void;
}

/**
 * 无限层级的页面树。层级靠左缩进表达，深到几层都行。
 * 拖拽有三种落法：拖到某一行的上/下边缘 = 排到它前/后（同级），
 * 拖到行中间 = 成为它的子页。这是 Notion 的做法，比只能「变子页」精确得多。
 */
export function Tree({ nodes, activeId, handlers }: { nodes: PageNode[]; activeId: number | null; handlers: Handlers }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [drop, setDrop] = useState<Drop>(null);

  return (
    <ul className="tree" role="tree" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null); }}>
      {nodes.map((node, index) => (
        <Row key={node.id} node={node} depth={0} index={index} siblings={nodes.length}
             activeId={activeId} handlers={handlers}
             dragging={dragging} setDragging={setDragging} drop={drop} setDrop={setDrop} />
      ))}
    </ul>
  );
}

function Row(props: {
  node: PageNode; depth: number; index: number; siblings: number;
  activeId: number | null; handlers: Handlers;
  dragging: number | null; setDragging: (id: number | null) => void;
  drop: Drop; setDrop: (d: Drop) => void;
}) {
  const { node, depth, index, activeId, handlers, dragging, setDragging, drop, setDrop } = props;
  const [renaming, setRenaming] = useState(false);
  const hasKids = node.children.length > 0;
  const open = hasKids && !node.collapsed;
  const marker = drop?.id === node.id ? drop.where : null;

  function onDragOver(event: React.DragEvent) {
    if (dragging === null || dragging === node.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - box.top) / box.height;
    setDrop({ id: node.id, where: ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'inside' });
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (dragging === null || !drop) return;
    if (drop.where === 'inside') handlers.onMove(dragging, { parentId: node.id });
    else handlers.onMove(dragging, { parentId: node.parent_id, index: drop.where === 'before' ? index : index + 1 });
    setDrop(null);
    setDragging(null);
  }

  return (
    <li role="none">
      <div
        role="treeitem"
        aria-expanded={hasKids ? open : undefined}
        aria-selected={node.id === activeId}
        aria-level={depth + 1}
        className="row"
        data-active={node.id === activeId}
        data-dragging={dragging === node.id}
        data-drop={marker ?? undefined}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable={!renaming}
        onDragStart={(e) => { setDragging(node.id); e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { setDragging(null); setDrop(null); }}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onClick={() => handlers.onOpen(node.id)}
      >
        <button
          type="button" className="caret" data-open={open} tabIndex={-1}
          aria-label={hasKids ? (open ? '收起' : '展开') : '没有子页'}
          onClick={(e) => { e.stopPropagation(); if (hasKids) handlers.onToggle(node); }}
        >
          {hasKids ? <Caret /> : <span className="dot" />}
        </button>

        {renaming ? (
          <RenameField
            value={node.title}
            onDone={(next) => { setRenaming(false); if (next && next !== node.title) handlers.onRename(node.id, next); }}
          />
        ) : (
          <span className="row-title" onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); }}>
            {node.icon && <span className="row-icon">{node.icon}</span>}
            {node.title}
          </span>
        )}

        <span className="row-tools">
          <button type="button" title="重命名" aria-label="重命名"
                  onClick={(e) => { e.stopPropagation(); setRenaming(true); }}><Dots /></button>
          <button type="button" title="新建子页" aria-label="新建子页"
                  onClick={(e) => { e.stopPropagation(); handlers.onAdd(node.id); }}><Plus /></button>
        </span>
      </div>

      {open && (
        <ul role="group">
          {node.children.map((child, i) => (
            <Row key={child.id} {...props} node={child} depth={depth + 1} index={i} siblings={node.children.length} />
          ))}
        </ul>
      )}
    </li>
  );
}

function RenameField({ value, onDone }: { value: string; onDone: (next: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  useEffect(() => { ref.current?.select(); }, []);
  return (
    <input
      ref={ref} className="rename" value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onDone(draft.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') onDone(draft.trim());
        if (e.key === 'Escape') onDone('');
      }}
    />
  );
}
