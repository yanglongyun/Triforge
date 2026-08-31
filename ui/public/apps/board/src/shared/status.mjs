// 状态词表 —— 前端、服务端、CLI、schema 校验共用这一份。
// 前端直接 import 这个文件（vite 走别名 @shared），所以颜色和文案不会两边各写一遍。

/** 项目卡片的状态。顺序即「按状态分组」时的排列顺序。 */
export const CARD_STATUSES = [
  { id: 'idea', label: '想法', hue: 250, note: '还没开工' },
  { id: 'active', label: '进行中', hue: 152, note: '正在做' },
  { id: 'blocked', label: '阻塞', hue: 4, note: '卡住了，等外部' },
  { id: 'paused', label: '搁置', hue: 38, note: '有意暂停' },
  { id: 'shipped', label: '已发布', hue: 210, note: '发出去了' },
];

/** 卡片内条目的状态。done 会被算进卡片头部的进度。 */
export const ITEM_STATUSES = [
  { id: 'todo', label: '待办', hue: 220 },
  { id: 'doing', label: '进行中', hue: 152 },
  { id: 'blocked', label: '阻塞', hue: 4 },
  { id: 'done', label: '完成', hue: 210 },
];

const ids = (list) => list.map((s) => s.id);
export const CARD_STATUS_IDS = ids(CARD_STATUSES);
export const ITEM_STATUS_IDS = ids(ITEM_STATUSES);

export const cardStatus = (id) => CARD_STATUSES.find((s) => s.id === id) ?? CARD_STATUSES[0];
export const itemStatus = (id) => ITEM_STATUSES.find((s) => s.id === id) ?? ITEM_STATUSES[0];

/** 条目按状态排序时的权重:没做完的浮在上面,完成的沉底。 */
export const ITEM_STATUS_WEIGHT = { blocked: 0, doing: 1, todo: 2, done: 3 };
