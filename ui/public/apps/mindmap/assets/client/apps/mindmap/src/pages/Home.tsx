import { useEffect, useState } from 'react';

import { createMap, listMaps, removeMap, when } from '../lib/maps';
import type { MapRow } from '../lib/types';

/**
 * 每张导图的缩略图。
 *
 * 没有真的截图,也不该为了列表去渲染一遍画布 —— 这里画的是一个**由 id 定死**的
 * 小放射图形:同一张导图永远长同一个样,不同的导图彼此不同。
 * 它不表达内容,只提供辨识度 —— 一列纯文字的卡片,眼睛没有落脚点。
 */
function Glyph({ id, topics }: { id: number; topics: number }) {
    // 分支数跟着主题数走,但夹在 3~6 之间:太少显得空,太多挤成一团
    const branches = Math.max(3, Math.min(6, Math.round(Math.sqrt(Math.max(1, topics))) + 2));
    const seed = (id * 2654435761) % 360; // 每张图一个固定的起始角
    const spokes = Array.from({ length: branches }, (_, index) => {
        const angle = ((seed + (index * 360) / branches) * Math.PI) / 180;
        // 半径也由 id 决定,让分支长短不齐 —— 齐了就像雪花,不像导图
        const radius = 12 + ((id * (index + 3)) % 5);
        return { x: 21 + Math.cos(angle) * radius, y: 21 + Math.sin(angle) * radius };
    });

    return (
        <svg className="glyph" viewBox="0 0 42 42" aria-hidden>
            {spokes.map((point, index) => (
                <line key={index} x1="21" y1="21" x2={point.x} y2={point.y} />
            ))}
            {spokes.map((point, index) => (
                <circle key={index} cx={point.x} cy={point.y} r="2.6" />
            ))}
            <circle className="core" cx="21" cy="21" r="5" />
        </svg>
    );
}

export function Home({ onOpen }: { onOpen: (id: number) => void }) {
    const [maps, setMaps] = useState<MapRow[] | null>(null);

    const refresh = () => { void listMaps().then(setMaps); };
    useEffect(refresh, []);

    const create = () => { void createMap().then((map) => onOpen(map.id)); };

    return (
        <div className="page">
            <div className="page-inner wide">
                <header className="home-head">
                    <div className="grow">
                        <h1>导图</h1>
                        <p>把一个想法摊开成一棵树。也可以直接让助理替你画一张。</p>
                    </div>
                    <button type="button" className="btn btn-primary" onClick={create}>新建导图</button>
                </header>

                {maps === null ? null : maps.length ? (
                    <div className="map-grid">
                        {maps.map((map) => (
                            <button className="map-card" key={map.id} type="button" onClick={() => onOpen(map.id)}>
                                <Glyph id={map.id} topics={map.topics} />
                                <span className="map-name ellipsis">{map.name}</span>
                                <span className="map-meta">
                                    {map.topics ? `${map.topics} 个主题` : '空导图'} · {when(map.updated_at)}
                                </span>
                                <span
                                    className="map-del"
                                    role="button"
                                    tabIndex={-1}
                                    title="删除"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        if (!confirm(`删除「${map.name}」?它的所有主题会一起删掉。`)) return;
                                        void removeMap(map.id).then(refresh);
                                    }}
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden>
                                        <path d="M5 7h14M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7m-7 0 .8 11.2A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.8L17 7" />
                                    </svg>
                                </span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="empty">
                        <Glyph id={7} topics={9} />
                        <div className="empty-title">还没有导图</div>
                        <p>新建一张自己画,或者跟助理说一句「帮我画一张关于……的导图」。</p>
                        <button type="button" className="btn btn-primary" onClick={create}>新建导图</button>
                    </div>
                )}
            </div>
        </div>
    );
}
