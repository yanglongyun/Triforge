// 导图 —— 两个视图:列表和画布。没有后端,数据经 SDK 的 sql() 直达自己的库。
//
// 画布引擎在 lib/engine.ts,它自己管 DOM、布局和动画,只认一棵扁平的主题数组
// 和一个 save 适配器。React 在这里负责的是外壳:列表、标题栏、工具栏、提示。
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Board } from './pages/Board';
import { Home } from './pages/Home';
// **顺序要紧**:底座先(变量、reset),自己的样式后。
// 用 JS import 而不是 CSS 的 @import —— 后者有「必须排在样式表最前面」
// 这条规矩,而破坏它的时候浏览器一声不响
import './styles/base.css';
import './styles/globals.css';

function App() {
    const [mapId, setMapId] = useState<number | null>(null);
    return (
        <div className="app">
            {mapId === null
                ? <Home onOpen={setMapId} />
                : <Board mapId={mapId} onBack={() => setMapId(null)} />}
        </div>
    );
}

createRoot(document.getElementById('root')!).render(<App />);
