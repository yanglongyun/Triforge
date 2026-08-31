// 下载的共享状态。
//
// 两处要读同一份:网页工具栏上的进度胶囊、⋯ 菜单里的下载列表。所以不放组件 state,
// 放这里当唯一事实源 —— 和 widgetPins 同一套路。
//
// 只活在内存里:重启即忘。下载记录的真相在**磁盘上的文件**,我们没必要再记一本
// 会和现实脱节的账(用户在访达里删了文件,列表里还留着一条才是更糟的体验)。
import { useEffect, useState } from "react";

export type Download = {
  id: string;
  name: string;
  path: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  received: number;
  total: number;
};

const MAX = 20;
let items: Download[] = [];
const listeners = new Set<(list: Download[]) => void>();

const publish = () => { for (const fn of listeners) fn(items); };

/** 壳推来一条更新:同一个 id 就地替换,新的排前面。 */
const upsert = (next: Download) => {
  const rest = items.filter((item) => item.id !== next.id);
  items = [next, ...rest].slice(0, MAX);
  publish();
};

if (typeof window !== "undefined") {
  window.addEventListener("workbench:download", (e) => {
    const detail = (e as CustomEvent).detail as Download;
    if (detail?.id) upsert(detail);
  });
}

export const useDownloads = () => {
  const [list, setList] = useState<Download[]>(items);
  useEffect(() => {
    listeners.add(setList);
    setList(items);
    return () => { listeners.delete(setList); };
  }, []);
  return list;
};

export const clearFinishedDownloads = () => {
  items = items.filter((item) => item.state === "progressing");
  publish();
};

/** 进度文案。总大小未知时(chunked)只能报已收字节 —— 别编一个假的百分比。 */
export const progressText = (item: Download) => {
  const mb = (n: number) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;
  if (item.state === "completed") return "已完成";
  if (item.state === "cancelled") return "已取消";
  if (item.state === "interrupted") return "已中断";
  if (!item.total) return mb(item.received);
  return `${Math.round((item.received / item.total) * 100)}% · ${mb(item.total)}`;
};
