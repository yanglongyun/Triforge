// 引擎与库共用的形状。数据模型和表结构一致:扁平的 topics 数组,靠 parent_id 成树。

export type Side = 'left' | 'right';

export interface Topic {
    id: number;
    parent_id: number | null;
    text: string;
    side?: Side;
    sort_order: number;
    collapsed?: 0 | 1;
    created_at: number;
}

export interface MapRow {
    id: number;
    name: string;
    updated_at: number;
    /** 主题数,列表上显示用 */
    topics: number;
}

/** 引擎的三个持久化出口。引擎乐观更新、失败回滚,适配器只管照做和抛错。 */
export interface SaveAdapter {
    create(input: { parentId: number | null; text: string; side: Side; sortOrder: number }): Promise<Topic>;
    patch(id: number, patch: Partial<{ text: string; collapsed: boolean; side: Side; sortOrder: number; parentId: number }>): Promise<void>;
    remove(id: number): Promise<void>;
}

/** 引擎把状态推出来,外壳负责显示 —— 引擎不认识 React。 */
export interface MindmapUI {
    onSelection(selected: number | null): void;
    onZoom(zoom: number): void;
    onCount(count: number): void;
    onError(message: string): void;
}

export interface MindmapEngine {
    addChild(): void;
    addSibling(): void;
    removeSelected(): void;
    /** 根主题删不得 */
    canRemove(id: number | null): boolean;
    zoomBy(factor: number): void;
    reset(): void;
    fit(): void;
    destroy(): void;
}
