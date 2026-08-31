import type { CardStatusId, ItemStatusId } from '@shared/status.mjs';

export interface Item {
  id: number;
  card_id: number;
  title: string;
  detail: string;
  status: ItemStatusId;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface Card {
  id: number;
  board_id: number;
  title: string;
  subtitle: string;
  status: CardStatusId;
  link: string;
  position: number;
  archived: 0 | 1;
  created_at: number;
  updated_at: number;
  items: Item[];
}

export interface Board { id: number; name: string; created_at: number; updated_at: number }
export interface Tree { board: Board; cards: Card[] }
