import { useEffect, useRef, useState } from 'react';

import { createMindmap } from '../lib/engine';
import { saveAdapter } from '../lib/maps';
import type { MindmapEngine, Topic } from '../lib/types';

/**
 * 把命令式的画布引擎接进 React。
 *
 * 引擎自己管 DOM、动画和交互 —— 这里只做三件事:给它三个挂载点、
 * 把它推出来的状态(选中 / 缩放 / 主题数)变成 state、卸载时断干净。
 * 不要试图让 React 去渲染节点和连线,那是引擎的活。
 */
export function useMindmapEngine(mapId: number, topics: Topic[] | null, onError: (message: string) => void, enabled = true) {
    const viewport = useRef<HTMLDivElement>(null);
    const world = useRef<HTMLDivElement>(null);
    const svg = useRef<SVGSVGElement>(null);
    const engine = useRef<MindmapEngine | null>(null);

    const [selected, setSelected] = useState<number | null>(null);
    const [zoom, setZoom] = useState(1);
    const [count, setCount] = useState(0);

    useEffect(() => {
        if (!enabled || !topics?.length || !viewport.current || !world.current || !svg.current) return undefined;
        engine.current = createMindmap({
            viewport: viewport.current,
            world: world.current,
            svg: svg.current,
            topics,
            save: saveAdapter(mapId),
            ui: { onSelection: setSelected, onZoom: setZoom, onCount: setCount, onError },
        });
        // 引擎构造时就会选中根主题,这里补一次初值
        setSelected(topics.find((topic) => !topic.parent_id)?.id ?? null);
        return () => { engine.current?.destroy(); engine.current = null; };
    }, [mapId, topics, onError, enabled]);

    return {
        refs: { viewport, world, svg },
        engine,
        selected,
        zoom,
        count,
        /** 没选中主题时三个改结构的按钮不可点;根主题不能删。 */
        canRemove: selected !== null && Boolean(engine.current?.canRemove(selected)),
    };
}
