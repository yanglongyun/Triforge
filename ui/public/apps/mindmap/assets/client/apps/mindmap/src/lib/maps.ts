// 库 —— 没有后端,数据经 SDK 的 sql() 直达系统库。
// 不变量(非空、side 枚举、级联删)由 schema.sql 兜着,不在这里重复校验。
import { one, rows, sql } from '/sdk/chatnext.js';

import type { MapRow, SaveAdapter, Topic } from './types';

/** 带上主题数:列表上要显示,顺手一次查出来,免得每张导图再打一次 */
export const listMaps = () => rows<MapRow>(
    `SELECT m.id, m.name, m.updated_at,
            (SELECT COUNT(*) FROM app_mindmap_topics t WHERE t.map_id = m.id) AS topics
       FROM app_mindmap_maps m ORDER BY m.updated_at DESC LIMIT 300`,
);

export const topicsOf = (mapId: number) => rows<Topic>(
    `SELECT id, parent_id, text, side, sort_order, collapsed, created_at
       FROM app_mindmap_topics WHERE map_id = ? ORDER BY sort_order, created_at`,
    [mapId],
);

export const openMapRow = (id: number) =>
    one<{ id: number; name: string }>('SELECT id, name FROM app_mindmap_maps WHERE id = ?', [id]);

/** 新建导图连带建根主题 —— 一张导图永远有且仅有一个根。 */
export async function createMap(name = '无标题导图') {
    const now = Date.now();
    const map = await one<MapRow>(
        'INSERT INTO app_mindmap_maps (name, created_at, updated_at) VALUES (?, ?, ?) RETURNING id, name, updated_at',
        [name, now, now],
    );
    await sql(
        `INSERT INTO app_mindmap_topics (map_id, parent_id, text, sort_order, created_at, updated_at)
         VALUES (?, NULL, ?, 0, ?, ?)`,
        [map.id, '中心主题', now, now],
    );
    return map;
}

export const renameMap = (id: number, name: string) => sql(
    'UPDATE app_mindmap_maps SET name = ?, updated_at = ? WHERE id = ?',
    [name, Date.now(), id],
);

export const removeMap = (id: number) => sql('DELETE FROM app_mindmap_maps WHERE id = ?', [id]);

const touchMap = (id: number) => sql('UPDATE app_mindmap_maps SET updated_at = ? WHERE id = ?', [Date.now(), id]);

/** 引擎的三个持久化出口。 */
export function saveAdapter(mapId: number): SaveAdapter {
    const touch = () => { void touchMap(mapId).catch(() => {}); };
    return {
        async create({ parentId, text, side, sortOrder }) {
            const now = Date.now();
            const row = await one<Topic>(
                `INSERT INTO app_mindmap_topics (map_id, parent_id, text, side, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 RETURNING id, parent_id, text, side, sort_order, collapsed, created_at`,
                [mapId, parentId, text, side === 'left' ? 'left' : 'right', sortOrder, now, now],
            );
            touch();
            return row;
        },
        async patch(id, patch) {
            const sets: string[] = [];
            const values: unknown[] = [];
            if ('text' in patch) { sets.push('text = ?'); values.push(patch.text); }
            if ('collapsed' in patch) { sets.push('collapsed = ?'); values.push(patch.collapsed ? 1 : 0); }
            if ('side' in patch) { sets.push('side = ?'); values.push(patch.side === 'left' ? 'left' : 'right'); }
            if ('sortOrder' in patch) { sets.push('sort_order = ?'); values.push(patch.sortOrder); }
            // 改父节点 —— 换父不是搬数据,只是改这一行的指针,整棵子树跟着走。
            // 成环由引擎在拖拽时挡住(不能拖到自己的子孙上),schema 层没有这个约束。
            if ('parentId' in patch) { sets.push('parent_id = ?'); values.push(patch.parentId); }
            if (!sets.length) return;
            sets.push('updated_at = ?');
            values.push(Date.now(), id);
            await sql(`UPDATE app_mindmap_topics SET ${sets.join(', ')} WHERE id = ?`, values);
            touch();
        },
        async remove(id) {
            // 子树靠外键 ON DELETE CASCADE 一起走,这里只删这一行
            await sql('DELETE FROM app_mindmap_topics WHERE id = ?', [id]);
            touch();
        },
    };
}

export function when(ts: number) {
    const date = new Date(Number(ts) || 0);
    const days = Math.round((Date.now() - date.getTime()) / 86400000);
    if (days === 0) {
        return `今天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
    if (days === 1) return '昨天';
    if (days < 30) return `${days} 天前`;
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
