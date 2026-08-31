// src/shared/status.mjs 是纯 JS 的共用词表（服务端也吃这一份）。
// 这里只声明它的形状，不复制内容 —— 复制就会两边走样。
declare module '@shared/status.mjs' {
  export interface CardStatusDef { id: CardStatusId; label: string; hue: number; note: string }
  export interface ItemStatusDef { id: ItemStatusId; label: string; hue: number }
  export type CardStatusId = 'idea' | 'active' | 'blocked' | 'paused' | 'shipped';
  export type ItemStatusId = 'todo' | 'doing' | 'blocked' | 'done';

  export const CARD_STATUSES: readonly CardStatusDef[];
  export const ITEM_STATUSES: readonly ItemStatusDef[];
  export const CARD_STATUS_IDS: readonly CardStatusId[];
  export const ITEM_STATUS_IDS: readonly ItemStatusId[];
  export const ITEM_STATUS_WEIGHT: Record<ItemStatusId, number>;
  export function cardStatus(id: string): CardStatusDef;
  export function itemStatus(id: string): ItemStatusDef;
}
