// Excalidraw 的替身。jsdom 缺一整套 canvas / 字体 API，补齐是打地鼠，
// 补出来的测试还脆。这里只替换第三方那一层，Board 自己的挂载、载入、
// 存盘接线全部照跑 —— 我的 bug 在那一圈，不在 Excalidraw 里面。
import { useEffect } from 'react';

export function Excalidraw({ excalidrawAPI, initialData, onChange }: {
  excalidrawAPI?: (api: unknown) => void;
  initialData?: { elements?: readonly unknown[] };
  onChange?: () => void;
}) {
  useEffect(() => {
    excalidrawAPI?.({
      getSceneElements: () => initialData?.elements ?? [],
      getAppState: () => ({ scrollX: 0 }),
      getFiles: () => ({}),
      updateScene: () => {},
    });
  }, [excalidrawAPI, initialData]);
  return (
    <div data-testid="excalidraw-stub" onClick={() => onChange?.()}>
      画布替身 · {initialData?.elements?.length ?? 0} 个元素
    </div>
  );
}
