import { cardStatus, itemStatus, ITEM_STATUS_WEIGHT } from '../shared/status.mjs';

const MARK = { todo: '○', doing: '◐', blocked: '▲', done: '●' };

/** 给人看的一棵树。id 都带出来,因为后续命令要靠 id 定位。 */
export function renderTree(tree, { compact = false } = {}) {
  const lines = [`${tree.board.name} [看板 ${tree.board.id}]`];
  if (!tree.cards.length) return `${lines[0]}\n  (还没有卡片,用 board card add "项目名" 建一个)`;

  for (const card of tree.cards) {
    const done = card.items.filter((i) => i.status === 'done').length;
    const progress = card.items.length ? ` ${done}/${card.items.length}` : '';
    const flags = card.archived ? ' 已归档' : '';
    lines.push('');
    lines.push(`▸ ${card.title} [${card.id}] · ${cardStatus(card.status).label}${progress}${flags}`);
    if (card.subtitle && !compact) lines.push(`  ${card.subtitle}`);
    const items = [...card.items].sort(
      (a, b) => ITEM_STATUS_WEIGHT[a.status] - ITEM_STATUS_WEIGHT[b.status] || a.position - b.position,
    );
    for (const item of items) {
      const detail = item.detail ? ' …' : '';
      lines.push(`  ${MARK[item.status]} ${item.title} [${item.id}]${detail}`);
    }
  }
  return lines.join('\n');
}

export function renderItem(item) {
  return [
    `${item.title} [条目 ${item.id}]`,
    `状态:${itemStatus(item.status).label}   所属卡片:${item.card_id}`,
    item.detail ? `\n${item.detail}` : '\n(没有详情,用 board item set 写)',
  ].join('\n');
}
