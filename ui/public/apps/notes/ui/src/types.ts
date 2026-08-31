export interface PageNode {
  id: number;
  parent_id: number | null;
  title: string;
  icon: string;
  position: number;
  collapsed: 0 | 1;
  updated_at: number;
  children: PageNode[];
}

export interface Hit { id: number; title: string; icon: string; snippet: string }
