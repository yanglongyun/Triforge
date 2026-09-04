// data-ui 不能去掉 —— 引擎在 onPointerDown 里靠 closest('[data-ui]') 把工具栏上的
// 点击排除在拖拽画布之外。
export function Toolbar({ zoom, canEdit, canRemove, on }: {
    zoom: number;
    canEdit: boolean;
    canRemove: boolean;
    on: {
        addChild(): void;
        addSibling(): void;
        remove(): void;
        zoomOut(): void;
        zoomIn(): void;
        reset(): void;
        fit(): void;
    };
}) {
    return (
        <div className="toolbar" data-ui>
            <button type="button" title="添加子主题 (Tab)" disabled={!canEdit} onClick={on.addChild}>
                <svg viewBox="0 0 24 24">
                    <circle cx="7" cy="12" r="2.5" /><circle cx="18" cy="7" r="2.5" /><circle cx="18" cy="17" r="2.5" />
                    <path d="M9.5 11c4 0 3.5-4 6-4M9.5 13c4 0 3.5 4 6 4" />
                </svg><span>子主题</span>
            </button>
            <button type="button" title="添加同级主题 (Enter)" disabled={!canEdit} onClick={on.addSibling}>
                <svg viewBox="0 0 24 24">
                    <circle cx="6" cy="7" r="2.5" /><circle cx="6" cy="17" r="2.5" />
                    <path d="M10.5 12H21M16 7l5 5-5 5" />
                </svg><span>同级</span>
            </button>
            <button type="button" title="删除主题 (Delete)" disabled={!canRemove} onClick={on.remove}>
                <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg><span>删除</span>
            </button>
            <i />
            <button type="button" title="缩小" onClick={on.zoomOut}>
                <svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
            </button>
            <button type="button" className="zoom-label" title="实际大小 (⌘0)" onClick={on.reset}>
                {Math.round(zoom * 100)}%
            </button>
            <button type="button" title="放大" onClick={on.zoomIn}>
                <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
            </button>
            <button type="button" title="适应画布" onClick={on.fit}>
                <svg viewBox="0 0 24 24"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>
            </button>
        </div>
    );
}
