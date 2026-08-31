import { useCallback, useEffect, useMemo, useState } from 'react';
import { cardStatus } from '@shared/status.mjs';
import { api } from './lib/api';
import { useBoard } from './lib/useBoard';
import { ProjectCard } from './components/ProjectCard';
import { CardSheet, ItemSheet } from './components/DetailSheet';
import { Close, Plus } from './components/icons';
import type { Card, Item, Tree } from './types';

type Focus = { kind: 'item'; id: number } | { kind: 'card'; id: number } | null;

/** 树是唯一真相，选中项只存 id —— 这样 SSE 重取之后，面板里的内容会自己跟着更新。 */
const findItem = (tree: Tree | null, id: number) => {
  for (const card of tree?.cards ?? []) {
    const item = card.items.find((i) => i.id === id);
    if (item) return { item, card };
  }
  return null;
};

export function App() {
  const { tree, error, connection, pulse, refresh, mutate, dismissError } = useBoard();
  const [focus, setFocus] = useState<Focus>(null);

  const focused = useMemo(() => {
    if (!focus) return null;
    if (focus.kind === 'item') return findItem(tree, focus.id);
    const card = tree?.cards.find((c) => c.id === focus.id);
    return card ? { card, item: null } : null;
  }, [focus, tree]);

  // 选中的东西被删了（可能是我在 CLI 里删的），面板自己退场
  useEffect(() => { if (focus && tree && !focused) setFocus(null); }, [focus, focused, tree]);

  const patchItem = useCallback((id: number, patch: Partial<Item>) => mutate(
    (current) => ({ ...current, cards: current.cards.map((c) => ({
      ...c, items: c.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })) }),
    () => api.updateItem(id, patch),
  ), [mutate]);

  const patchCard = useCallback((id: number, patch: Partial<Card>) => mutate(
    (current) => ({ ...current, cards: current.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
    () => api.updateCard(id, patch),
  ), [mutate]);

  const addItem = useCallback(async (cardId: number, title: string) => {
    await api.createItem({ cardId, title }).catch(() => {});
    void refresh();
  }, [refresh]);

  const addCard = useCallback(async () => {
    const card = await api.createCard({ title: '新项目' }).catch(() => null);
    await refresh();
    if (card) setFocus({ kind: 'card', id: card.id });
  }, [refresh]);

  const counts = useMemo(() => {
    const cards = tree?.cards ?? [];
    const items = cards.flatMap((c) => c.items);
    return { cards: cards.length, open: items.filter((i) => i.status !== 'done').length, items: items.length };
  }, [tree]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>{tree?.board.name ?? 'Board'}</h1>
        <span className="grow" />
        {tree && (
          <div className="tally">
            <span><b>{counts.cards}</b> 个项目</span>
            <span><b>{counts.open}</b> 项待办</span>
          </div>
        )}
        <span className="wire" data-state={connection} data-pulse={pulse % 2} title={
          connection === 'live' ? '实时连接中' : connection === 'offline' ? '连接断开，正在重连' : '连接中'
        }>
          <i />{connection === 'live' ? '实时' : connection === 'offline' ? '离线' : '连接中'}
        </span>
      </header>

      <main className="track">
        {!tree && !error && [0, 1, 2].map((n) => <div className="skeleton" key={n} />)}

        {tree?.cards.length === 0 && (
          <div className="blank">
            <h2>还没有项目</h2>
            <p>每个项目一张卡片，卡片里放条目，条目点开写详情。<br />
              也可以在终端里让 agent 建：<code>board card add "项目名"</code></p>
            <button type="button" className="btn primary" onClick={addCard}>建第一个项目</button>
          </div>
        )}

        {tree?.cards.map((card) => (
          <ProjectCard
            key={card.id}
            card={card}
            activeItemId={focus?.kind === 'item' ? focus.id : null}
            onOpenItem={(item) => setFocus({ kind: 'item', id: item.id })}
            onOpenCard={() => setFocus({ kind: 'card', id: card.id })}
            onToggleItem={(item) => patchItem(item.id, { status: item.status === 'done' ? 'todo' : 'done' })}
            onAddItem={(title) => { void addItem(card.id, title); }}
          />
        ))}

        {tree && tree.cards.length > 0 && (
          <button type="button" className="card new" onClick={addCard}>
            <Plus /> 新建项目
          </button>
        )}
      </main>

      {focused?.item && (
        <ItemSheet
          item={focused.item}
          card={focused.card}
          onClose={() => setFocus(null)}
          onPatch={(patch) => patchItem(focused.item!.id, patch)}
          onDelete={() => { void api.deleteItem(focused.item!.id).then(() => refresh()); }}
        />
      )}
      {focused && !focused.item && (
        <CardSheet
          card={focused.card}
          onClose={() => setFocus(null)}
          onPatch={(patch) => patchCard(focused.card.id, patch)}
          onDelete={() => { void api.deleteCard(focused.card.id).then(() => refresh()); }}
        />
      )}

      {error && (
        <div className="toast" role="alert">
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="icon-btn" onClick={dismissError} aria-label="关闭提示"><Close /></button>
        </div>
      )}
    </div>
  );
}

export { cardStatus };
